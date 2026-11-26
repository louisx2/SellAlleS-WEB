# Motopréstamos · Entrega 4B (nota de crédito de la venta recuperada) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** emitir una nota de crédito parcial (B04 o E34) por lo no cobrado de una venta recuperada, al recuperarla o después.

**Architecture:**
- **Base de datos:**
  - una RPC calcula la nota;
  - la RPC guarda sus líneas ya prorrateadas en `credit_notes.items` y la marca `kind = 'recuperacion'`;
  - toma el número por el mismo camino que la anulación.
- **Envío a la DGII:** el E34 sale por el trigger y el worker de siempre. `ecf-emitir` usa las líneas de la nota en vez de las de la venta, y manda `CodigoModificacion` 3.
- **Front:**
  - casilla en «Recuperar vehículo»;
  - botón en la venta recuperada;
  - la nota se ve en el detalle de la venta;
  - Anulados la marca como «Recuperación».

**Tech Stack:** Next.js 14 (export estático), Supabase (Postgres, RPC plpgsql), Edge Function `ecf-emitir` (Deno), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-26-motoprestamos-4b-nota-credito-design.md` (y la entrega 4 de `docs/superpowers/specs/2026-11-23-motoprestamos-design.md`).

## Global Constraints

- **Migraciones:**
  - las aplico yo con `apply_migration`; nunca `supabase db push`;
  - antes, verde dentro de `begin … rollback` contra producción;
  - después, md5 del cuerpo de cada función contra el archivo, `get_advisors` y logs sin `42501`.
- **Funciones vivas:**
  - `annul_sale` no se toca;
  - las notas que ya existen quedan con `kind = 'anulacion'` por defecto.
- **Grants:** toda función nueva lleva `revoke execute … from public, anon` y su `grant` a `authenticated` y `service_role`.
- **`ecf-emitir`:**
  - la usan las empresas con e-CF en producción;
  - sin `items` en la nota (anulaciones), tiene que armar exactamente lo mismo que hoy, con las líneas de la venta y `CodigoModificacion` 1;
  - se despliega desde el worktree.
- **Prueba en pantalla:**
  - en la demo (`…0aa`, Principal `…0b1`);
  - venta y recuperación creadas por SQL, y la nota emitida en pantalla;
  - la demo emite en **TesteCF**, así que salen una E32 y una E34 de prueba, sin efecto fiscal; se avisa en el PR;
  - todo se borra al terminar (la `ecf_documentos` antes que la venta) y el módulo se apaga.
- **Textos:** en español, como en 4A; los montos aceptan comas (`parseMonto`).
- **Diálogos:** sin `Select` de Radix (botones o casillas).
- **PR:** a `main`. No fusionar sin el OK de Louis.

## Review Focus

1. **Redondeo:** con líneas gravadas y exentas mezcladas, con ITBIS incluido y sin él, y con cantidades decimales, los totales guardados en la nota tienen que cuadrar con los que arma `armar.ts` (±1 centavo), o el E34 sale con `error_datos`. → T1 (casos B y C) y T2.
2. **Factor fuera de rango:** si la devolución deja lo no cobrado por encima del total a pagar, el factor se topa en 1. Si no hay nada no cobrado, la RPC lo rechaza. → T1.
3. **Doble clic o dos pestañas:** la segunda nota choca con `credit_notes.sale_id` único y la base tiene que dar un mensaje claro, no un error de restricción. → T1.
4. **e-CF original rechazado o sin enviar:** igual que en la anulación, la RPC lo rechaza. → T1 (caso E).
5. **Anulaciones de siempre:** una nota sin `items` arma con las líneas de la venta y `CodigoModificacion` 1. → T2.

---

### Task 1: Base de datos — nota de crédito de la venta recuperada

**Files:**
- Create: `supabase/migrations/20261127120000_motos_nota_credito_recuperacion.sql`
- Create: `supabase/tests/motos_nota_credito.sql`

**Interfaces:**
- **Produces:**
  - `credit_notes.kind text not null default 'anulacion'`, con check `('anulacion','recuperacion')`.
  - `credit_notes.items jsonb`: null en las anulaciones; en una recuperación, `[{ "nombre", "cantidad", "precio", "itbis", "servicio" }]`.
  - `motos_nota_credito_recuperacion(p_sale_id uuid, p_motivo text default null) returns jsonb` con `{ credit_note_id, ncf, total, itbis_amount }`.

- [ ] **Step 1: Suite (rojo).** `supabase/tests/motos_nota_credito.sql`, con el mismo formato que `motos_recuperacion.sql`: helpers, datos `…e9XX` y un caso por bloque que anota en una tabla temporal y falla al final con la lista.
  - **Preparación:**
    - módulo encendido;
    - una secuencia B04 no electrónica en la demo;
    - la E34 electrónica, si la demo no la tiene;
    - ventas con `'ncf_requested', false` y el NCF puesto a mano;
    - para el e-CF, una fila de `ecf_documentos` aceptada de la venta.
  - **A (crédito, exenta, serie B):**
    - venta de 95,000 con 20,000 abonados, recuperada con 1,000 devueltos;
    - la nota es de 76,000.00, con ITBIS 0, una sola línea (`cantidad` 1, `precio` 76000, `itbis` false), `kind = 'recuperacion'`, `ncf` B04 y `ncf_modified` igual al NCF de la venta.
  - **B (gravada, ITBIS aparte):**
    - línea de 100,000 con ITBIS; la venta da total 118,000 e ITBIS 18,000;
    - con 18,000 abonados, la nota da línea 84,745.76, ITBIS 15,254.24 y total 100,000.00.
  - **C (gravada, ITBIS incluido):**
    - línea de 118,000 con `itbis_included = true` y 18,000 abonados;
    - la nota da línea 100,000.00, ITBIS 15,254.24 y total 100,000.00.
  - **D (financiada sin abonos):** el factor se topa en 1 y la nota es igual al total de la venta.
  - **E (e-CF):**
    - venta con E32 aceptada: la nota lleva `ncf` `E34…` y crea su `ecf_documentos` (`tipo_ecf` 34, `por_enviar`, `credit_note_id`);
    - con la E32 rechazada falla con `%rechazado%`;
    - con la E32 `por_enviar` falla con `%sin enviar%`.
  - **F (guardas):**
    - una venta no recuperada falla con `%no está recuperada%`;
    - una venta sin NCF falla con `%no lleva comprobante%`;
    - una segunda nota falla con `%ya tiene una nota de crédito%`;
    - el cajero `cc56` falla con `%Solo un administrador%`;
    - `anon` no tiene EXECUTE;
    - no hay notas vivas con `kind <> 'anulacion'`.
- [ ] **Step 2:** correrla con solo la suite, antes de la migración. Expected: falla porque `motos_nota_credito_recuperacion` no existe.
- [ ] **Step 3: Migración.**
  - **Columnas:** `kind` e `items`, más un check para que `items` solo se use con `recuperacion`.
  - **RPC:** `security definer`, `set search_path = public`. Lee la venta `for update`.
  - **Guardas, en este orden y con estos mensajes:**
    1. «Solo un administrador puede emitir la nota de crédito de una venta recuperada.»
    2. «Venta no encontrada.», también para otra empresa.
    3. «Esta venta no está recuperada.»
    4. «Esta venta no lleva comprobante fiscal: no hace falta nota de crédito.»
    5. «Esta venta ya tiene una nota de crédito.», para la que ya existe y para el choque de `unique_violation`.
  - **NCF:** el mismo bloque de `annul_sale`, copiado de su definición viva:
    - E-NCF: `ecf_activa`; estado del documento vigente; `rechazado` da «El e-CF de esta venta fue rechazado por la DGII: no hay comprobante que corregir.»; luego `assign_ncf(…, 'nota_credito')`;
    - serie B: la secuencia B04 con el mismo mensaje.
  - **Monto y líneas:** el algoritmo de abajo. Con `motivo` por defecto «Recuperación del vehículo».
  - **Grants** como en Global Constraints.

```
factor   := least(1, (r.written_off + r.refunded) / coalesce((financing_details->>'totalWithInterest')::numeric, total))
            -- r = la recuperación 'venta' de la venta (vehicle_recoveries); factor <= 0 → «Esta venta no tiene saldo no cobrado que acreditar.»
