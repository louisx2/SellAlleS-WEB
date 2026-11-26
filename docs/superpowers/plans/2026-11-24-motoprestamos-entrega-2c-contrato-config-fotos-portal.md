# Motopréstamos · Entrega 2C (contrato, configuración, fotos y portal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el módulo base: la configuración general del módulo (custodia por defecto y exigir garante), el contrato de venta condicional y de préstamo con garantía para imprimir, las fotos de la moto y de la cédula, y la moto y su matrícula en el portal del cliente.

**Architecture:**
- **Ajustes:** una fila de ajustes por empresa (`motos_settings`). Los textos de los contratos son columnas de esa fila; si están vacías, se usa el texto base del front.
- **Reglas de la base:** la custodia por defecto y la exigencia de garante las aplica la base: `motos_vincular_venta` al vender, y un trigger nuevo sobre `loans` al prestar.
- **Contrato:** se arma en el front con una función pura que llena los marcadores. Se imprime en carta desde una página propia.
- **Fotos:** van al bucket privado `motos`, por carpeta de empresa, igual que el del Taller.
- **Portal:** `resolve_portal_customers` suma las motos de cada préstamo o venta y las matrículas listas para retirar.

**Tech Stack:** Next 14 (export estático), TypeScript, Supabase/Postgres + Storage, `react-to-print` (ya instalado), `node --test`, suites SQL en `begin … rollback`.

