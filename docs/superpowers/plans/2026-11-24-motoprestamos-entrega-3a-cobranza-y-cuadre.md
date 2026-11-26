# Motopréstamos · Entrega 3A (cobradores, ruta, cobro en la calle y cuadre) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el negocio cobre en la calle con el teléfono:
- el cobrador ve su ruta del día;
- cobra o anota la visita;
- el efectivo queda a su nombre hasta entregarlo en la oficina;
- al entregarlo, la caja lo recibe de una vez, sin contarlo dos veces.

**Architecture:**
- **Tablas propias:** `collectors`, `collection_assignments`, `collection_visits` y `collector_settlements`. Los abonos de siempre (`loan_payments`, `credit_payments`) ganan `collector_id`, `en_calle` y `settlement_id`.
- **Cobro:** lo hace una RPC de la ruta, que comprueba la cartera del cobrador y llama a las RPC de abonos de siempre. Lo que hacen esas RPC no se toca: la RPC de la ruta solo marca, dentro de su transacción, `app.cobranza = on`, y `caja_blocks_cash` deja pasar el efectivo sin caja abierta.
- **Cierre de caja:** deja fuera los abonos `en_calle`. Ese dinero entra con la entrega, como un movimiento de entrada.
- **Anulaciones:** saben si el abono está en el bolsillo del cobrador (no tocan la caja) o ya se entregó (sale de la caja abierta).
- **Ruta en el front:** la arma con los cálculos de cuotas y mora que ya existen (`calculateLoanStatus`, `calculateFinancingStatus`).

**Tech Stack:** Next 14 (export estático), TypeScript, Supabase/Postgres, `node --test`, suites SQL en `begin … rollback`.

**Spec:** `docs/superpowers/specs/2026-11-23-motoprestamos-design.md`, "Entrega 3 — Cobranza en la calle". La entrega 3 se parte en:
- **3A** (este plan): cobradores, cartera, ruta, cobro en la calle, visitas y cuadre.
- **3B:** recibo del abono por WhatsApp (`receipt-link` ampliado a abonos), avisos de hoy con plantilla, reportes de cobranza y antigüedad por cobrador.