brutos   := por cada sale_item (orden estable por id): cantidad × coalesce(custom_price, price), itbis, es_servicio del producto
objetivo := round(sum(brutos) × factor, 2)
línea_i  := round(bruto_i × factor, 2) para todas menos la última; la última = objetivo − suma de las otras; se omiten las de 0
items    := [{ nombre: product_name, cantidad: 1, precio: línea_i, itbis, servicio }]
gravado  := suma de las líneas con itbis
itbis    := itbis_included ? round(gravado × 0.18 / 1.18, 2) : round(gravado × 0.18, 2)
total    := itbis_included ? round(sum(líneas), 2) : round(sum(líneas) + itbis, 2)
subtotal := total − itbis
```

- [ ] **Step 4:** verde: la migración más la suite, en `begin … rollback`. Expected: `SUITE_OK`.
- [ ] **Step 5:** commit: `Motopréstamos: nota de crédito de la venta recuperada (base)`.

### Task 2: e-CF — el E34 con las líneas de la nota y el código 3

**Files:**
- Modify: `supabase/functions/_shared/ecf/armar.ts`
- Modify: `supabase/functions/_shared/ecf/datos.ts`
- Modify: `supabase/functions/ecf-emitir/index.ts`
- Test: `scripts/tests/ecf-armar.test.mjs`, `scripts/tests/ecf-emitir.test.mjs`

**Interfaces:**
- **Consumes:** T1, con `credit_notes.kind` y `credit_notes.items`.
- **Produces:**
  - `DatosEcf.referencia.codigoModificacion?: 1 | 3`; sin él, 1.
  - `EntradaDatos.nota.codigoModificacion?: 1 | 3` y `EntradaDatos.nota.lineas?: LineaEcf[]`.

- [ ] **Step 1: Pruebas (rojo).**
  - En `ecf-armar.test.mjs`:
    - un E34 con `referencia.codigoModificacion: 3` da `InformacionReferencia.CodigoModificacion === 3`;
    - el mismo sin el campo sigue dando 1.
  - En `ecf-emitir.test.mjs`, `datosEcf` con `nota.lineas` y `codigoModificacion: 3`:
    - `d.lineas` son las de la nota, no las de la venta;
    - `d.referencia.codigoModificacion === 3`;
    - `d.totalGuardado` y `d.itbisGuardado` son los de la nota;
    - armar el caso B de T1 (84,745.76 gravado) da total 100,000 e ITBIS 15,254.24.
- [ ] **Step 2:** `npm test`. Expected: fallan las pruebas nuevas.
- [ ] **Step 3: Implementar.**
  - `armar.ts` usa `referencia.codigoModificacion ?? 1`.
  - `datos.ts` toma `e.nota.lineas` cuando vienen, y pasa el código.
  - `ecf-emitir/index.ts` lee `kind, items` de `credit_notes`. Con `items`, mapea a `LineaEcf` y manda `codigoModificacion: kind === 'recuperacion' ? 3 : 1`. Sin `items`, usa las líneas de la venta igual que hoy.
- [ ] **Step 4:** `npm test` y `npx tsc --noEmit`. Expected: verde.
- [ ] **Step 5:** commit: `e-CF: nota de crédito que corrige montos (código 3) con sus propias líneas`.

### Task 3: Datos en el front

**Files:**
- Modify: `src/lib/motos-recuperacion.ts`, `src/lib/types.ts` (`CreditNote.kind`), `src/lib/supabase/mappers.ts`, `src/hooks/use-recuperaciones.ts`
- Test: `scripts/tests/motos-recuperacion.test.mjs`

**Interfaces:**
- **Consumes:** T1 (RPC) y `emitirEcf` de `src/lib/ecf-client.ts`.
- **Produces:**
  - `montoNotaDeRecuperacion(v: { totalFacturado: number; totalAPagar: number; dadoDeBaja: number; devuelto: number }): number`, la vista previa del diálogo.
  - `useRecuperaciones().emitirNotaDeCredito(saleId: string, motivo?: string): Promise<{ creditNoteId: string; ncf: string | null; total: number }>`. Si el NCF es E34, llama a `emitirEcf({ creditNoteId })` como `annul_sale` en `sales-provider.tsx`.

- [ ] **Step 1: Pruebas (rojo).**
  - `({ totalFacturado: 95000, totalAPagar: 95000, dadoDeBaja: 75000, devuelto: 1000 })` da 76000.
  - Financiada sin abonos, `(95000, 99750, 99750, 0)`, da 95000 (factor topado).
  - `dadoDeBaja` 0 y `devuelto` 0 dan 0.
  - Centavos exactos con `0.1 + 0.2`.
- [ ] **Step 2–4:** rojo, implementar y verde (`npm test`, `npx tsc --noEmit`).
- [ ] **Step 5:** commit: `Motopréstamos: datos de la nota de crédito de recuperación`.

### Task 4: Pantallas

**Files:**
- Modify: `src/components/motos/recuperacion/recuperar-venta-dialog.tsx`
- Modify: `src/app/(app)/motos/ficha/ficha-client.tsx` (`leerCuenta` suma `ncf` y el total a pagar)
- Modify: `src/app/(app)/sales/detail/sale-receipt-client.tsx`
- Modify: `src/app/(app)/reports/anulados/page.tsx`

- [ ] **Step 1: Diálogo.**
  - Props nuevas: `conComprobante: boolean`, `totalFacturado` y `totalAPagar`.
  - Con comprobante aparece la casilla «Emitir nota de crédito por lo no cobrado (RD$X)», marcada por defecto. El monto sale de `montoNotaDeRecuperacion` y se actualiza con la devolución.
  - `RecuperarVentaInput` suma `notaDeCredito: boolean`, solo para el front.
- [ ] **Step 2: Al recuperar** (ficha y detalle de la venta), si la casilla va marcada, se llama a `emitirNotaDeCredito` después de `recuperarVenta`.
  - Si la nota falla, la recuperación queda y se avisa: «La moto se recuperó, pero la nota de crédito no se pudo emitir: <mensaje>. Emítela desde la venta.»
  - Si sale bien: «Nota de crédito <NCF> por RD$X».
- [ ] **Step 3: Detalle de la venta recuperada.**
  - El aviso «Venta recuperada» suma la línea de la nota: NCF, monto y, si es E34, el estado de su `ecf_documentos` leído por `credit_note_id`.
  - Si no hay nota, la venta tiene NCF y quien mira es administrador, aparece el botón «Emitir nota de crédito».
- [ ] **Step 4: Anulados** lee `kind` y muestra «Recuperación» en esas filas, en la tabla y en la exportación. El título de la columna de la NC pasa a «NC».
- [ ] **Step 5:** `npx tsc --noEmit`; commit: `Motopréstamos: pantallas de la nota de crédito de recuperación`.

### Task 5: Revisión, aplicar, desplegar, probar en pantalla y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit` y `next build`, sin `next dev` vivo.
- [ ] **Step 2: Revisión final** de la rama con un subagente opus, con la Review Focus de arriba. Un pase de arreglos, cada uno con su prueba fallando primero.
- [ ] **Step 3: Aplicar** la migración:
  - huellas de lo vivo antes;
  - `apply_migration`;
  - md5 de la RPC contra el archivo;
  - suite contra lo aplicado;
  - `get_advisors` y logs.
- [ ] **Step 4: Desplegar** `ecf-emitir` y, enseguida, comprobar que una anulación de siempre arma igual. La prueba de `ecf-emitir.test.mjs` sin `items` ya lo cubre; aquí solo se mira que la función nueva responde.
- [ ] **Step 5: En pantalla** (demo, módulo encendido solo para la prueba, venta a crédito de una moto creada por SQL con E32 en TesteCF):
  - recuperar con la casilla marcada;
  - ver la nota en la venta;
  - ver la E34 enviada y aceptada en TesteCF con `CodigoModificacion` 3;
  - ver Anulados y la 607 del período.
  - Al terminar, borrar todo (la `ecf_documentos` de la nota y de la venta antes que la venta) y apagar el módulo.
- [ ] **Step 6:**
  - escribir el estado de 4B en el diseño de Motopréstamos;
  - commit, push y PR a `main`;
  - actualizar la memoria;
  - no fusionar sin Louis.