**Spec:** `docs/superpowers/specs/2026-11-23-motoprestamos-design.md`, "Entrega 2 — Módulo base": *Contrato*, *Configuración del módulo*, *Portal del cliente*, las fotos de *Vehículos (la ficha)* y de *Datos del cliente*, y "exigir garante". Base: rama `claude/motoprestamos-entrega-2b` (PR #83, sobre #82); esta rama sale de ahí.

## Decisiones de este plan (para que Louis las revise)

- **Ajustes por empresa, no por sucursal:** la custodia y el contrato son política del negocio. El Taller los tiene por sucursal porque guarda ubicaciones de piezas.
- **Plantillas vacías = texto base.** No se siembra nada al crear la empresa con el rubro. «Restaurar texto base» vacía la columna.
- **Custodia por defecto, sin ajustes guardados = lo de hoy.** Vendida a crédito o financiada: en custodia. De contado: entregada. Préstamo: en custodia.
- **Custodia en contado.** Con «custodia en contado» encendida, la matrícula queda *lista para entregar*: la moto está pagada, pero el negocio todavía no le ha dado la matrícula al cliente.
- **Custodia apagada en financiada.** La matrícula queda *entregada*: el cliente se la llevó.
- **Exigir garante: qué cubre.** Aplica a todo préstamo nuevo de la empresa (no a las refinanciaciones) y a la venta de una moto a crédito o financiada. No aplica al resto de ventas a crédito: el casco a crédito no lo pide.
- **Fotos de la cédula: dónde van.** Van en el mismo diálogo de garantes, que pasa a llamarse «Expediente del cliente» (cédula, garantes y referencias).
- **Portal:**
  - Cada préstamo o venta lleva su moto (marca, modelo, placa y estado de la matrícula).
  - Arriba sale un aviso «Tu matrícula de … está lista para retirar», porque la venta saldada ya no sale en el portal.
  - El chasis no se muestra.
- **Lo que no se hace:** el texto de WhatsApp de la configuración llega en la entrega 3, con la cobranza.

## Global Constraints

- **Ajustes:**
  - `motos_settings`: `company_id` (pk), `custody_financed_sale bool default true`, `custody_cash_sale bool default false`, `custody_loan bool default true`, `require_guarantor bool default false`, `contract_sale text`, `contract_loan text`, `updated_at`.
  - RLS: lectura de la empresa; escritura con `motos_puede_configurar()`; súper admin pasa.
- **Fotos:**
  - Bucket `motos`, privado, 5 MB, `image/jpeg|png|webp`. Ruta `<empresa>/<vehiculos|clientes>/<id>/<uuid>.<ext>`. Políticas de `storage.objects` por la primera carpeta = `current_company_id()`, como `taller`.
  - Máximo 12 fotos por moto y 4 por cliente.
- **Mensajes:**
  - Garante: `Este cliente no tiene garante y el negocio lo exige para financiar o prestar. Agrégalo en el expediente del cliente.`
  - Plantilla con un marcador que no existe: el aviso en Configuración lista los marcadores desconocidos.
- **Marcadores del contrato:**
  - `{empresa.nombre} {empresa.rnc} {empresa.direccion} {empresa.telefono}`
  - `{cliente.nombre} {cliente.cedula} {cliente.direccion} {cliente.telefono}`
  - `{vehiculo.marca} {vehiculo.modelo} {vehiculo.año} {vehiculo.color} {vehiculo.chasis} {vehiculo.motor} {vehiculo.placa} {vehiculo.matricula}`
  - `{monto} {inicial} {cuotas} {frecuencia} {cuota} {tasa} {total} {primera_cuota} {fecha} {garantes} {plan}`
  - `{plan}` es la tabla de cuotas. Un dato que falta sale como `________`.
- **Textos base:** terminan con `Este es un modelo de referencia. Revíselo con su abogado antes de usarlo.`
- **Funciones vivas:** se cambian desde `pg_get_functiondef` con huella: `motos_vincular_venta` `7d023a03…` y `resolve_portal_customers` `8a2ba6c4…`. Grants explícitos; `revoke all` en tablas nuevas.
- **Empresa demo:** `…0aa`, sucursal `…0b1`, súper admin `92381752-…`. No cobrar en pantalla sin Louis.
- Textos en español. Sin dependencias nuevas.

## Review Focus

1. **Empresa sin el módulo o sin fila de ajustes:**
   - prestar y vender una moto se comportan como hoy (2A/2B);
   - el trigger de garante no toca los préstamos.
   → Task 2.
2. **Exigir garante:**
   - bloquea un préstamo nuevo sin garante y la venta financiada de una moto;
   - deja pasar la refinanciación, el préstamo con garante y la venta de contado.
   → Task 2.
3. **Contrato con datos que faltan** (sin placa, sin garantes, plan vacío) o con marcadores mal escritos: el documento sale con `________` en el hueco, y Configuración avisa de los marcadores desconocidos. → Task 3.
4. **Portal de un cliente con préstamos sin moto:** sale igual que hoy (`vehicles: []`, sin aviso), y no se ven motos de otros clientes. → Task 2.
5. **Fotos:** un usuario de otra empresa no ve ni sube fotos de esta (filas y carpeta del bucket). → Task 1.

---

### Task 1: Migración — ajustes y fotos

**Files:**
- Create: `supabase/migrations/20261124200000_motos_ajustes_y_fotos.sql`
- Create: `supabase/tests/motos_ajustes.sql`

**Interfaces:**
- Produces (SQL):
  - `motos_settings` (Global Constraints).
  - `vehicle_photos(id, company_id, vehicle_id → vehicles on delete cascade, path text not null, created_by default auth.uid(), created_at)`.
  - `customer_photos(id, company_id, customer_id → customers on delete cascade, kind text check in ('cedula','otro') default 'cedula', path, created_by, created_at)`.
  - Bucket `motos` y sus tres políticas (insert, select, delete).
  - RLS:
    - `vehicle_photos`: select e insert si la moto es visible (subconsulta a `vehicles`, que hereda su RLS) y es de la misma empresa; delete con `motos_tiene_permiso(branch_id, 'motos', 'edit')`.
    - `customer_photos`: como `customer_guarantors` (lo que el usuario ve de clientes).
  - Triggers `trg_bloquear_empresa_suspendida` en las tres tablas.

- [ ] **Step 1: Suite** (UUIDs `…e5XX`):
  - ajustes de la demo con valores por defecto;
  - un cliente sin `motos_puede_configurar` (cajero `cc56c633` con `set local role authenticated`) no escribe ajustes;
  - una foto de moto y una de cédula, que se borran con su moto o su cliente;
  - otra empresa no ve las filas;
  - `anon` sin privilegios en las tres tablas;
  - el bucket `motos` existe, es privado y tiene sus 3 políticas.
- [ ] **Step 2:** Correr sin la migración → falla.
- [ ] **Step 3:** Escribir la migración.
- [ ] **Step 4:** `begin; <migración> <suite> rollback;` → `ok`.
- [ ] **Step 5:** Commit: `Motopréstamos: ajustes del módulo y fotos`.

---

### Task 2: Migración — reglas de los ajustes y portal

**Files:**
- Create: `supabase/migrations/20261124210000_motos_reglas_y_portal.sql`
- Modify: `supabase/tests/motos_ajustes.sql`

**Interfaces:**
- Consumes: `motos_settings` (Task 1).
- Produces:
  - `motos_ajuste(p_company uuid) returns motos_settings`: la fila, o los valores por defecto si no existe.
  - `motos_vincular_venta` (desde lo vivo):
    - la matrícula al vender sale de los ajustes (Decisiones);
    - con `require_guarantor`, una venta a crédito o financiada de una moto a un cliente sin garantes falla con el mensaje de garante.
  - `motos_exigir_garante()`, trigger `before insert on loans`. Falla con el mensaje si se cumplen todas:
    - el módulo está encendido (`is_module_enabled(new.company_id, 'motoprestamos', false)`);
    - `require_guarantor` está activo;
    - `new.refinanced_from_id is null`;
    - el cliente no tiene garantes.
  - `resolve_portal_customers` (desde lo vivo):
    - cada préstamo y cada venta llevan `vehicles: [{brand, model, plate, registrationStatus}]`;
    - cada empresa lleva `registrationsReady: [{brand, model, plate}]`, las motos del cliente con la matrícula lista para entregar.

- [ ] **Step 1: Volcar lo vivo y huellas** de `motos_vincular_venta` y `resolve_portal_customers`.
- [ ] **Step 2: Suite** (se agrega a `motos_ajustes.sql`):
  - **Sin fila de ajustes:** contado → `entregada`, financiada → `en_custodia`.
  - **Con `custody_cash_sale`:** contado → `lista_para_entregar`.
  - **Sin `custody_financed_sale`:** financiada → `entregada`.
  - **`require_guarantor` en préstamos:**
    - un préstamo (insert directo como el front) sin garante falla con `%no tiene garante%`;
    - con un garante, pasa;
    - la refinanciación de un préstamo de un cliente sin garante pasa;
    - con el módulo apagado, un préstamo sin garante pasa.
  - **`require_guarantor` en ventas:** venta financiada de una moto sin garante falla; de contado, pasa.
  - **Portal:**
    - `resolve_portal_customers` de un cliente con un préstamo con moto trae su `vehicles` con la placa;
    - un préstamo sin moto trae `[]`;
    - una matrícula `lista_para_entregar` sale en `registrationsReady`;
    - no salen motos de otro cliente.
  - **Regresión:** `motos_venta.sql` pasa con la migración.
- [ ] **Step 3:** Correr sin la migración → falla.
- [ ] **Step 4:** Escribir la migración.
- [ ] **Step 5:** `begin; <Task 1> <esta> <suite> rollback;` → `ok`; y `motos_venta.sql` compacta.
- [ ] **Step 6:** Commit: `Motopréstamos: custodia por defecto, exigir garante y la moto en el portal`.

---

### Task 3: Lógica pura del contrato

**Files:**
- Create: `src/lib/contrato.ts`
- Test: `scripts/tests/contrato.test.mjs`

**Interfaces:**
- Produces:
  - `type TipoContrato = 'venta' | 'prestamo'`; `CONTRATO_BASE: Record<TipoContrato, string>` (los textos base, con el aviso).
  - `MARCADORES: { clave: string; descripcion: string }[]` (los de las Global Constraints).
  - `type Segmento = { tipo: 'texto'; texto: string } | { tipo: 'plan' }`.
  - `llenarContrato(plantilla: string, valores: Record<string, string | undefined>): Segmento[]`. Reemplaza cada `{clave}` conocida con su valor, o `________` si falta o viene vacío. Deja intactas las desconocidas. Parte el texto en cada `{plan}`.
  - `marcadoresDesconocidos(plantilla: string): string[]`, sin repetir y en orden de aparición.
  - `montoRD(n: number | undefined): string` → `RD$12,500.00` (Intl `en-US` con 2 decimales y el prefijo, como `formatCurrency`).
  - `garantesComoTexto(g: { name: string; idDoc?: string; phone?: string }[]): string` → `Juana Pérez, cédula 001-…, tel. 809-…; Pedro…`; vacío si no hay.
- [ ] **Step 1: Pruebas:**
  - llena cliente y moto;
  - un valor vacío sale `________`;
  - `{marcador_raro}` queda igual y lo lista `marcadoresDesconocidos`;
  - dos `{plan}` dan dos segmentos de plan;
  - un texto sin `{plan}` da un solo segmento;
  - los textos base no tienen marcadores desconocidos y terminan con el aviso;
  - `montoRD(12500)` y `montoRD(undefined)` (vacío);
  - garantes con y sin cédula.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit: `Motopréstamos: plantillas y llenado del contrato`.

---

### Task 4: Datos en el front

**Files:**
- Modify: `src/lib/types.ts` (`MotosSettings`, `VehiclePhoto`, `CustomerPhoto`), `src/lib/supabase/mappers.ts`
- Create: `src/hooks/use-motos-ajustes.ts`, `src/components/motos/fotos.tsx`

**Interfaces:**
- Produces:
  - `useMotosAjustes()` → `{ ajustes: MotosSettings; loading; guardar(patch: Partial<MotosSettings>): Promise<void> }`. Sin fila, devuelve los valores por defecto y `guardar` hace upsert.
  - `FotosMotos({ owner: { tipo: 'vehiculo' | 'cliente'; id: string }; companyId?: string; canEdit: boolean })` → galería con subir, ver y borrar:
    - el máximo es 12 para moto y 4 para cliente;
    - comprime con `comprimirDocumento` como el Taller;
    - si falla el insert de la fila, borra el archivo subido;
    - el error de carga se muestra, no se toma como lista vacía.
- [ ] **Step 1:** Tipos, mappers, hook y componente. `npx tsc --noEmit`.
- [ ] **Step 2:** Commit: `Motopréstamos: ajustes y fotos en el front`.

---

### Task 5: Configuración y uso de los ajustes

**Files:**
- Modify: `src/app/(app)/motos/config/page.tsx` (pestañas), `src/components/loans/loan-dialog.tsx`, `src/components/motos/garantia-fields.tsx`
- Create: `src/components/motos/config/contratos-tab.tsx`, `src/components/motos/config/general-tab.tsx`

- [ ] **Step 1:** `/motos/config` con pestañas *Tipos de vehículo* (lo de hoy) · *Contratos* · *General*. Sin `motos-config:edit`, todo es de solo lectura.
- [ ] **Step 2: Contratos.** Una caja de texto por tipo (venta condicional, préstamo con garantía). Lleva:
  - la lista de marcadores, que se insertan con un clic;
  - el aviso de marcadores desconocidos;
  - una vista previa con datos de ejemplo (con `llenarContrato`);
  - «Restaurar texto base» (guarda `null`).
- [ ] **Step 3: General.** Interruptores de custodia (venta financiada o a crédito, venta de contado, préstamo) y «Exigir garante para financiar o prestar», cada uno con una línea de explicación.
- [ ] **Step 4: Préstamo.**
  - «La matrícula queda en custodia» arranca con `custody_loan`.
  - Con `require_guarantor`, si el cliente no tiene garantes, el diálogo muestra el mensaje y bloquea «Prestar». La base lo exige igual.
- [ ] **Step 5:** `npx tsc --noEmit`; commit: `Motopréstamos: configuración general y de contratos`.

---

### Task 6: Contrato imprimible

**Files:**
- Create: `src/app/(app)/motos/contrato/page.tsx` + `contrato-client.tsx`, `src/components/motos/contrato-documento.tsx`
- Modify: `src/app/(app)/sales/detail/sale-receipt-client.tsx`, `src/components/motos/garantia-card.tsx`, `src/app/(app)/motos/ficha/ficha-client.tsx`

**Interfaces:**
- Consumes: `llenarContrato`, `CONTRATO_BASE`, `montoRD`, `garantesComoTexto` (Task 3); `useMotosAjustes` (Task 4); `useGarantes` (2B).
- Produces: la ruta `/motos/contrato?tipo=venta&id=<saleId>` o `?tipo=prestamo&id=<loanId>`.
- [ ] **Step 1: Página.**
  - **Carga:** la venta y sus cuotas, o el préstamo y sus cuotas; la moto (`vehicles` por `sale_id` o `loan_id`); el cliente, sus garantes y el perfil de la empresa. Arma los `valores`.
  - **Valores de la venta:**
    - `monto` es el total;
    - `inicial` es el pago inicial de `financing_details`;
    - `cuotas`, `frecuencia`, `cuota` y `tasa` salen de `financing_details`;
    - `total` es `totalWithInterest`.
  - **Valores del préstamo:**
    - `monto` es el capital;
    - `inicial` va vacío;
    - `cuota` es el monto de la cuota 1;
    - `total` es `total_with_interest`.
  - **Muestra:** el documento en carta con la tabla de cuotas donde vaya `{plan}` (número, fecha y monto), y el botón **Imprimir** (`react-to-print`, `@page { size: letter; margin: 2cm }`).
  - Sin moto enlazada, la página lo dice en vez de imprimir.
- [ ] **Step 2: Botones «Contrato».**
  - En el detalle de la venta, si el módulo está encendido, la venta es a crédito o financiada y tiene moto.
  - En la tarjeta Garantía del préstamo.
  - En la ficha: venta si la moto está vendida; préstamo si está en garantía o liberada.
- [ ] **Step 3:** `npx tsc --noEmit`; commit: `Motopréstamos: contrato imprimible`.

---

### Task 7: Fotos de la moto y expediente del cliente

**Files:**
- Modify: `src/app/(app)/motos/ficha/ficha-client.tsx`, `src/components/customers/garantes-dialog.tsx`, `src/components/customers/customer-actions.tsx`

- [ ] **Step 1:** La ficha suma la tarjeta **Fotos** (`FotosMotos` de la moto; edita con `motos:edit`).
- [ ] **Step 2:** El diálogo pasa a llamarse **Expediente del cliente**, con la sección **Cédula (fotos)** arriba (`FotosMotos` del cliente; máximo 4) y después garantes y referencias. En el menú dice «Expediente (cédula y garantes)».
- [ ] **Step 3:** `npx tsc --noEmit`; commit: `Motopréstamos: fotos de la moto y de la cédula`.

---

### Task 8: Portal

**Files:**
- Modify: `src/app/(portal)/mi-prestamo/portal-client.tsx`

- [ ] **Step 1:** Los tipos del portal suman `vehicles?` en préstamo y venta, y `registrationsReady?` en la empresa; todo opcional, porque un portal viejo puede recibir datos sin estos campos.
- [ ] **Step 2:**
  - Cada préstamo o financiamiento con moto muestra «Moto: Honda C70 · placa K000001 · Matrícula en custodia / lista para retirar».
  - Arriba de la empresa sale el aviso «Tu matrícula de Honda C70 (placa …) está lista para retirar» por cada una en `registrationsReady`.
- [ ] **Step 3:** `npx tsc --noEmit`; commit: `Motopréstamos: la moto y su matrícula en el portal`.

---

### Task 9: Aplicar, probar en pantalla y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit`, `next build`.
- [ ] **Step 2: Aplicar y verificar.**
  - Las huellas tienen que coincidir.
  - Aplicar las dos migraciones con `apply_migration`. Son compatibles con el front de producción: tablas y columnas nuevas, sin fila de ajustes = conducta de hoy, y campos nuevos en el JSON del portal.
  - Correr las suites contra lo aplicado, `get_advisors` y revisar que los logs no tengan `42501`.
- [ ] **Step 3: En pantalla** (demo, módulo encendido para la prueba):
  - Configuración: General y Contratos (vista previa y marcadores desconocidos).
  - Fotos de una moto de prueba y de la cédula de un cliente de prueba.
  - Contrato de una moto de prueba enlazada a datos de prueba (sin cobrar ni crear préstamo, salvo OK de Louis).
  - Portal: si no hay forma sin una cédula real, se cubre con la suite.
  - Al terminar, borrar lo de prueba (fotos del bucket incluidas), la fila del módulo y la de ajustes.
- [ ] **Step 4:** Spec con el estado de 2C, commit, push, PR. La base es `claude/motoprestamos-entrega-2b`, o `main` si ya se fusionaron #82 y #83. No fusionar sin Louis.