Base: rama `claude/motoprestamos-entrega-2c` (PR #84).

## Decisiones de este plan (para que Louis las revise)

- **Internet:** la ruta necesita conexión. El diseño deja fuera el trabajo sin internet; Louis todavía no ha dicho si los cobradores tendrán datos en la calle.
- **Quién es cobrador:**
  - Es un usuario marcado como cobrador en la sucursal (Configuración → *Cobradores*) y con el rol **Cobrador**.
  - El rol se crea solo al encender el módulo: permisos `cobranza` (ver y cobrar) y `customers` (ver).
- **Cartera:** cada cliente se asigna a un cobrador por sucursal. Lo no asignado no sale en ninguna ruta y queda para la oficina.
- **Quién puede cobrar desde la ruta:**
  - Un cobrador solo cobra a sus clientes asignados, salvo que tenga `cobranza-all`.
  - Para cobrar desde la ruta hay que estar registrado como cobrador en esa sucursal. La oficina sigue cobrando por las pantallas de siempre.
- **Cuadre:**
  - El abono en efectivo desde la ruta queda `en_calle` hasta la entrega.
  - La transferencia no pasa por el cuadre: va al banco, no al bolsillo.
  - La entrega la recibe quien tenga `cobranza-cuadre`. Requiere caja abierta en la sucursal si la sucursal usa caja; sin caja, la entrega se registra igual, sin movimiento.
  - La diferencia (recibido − esperado) queda registrada a cargo del cobrador; el sistema no la cobra.
- **Cobro desde la ruta:** préstamos, uno por uno; ventas a crédito o financiadas, por venta, o «abono general» al cliente (`register_customer_payment`, que reparte como hoy).
- **Recibo e impresión del abono:** pasan a 3B. En 3A, al cobrar sale la confirmación con el monto aplicado y el saldo.

## Global Constraints

- **Permisos nuevos** (gobernados por el módulo `motoprestamos`):
  - `cobranza` (`view`, `create`): ver mi ruta y cobrar;
  - `cobranza-all` (`view`): ver todas las rutas, cobrar a cualquiera y asignar cartera;
  - `cobranza-cuadre` (`view`, `create`): recibir entregas.
  - Rol **Cobrador:** `{"cobranza":["view","create"],"customers":["view"]}`, key `cobrador`, `is_system = true`.
- **Resultados de visita:** `pago` · `no_estaba` · `no_tenia` · `promesa` · `se_nego` · `moto_no_aparece`. La promesa exige fecha; el monto es opcional.
- **Mensajes:**
  - Cliente de otro cobrador: `Ese cliente no está en tu ruta.`
  - Sin registro de cobrador: `No estás registrado como cobrador en esta sucursal.`
  - Entrega sin pendientes: `Este cobrador no tiene abonos en efectivo sin entregar.`
  - Entrega sin caja abierta (sucursal con caja): `Abre la caja de esta sucursal para recibir la entrega.`
- **`app.cobranza`:** solo lo pone `cobranza_registrar_abono` con `set_config(…, true)`, y lo vuelve a `off` antes de salir. PostgREST no expone `set_config`.
- **Funciones vivas que se cambian** (desde `pg_get_functiondef`, con huella): `caja_blocks_cash` `93ab593d…`, `close_caja_session` `563589c0…`, `void_loan_payment` `037a7bb1…`, `void_credit_payment` `fc958945…`.
- **Funciones que no se cambian:** `register_loan_payment`, `register_sale_payment` y `register_customer_payment`. Sus huellas se anotan antes y después.
- **Tablas nuevas:** `revoke all` antes de los grants, RLS por empresa y sucursal, `trg_bloquear_empresa_suspendida`. Índices únicos (no restricciones) en tablas puente, por los embeds ambiguos de PostgREST.
- **Empresa demo:** `…0aa`, sucursal `…0b1`, súper admin `92381752-…`. Cajero de prueba `cc56c633` (como en 2B). La demo emite e-CF: no cobrar ventas en pantalla sin Louis; los abonos de préstamo por transferencia no emiten nada.
- **Textos y pantallas:** en español. La ruta y el cobro, primero móvil. Sin dependencias nuevas.

## Review Focus

1. **Empresas sin el módulo** (Pujols, Delmas): abonar, cerrar caja y anular abonos (antes y después de cerrar) dan exactamente lo mismo que hoy. → regresión en Task 2.
2. **La caja no cuenta dos veces.** Este es el recorrido:
   1. cobro en efectivo en la calle;
   2. cierre de caja sin entregar: no lo incluye;
   3. entrega al día siguiente: entra como movimiento;
   4. cierre de esa sesión: incluye el movimiento, no el abono.
   → Task 2.
3. **Anular un abono de la calle:**
   - antes de entregarlo, no toca la caja y baja lo que el cobrador tiene en mano;
   - después de entregado, sale de la caja abierta.
   → Task 2.
4. **Cartera:**
   - un cobrador no cobra ni anota visitas a clientes de otro;
   - con `cobranza-all` sí;
   - sin registro de cobrador, no cobra por la ruta;
   - lo comprueba la base, no solo la pantalla.
   → Task 2.
5. **Entrega con diferencia:** queda registrada; los abonos quedan liquidados; una segunda entrega sin pendientes falla; sin módulo de caja, la entrega se registra sin movimiento. → Task 2.

---

### Task 1: Migración — cobradores, cartera, visitas y entregas

**Files:**
- Create: `supabase/migrations/20261125120000_cobranza_base.sql`
- Create: `supabase/tests/cobranza.sql`

**Interfaces:**
- Produces (SQL):
  - `collectors(id, company_id, branch_id → branches on delete cascade, profile_id → profiles on delete cascade, is_active bool default true, created_at)`, con índice único `(branch_id, profile_id)`.
  - `collection_assignments(id, company_id, branch_id → branches on delete cascade, customer_id → customers on delete cascade, collector_id → collectors on delete cascade, visit_order int not null default 0, created_at, updated_at)`, con índice único `(branch_id, customer_id)`.
  - `collection_visits(id, company_id, branch_id, customer_id → customers on delete cascade, collector_id → collectors on delete set null, outcome text check (…), promise_date date, promise_amount numeric(14,2), note, payment_id uuid, created_by default auth.uid(), created_by_name, created_at default clock_timestamp())`, con índice `(branch_id, customer_id, created_at)` y `check (outcome <> 'promesa' or promise_date is not null)`.
  - `collector_settlements(id, company_id, branch_id, collector_id → collectors, expected numeric(14,2), received numeric(14,2), difference numeric(14,2) generated always as (received - expected) stored, note, caja_movement_id uuid, received_by default auth.uid(), received_by_name, created_at)`.
  - `loan_payments` y `credit_payments`:
    - `collector_id uuid → collectors on delete set null`;
    - `en_calle boolean not null default false`;
    - `settlement_id uuid → collector_settlements on delete set null`;
    - índice parcial `(collector_id) where en_calle and settlement_id is null`.
  - `cobranza_tengo_permiso(p_branch uuid, p_resource text, p_action text) returns boolean`, igual que `motos_tiene_permiso` pero sin defaults para una fila sin rol (sin rol no hay cobranza).
  - `cobranza_mi_cobrador(p_branch uuid) returns uuid`: el `collectors.id` activo del usuario en esa sucursal, o null.
  - **RLS:**
    - `collectors`: select de la empresa; escritura con `motos_puede_configurar()`.
    - `collection_assignments`: select si es mi cobrador o tengo `cobranza-all`; escritura con `cobranza-all`.
    - `collection_visits`: select igual; sin escritura directa (la hacen las RPC).
    - `collector_settlements`: select con `cobranza-cuadre`, o si es mi cobrador; sin escritura directa.
    - Súper admin pasa en todas.
  - **Rol Cobrador:**
    - Lo crea el trigger `cobranza_rol_cobrador()` en `company_modules` (after insert or update) cuando `module_key = 'motoprestamos' and enabled`, con `on conflict do nothing`.
    - El mismo insert corre una vez en la migración para las empresas que ya tienen el módulo.
- [ ] **Step 1: Suite** (UUIDs `…e6XX`):
  - un cobrador por `(sucursal, perfil)` (el repetido falla);
  - un cliente asignado una sola vez por sucursal;
  - una visita `promesa` sin fecha falla;
  - `difference` se calcula;
  - encender el módulo crea el rol Cobrador una sola vez;
  - `anon` sin privilegios;
  - el cajero `cc56c633` (cobrador sin `cobranza-all`) ve sus asignaciones y no las de otro cobrador (`set local role authenticated`).
- [ ] **Step 2:** Correr sin la migración → falla.
- [ ] **Step 3:** Escribir la migración.
- [ ] **Step 4:** `begin; <migración> <suite> rollback;` → `ok`.
- [ ] **Step 5:** Commit: `Motopréstamos: cobradores, cartera, visitas y entregas`.

---

### Task 2: Migración — cobro en la calle, visitas, entrega y caja

**Files:**
- Create: `supabase/migrations/20261125130000_cobranza_cobro_y_cuadre.sql`
- Modify: `supabase/tests/cobranza.sql`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `caja_blocks_cash` (desde lo vivo): devuelve `false` si `current_setting('app.cobranza', true) = 'on'`.
  - `cobranza_registrar_abono(p_tipo text, p_id uuid, p_branch_id uuid, p_amount numeric, p_method text, p_reference text, p_notes text) returns jsonb`, security definer:
    - **Tipos:** `p_tipo` es `prestamo` (`p_id` = préstamo), `venta` (`p_id` = venta) o `cliente` (`p_id` = cliente y `p_branch_id` = sucursal de la cartera).
    - **Validaciones:**
      - toma la sucursal y el cliente de la cuenta;
      - exige un cobrador propio en esa sucursal (`cobranza_mi_cobrador`) y `cobranza:create`;
      - exige la asignación de ese cliente a ese cobrador, o `cobranza-all`;
      - el método es `cash` o `transfer`.
    - **Cobro:** marca `app.cobranza`, llama a la RPC de siempre con `p_branch_id` = sucursal de la cuenta y lo devuelve a `off`. Al abono que creó le pone `collector_id` y `en_calle = (p_method = 'cash')`.
    - **Al final:** anota una visita `pago` con `payment_id` y devuelve el resultado de la RPC más `payment_id`.
  - `cobranza_registrar_visita(p_branch_id, p_customer_id, p_outcome, p_promise_date, p_promise_amount, p_note) returns uuid`: el mismo control de cartera; `p_outcome <> 'pago'`.
  - `cobranza_recibir_entrega(p_collector_id uuid, p_received numeric, p_note text) returns jsonb`, security definer:
    - **Control:** exige `cobranza-cuadre:create` en la sucursal del cobrador.
    - **Pendientes:** bloquea los abonos en efectivo `en_calle`, sin entregar y no anulados de ese cobrador y sucursal, en las dos tablas. Si no hay, falla con el mensaje.
    - **Registro:** crea la entrega, liquida esos abonos y devuelve `{settlement_id, expected, received, difference, payments}`.
    - **Caja:** si la sucursal usa caja (`is_module_enabled(caja)` y `branch_uses_caja`), exige la sesión abierta e inserta un movimiento `in` por `p_received`, con el motivo «Entrega del cobrador <nombre>». Lo hace como `register_caja_movement` y guarda `caja_movement_id`.
  - `close_caja_session` (desde lo vivo): las sumas de `credit_payments` y `loan_payments` en efectivo agregan `and not en_calle`.
  - `void_loan_payment` y `void_credit_payment` (desde lo vivo): si el abono es `en_calle`:
    - sin `settlement_id`, no buscan caja ni la tocan;
    - con `settlement_id`, exigen caja abierta y siempre sacan el monto (el dinero entró como movimiento).
    - El resto queda igual.
  - **Grants:** las tres RPC nuevas a `authenticated, service_role`; nada para `anon`.
- [ ] **Step 1: Volcar lo vivo y huellas** de las 4 funciones que cambian y de las 3 RPC de abonos (que no cambian).
- [ ] **Step 2: Suite.**
  - **Preparación:** caja de la demo encendida en `b1` con sesión abierta (como `desembolso_caja.sql`); el cobrador `cc56c633` en `b1` con rol Cobrador; otro cobrador (el súper admin, también como `collectors`).
  - **Cobro:**
    - el cobrador cobra en efectivo un préstamo de su cliente, con la caja **cerrada**: pasa, y el abono queda `en_calle`, con `collector_id`;
    - el préstamo de un cliente de otro cobrador falla `%no está en tu ruta%`;
    - sin registro de cobrador falla;
    - por transferencia queda `en_calle = false`.
  - **Cierre:** con un abono `en_calle` del período, `close_caja_session` da el mismo esperado que sin él (el `breakdown` no lo cuenta).
  - **Entrega:**
    - con un esperado de 1,000 y 950 recibidos, la diferencia es −50;
    - los abonos quedan con `settlement_id`;
    - hay un movimiento `in` de 950 en la sesión abierta;
    - una segunda entrega falla con el mensaje;
    - con la caja de la sucursal apagada, la entrega pasa sin movimiento.
  - **Anulaciones:**
    - antes de entregar: no exige caja y no crea movimiento;
    - después de entregar: crea el movimiento `out`.
  - **Visitas:**
    - la promesa queda con su fecha;
    - otra persona sin cartera falla;
    - con `cobranza-all` pasa.
  - **Abono general:** `p_tipo = 'cliente'` reparte entre sus ventas a crédito, igual que `register_customer_payment`.
  - **Regresión, sin el módulo y sin `app.cobranza`:**
    - abonar en efectivo sin caja abierta sigue fallando;
    - el cierre cuenta los abonos normales;
    - anular un abono del día (sesión abierta) y uno viejo (sesión cerrada) da lo mismo que hoy;
    - correr `desembolso_caja.sql` y el bloque de préstamos de `refinanciacion.sql` con la migración.
- [ ] **Step 3:** Correr sin la migración → falla.
- [ ] **Step 4:** Escribir la migración partiendo de lo volcado (solo las líneas necesarias).
- [ ] **Step 5:** `begin; <Task 1> <esta> <suite> rollback;` → `ok`, más las regresiones.
- [ ] **Step 6:** Commit: `Motopréstamos: cobro en la calle, visitas y entrega del cobrador`.

---

### Task 3: Lógica pura de la ruta y el cuadre

**Files:**
- Create: `src/lib/cobranza.ts`
- Test: `scripts/tests/cobranza.test.mjs`

**Interfaces:**
- Produces:
  - `type CuentaDeCobro = { tipo: 'prestamo' | 'venta'; id: string; customerId: string; branchId: string; pendiente: number; cuota: number; mora: number; diasAtraso: number; venceHoy: boolean; proximaFecha?: string }`.
  - `type Promesa = { customerId: string; fecha: string; monto?: number }`.
  - `type ParadaDeRuta = { customerId: string; cuentas: CuentaDeCobro[]; sugerido: number; diasAtraso: number; motivo: 'atrasado' | 'vence_hoy' | 'promesa'; promesa?: Promesa; orden: number }`.
  - `rutaDelDia(cuentas: CuentaDeCobro[], asignados: { customerId: string; orden: number }[], promesas: Promesa[], hoy: string, ordenarPor: 'orden' | 'atraso'): ParadaDeRuta[]`:
    - solo clientes asignados que tengan algo atrasado, que venza hoy o una promesa con fecha hoy;
    - el sugerido de cada cuenta es cuota + mora (o el pendiente si es menor), sumado por cliente;
    - el motivo dominante es atrasado > vence_hoy > promesa;
    - por orden se ordena por `orden` y después por nombre; por atraso, de más a menos días.
  - `resumenDelCobrador(abonos: { monto: number; metodo: 'cash' | 'transfer'; enCalle: boolean; entregado: boolean; anulado: boolean; fecha: string }[], hoy: string)` → `{ cobradoHoy: number; enMano: number; enManoDesde?: string }`. `enMano` es el efectivo en calle sin entregar y no anulado.
  - `TEXTO_RESULTADO: Record<ResultadoVisita, string>`: «Pagó», «No estaba», «No tenía», «Prometió pagar», «Se negó», «La moto no aparece».
- [ ] **Step 1: Pruebas:**
  - cliente atrasado con cuota 650 y mora 45 → sugerido 695 y motivo atrasado;
  - una cuota de hoy → vence_hoy;
  - una promesa de hoy sin nada atrasado → promesa, con su monto;
  - cliente no asignado → fuera;
  - nada pendiente → fuera;
  - pendiente menor que la cuota → sugerido = pendiente;
  - los dos órdenes;
  - en mano: suma solo efectivo en calle sin entregar y no anulado; cobrado hoy suma todo lo de hoy.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit: `Motopréstamos: reglas de la ruta y del cuadre`.

---

### Task 4: Datos y permisos en el front

**Files:**
- Modify: `src/lib/permissions.ts` (`cobranza`, `cobranza-all`, `cobranza-cuadre` y `RESOURCE_MODULE`), `src/lib/types.ts` (`PermissionResource`, tipos de cobranza), `src/lib/supabase/mappers.ts`, `src/app/(app)/authed-layout.tsx` (menú)
- Create: `src/hooks/use-cobranza.ts`
- Test: `scripts/tests/motos.test.mjs` (los permisos nuevos son del módulo)

**Interfaces:**
- Produces: `useCobranza(branchId?)` → `{ cobradores, asignaciones, visitasRecientes, abonosSinEntregar, miCobrador, loading, reload, registrarAbono(...), registrarVisita(...), recibirEntrega(collectorId, recibido, nota), asignar(customerIds, collectorId), quitarAsignacion(customerIds), ordenar(customerId, orden), marcarCobrador(profileId, activo) }`.
- **Menú:**
  - «Cobranza» (`/motos/cobranza`, `cobranza`);
  - «Asignar cartera» (`/motos/cobranza/asignar`, `cobranza-all`);
  - «Cuadre de cobradores» (`/motos/cobranza/cuadre`, `cobranza-cuadre`).
- [ ] **Step 1:** Prueba: los tres recursos existen y son del módulo `motoprestamos`. Correr → FAIL. Implementar → PASS.
- [ ] **Step 2:** Tipos, mappers, hook y menú. `npx tsc --noEmit`.
- [ ] **Step 3:** Commit: `Motopréstamos: datos y permisos de cobranza`.

---

### Task 5: Pantallas de la cobranza

**Files:**
- Create:
  - `src/app/(app)/motos/cobranza/page.tsx` (ruta), `src/app/(app)/motos/cobranza/asignar/page.tsx`, `src/app/(app)/motos/cobranza/cuadre/page.tsx`
  - `src/components/motos/cobranza/cobrar-dialog.tsx`, `visita-dialog.tsx`, `entrega-dialog.tsx`
  - `src/components/motos/config/cobradores-tab.tsx`
- Modify: `src/app/(app)/motos/config/page.tsx` (pestaña Cobradores)

- [ ] **Step 1: Ruta** (móvil primero; diseño en el spec):
  - **Encabezado:** por cobrar, cobrado hoy y en mano.
  - **Lista** con `rutaDelDia`. Cada tarjeta lleva nombre y apodo, zona o parada, la dirección de cobro con su referencia, la moto (placa) si tiene, el sugerido, los días de atraso o la promesa, y los botones **Cobrar**, **No pagó**, **WhatsApp** (abre el chat) y **Llamar** (`tel:`).
  - Un selector cambia el orden (visita o atraso).
  - Con `cobranza-all`, un selector de cobrador para ver otras rutas.
- [ ] **Step 2: Cobrar.**
  - **Qué se cobra:** cada préstamo, cada venta, o «Abono general» si tiene más de una venta.
  - **Datos:** monto (sugerido precargado; acepta comas con `parseMonto`), efectivo o transferencia con referencia.
  - Al terminar muestra lo aplicado y el saldo. El error de la base se muestra tal cual.
- [ ] **Step 3: No pagó.** Resultado de la visita, fecha y monto de la promesa, y nota.
- [ ] **Step 4: Asignar cartera.**
  - **Lista:** clientes con cuentas abiertas en la sucursal, filtrables por zona, atraso y «sin asignar».
  - **Acciones:** selección múltiple → asignar a un cobrador o quitar. Orden de visita editable.
- [ ] **Step 5: Cuadre.**
  - **Lista:** por cobrador, los abonos en efectivo sin entregar (cliente, cuenta, monto, fecha) con su total.
  - **Recibir entrega:** el usuario declara lo recibido; se muestra la diferencia antes de confirmar.
  - **Historial:** las entregas recientes, con esperado, recibido y diferencia.
- [ ] **Step 6: Configuración → Cobradores.** Usuarios de la sucursal con un interruptor «Es cobrador» (como los técnicos del Taller), con un aviso si el usuario no tiene el rol Cobrador.
- [ ] **Step 7:** `npx tsc --noEmit`; commit: `Motopréstamos: ruta, cobro, asignación y cuadre`.

---

### Task 6: Revisión, aplicar, probar en pantalla y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit`, `next build`.
- [ ] **Step 2: Revisión final** de toda la rama (subagente opus) y un pase de arreglos con prueba que falla primero.
- [ ] **Step 3: Aplicar.**
  - Las huellas tienen que coincidir.
  - Aplicar las dos migraciones con `apply_migration`. Son compatibles con el front de producción: columnas nuevas con default, funciones que solo cambian con `en_calle` o `app.cobranza`.
  - Correr las suites contra lo aplicado (`cobranza.sql`, `desembolso_caja.sql` y el bloque de préstamos de `refinanciacion.sql`), `get_advisors` y revisar que los logs no tengan `42501`.
- [ ] **Step 4: En pantalla** (demo; módulo y caja de prueba como en 2B/2C):
  - marcar un cobrador;
  - asignar un cliente con un préstamo de prueba;
  - ver la ruta;
  - cobrar por transferencia (no emite e-CF);
  - anotar una visita;
  - el cuadre, si hay un abono en efectivo de prueba.
  - Al terminar, borrar todo lo de prueba.
- [ ] **Step 5:** Spec con el estado de 3A, commit, push, PR. La base es `claude/motoprestamos-entrega-2c`, o `main` si ya se fusionó. No fusionar sin Louis.
