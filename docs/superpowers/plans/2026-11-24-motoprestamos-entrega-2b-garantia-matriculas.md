# Motopréstamos · Entrega 2B (garantía en préstamos, matrículas y datos del cliente) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prestar con la moto del cliente en garantía, llevar las matrículas en custodia hasta entregarlas cuando la deuda se salda, y guardar los datos del cliente que necesita este negocio (zona, lugar de trabajo, garantes y referencias).

**Architecture:** Se monta sobre 2A sin tocar el motor de cuotas. El préstamo con garantía se crea con una RPC (`motos_crear_prestamo`) que inserta el préstamo y el vehículo en una sola transacción. Lo demás son **triggers** sobre `loans` y `sales` que solo actúan si hay vehículos enlazados: al saldar se libera la moto y la matrícula queda lista para entregar, al anular el abono que saldó vuelve atrás, y al refinanciar la moto pasa al préstamo nuevo. Así `register_loan_payment`, `void_loan_payment`, `refinance_loan`, `register_sale_payment` y `void_credit_payment` no se tocan.

**Tech Stack:** Next 14 (export estático), TypeScript, Supabase/Postgres, `node --test`, suites SQL en `begin … rollback`.

**Spec:** `docs/superpowers/specs/2026-11-23-motoprestamos-design.md`, "Entrega 2 — Módulo base", secciones *Motos del cliente: préstamo con garantía*, *Matrículas en custodia*, *Datos del cliente para este negocio* y *Reportes de la entrega 2* (Cartera y Matrículas). Base: rama `claude/motoprestamos-entrega-2` (2A, PR #82 sin fusionar); esta rama sale de ahí.

## Decisiones de este plan (para que Louis las revise)

- **`vehicles.loan_id` en lugar de la tabla `loan_collaterals`.** Una moto respalda un solo préstamo a la vez, igual que `sale_id` para la venta; el historial de préstamos de cada moto queda en `vehicle_events.loan_id`. Un préstamo puede seguir teniendo varias motos (varias filas con el mismo `loan_id`); la pantalla maneja una.
- **El préstamo sin garantía sigue por el insert de hoy.** La RPC nueva solo se usa cuando hay garantía, para no mover el camino que ya usan Pujols y Delmas.
- **Quien puede crear el préstamo puede registrar su garantía**, aunque no tenga `motos:create`: la moto es parte del préstamo.
- **La moto en garantía tiene que ser de la misma sucursal del préstamo.** Una moto ya registrada se puede reutilizar si es del mismo cliente y está `liberado`, o `vendido` con la venta saldada.
- **Anular el abono que saldó:** la moto vuelve a `en_garantia` y la matrícula a `en_custodia`, salvo que la matrícula ya se haya entregado (queda `entregada` y el historial lo dice).
- **Lo que pasa a 2C:** la configuración general (custodia por defecto y "exigir garante"), las fotos de la cédula y de la moto, el contrato y el portal.

## Global Constraints

- Módulo `motoprestamos`. Estados del vehículo y de la matrícula: los de 2A (`disponible · vendido · en_garantia · recuperado · liberado · baja`; `en_custodia · lista_para_entregar · entregada · no_aplica`).
- Cambiar estado, venta, préstamo, matrícula o datos de entrega es **solo del sistema** (`motos.sistema = 'si'`); el usuario edita datos descriptivos y `registration_location`.
- Eventos nuevos de `vehicle_events.kind`: `garantia` (entra como garantía, incluido al refinanciar) y `liberacion` (préstamo saldado o cancelado). La entrega de la matrícula es un evento `matricula` con nota.
- Mensajes:
  - Entregar con deuda: `La deuda de esta moto no está saldada. Solo un administrador puede entregar la matrícula, y con motivo.`
  - Chasis repetido en la garantía: `Ya hay otro vehículo con ese chasis.`
  - Moto ajena o no disponible: `Esa moto no se puede usar como garantía: tiene que ser del cliente y estar liberada o con su venta saldada.`
  - Módulo apagado: `El módulo Motopréstamos está apagado.`
- Funciones cambiadas parten de `pg_get_functiondef` en vivo con huella md5. Huellas al escribir este plan: `vehicles_before` `db33a5f0…`, `vehicles_after` `e97ae771…`. Las funciones de abonos y refinanciación **no se tocan**.
- Grants explícitos: `revoke all … from public, anon, authenticated` en tablas nuevas antes de dar los grants (el proyecto todavía da permisos por defecto a lo nuevo); `revoke execute … from public, anon` en funciones.
- Empresa demo `…0aa`, sucursal `…0b1`, súper admin `92381752-…`. La demo emite e-CF: no cobrar en pantalla sin autorización de Louis.
- Textos en español. Sin dependencias nuevas.

## Review Focus

1. **Empresa sin el módulo** (Pujols, Delmas): crear préstamo, abonar, saldar, anular abono, refinanciar y cobrar ventas a crédito siguen igual. → regresión en Task 2 con un préstamo y una venta sin vehículos.
2. **Anular el abono que saldó:** moto y matrícula vuelven atrás; si la matrícula ya se entregó, sigue entregada. → Task 2.
3. **Refinanciar un préstamo con garantía:** la moto pasa al préstamo nuevo y se libera al saldar ese, no el viejo. → Task 2.
4. **Garantía que falla** (chasis repetido, moto de otro cliente, moto con otro préstamo activo): no queda préstamo creado ni dinero desembolsado. → Task 2.
5. **Entregar matrícula con deuda:** el cajero no puede; el admin solo con motivo. → Task 2 y aviso en Task 8.

---

### Task 1: Migración — datos del cliente

**Files:**
- Create: `supabase/migrations/20261124180000_motos_datos_del_cliente.sql`
- Create: `supabase/tests/motos_clientes.sql`

**Interfaces:**
- Produces (SQL):
  - Columnas nulas en `customers`: `nickname text`, `workplace text` (lugar de trabajo o parada), `zone text` (sector o zona), `collection_address text`, `collection_reference text`.
  - `customer_guarantors(id uuid pk, company_id default current_company_id(), customer_id not null references customers on delete cascade, name text not null check (btrim(name) <> ''), id_doc text, phone text, address text, relationship text, created_at)`.
  - `customer_references(id, company_id, customer_id …, name not null, phone text, relationship text, created_at)`.
  - RLS de las dos tablas: `company_id = current_company_id() and exists (select 1 from customers c where c.id = customer_id)` (hereda lo que el usuario ve de clientes), o súper admin. Trigger `trg_bloquear_empresa_suspendida`. Índice por `customer_id`.

- [ ] **Step 1: Suite** (UUIDs `…e3XX`; encabezado y `debe_fallar` como `refinanciacion.sql`; termina en `select 'ok'`):
  - Cliente de la demo con apodo, zona y dirección de cobro.
  - Dos garantes y una referencia; garante sin nombre falla.
  - Borrar el cliente borra sus garantes y referencias.
  - `has_table_privilege('anon', 'public.customer_guarantors', 'SELECT')` es false.
  - Con los claims de un usuario de otra empresa no se ve ningún garante.
- [ ] **Step 2:** Correr sin la migración → falla (tabla inexistente).
- [ ] **Step 3:** Escribir la migración.
- [ ] **Step 4:** `begin; <migración> <suite> rollback;` → `ok`.
- [ ] **Step 5:** Commit: `Motopréstamos: datos del cliente, garantes y referencias`.

---

### Task 2: Migración — garantía en préstamos y matrículas

**Files:**
- Create: `supabase/migrations/20261124190000_motos_garantia_y_matriculas.sql`
- Create: `supabase/tests/motos_garantia.sql`

**Interfaces:**
- Consumes: tablas y funciones de 2A.
- Produces (SQL):
  - `vehicles`: `loan_id uuid references loans(id) on delete set null` (índice parcial); `registration_delivered_to text`, `registration_delivered_doc text`, `registration_delivered_at timestamptz`, `registration_delivered_by_name text`. `vehicle_events`: `loan_id uuid references loans(id) on delete set null`; el CHECK de `kind` suma `garantia` y `liberacion`.
  - `vehicles_before` (desde lo vivo): `loan_id` y los cuatro campos de entrega pasan a ser solo del sistema. Se mantiene la excepción del FK puesto en null, igual que con `sale_id`: un `loan_id` que queda nulo porque el préstamo se borró está permitido.
  - `vehicles_after` (desde lo vivo): el evento `matricula` usa `current_setting('motos.nota', true)` como nota, y todos los eventos guardan `loan_id`.
  - `motos_crear_prestamo(p_prestamo jsonb, p_garantia jsonb) returns uuid`, security definer:
    - **Préstamo:** `p_prestamo` lleva las mismas claves que manda `loanToRow`. El acceso a la sucursal se comprueba igual que en `register_loan_payment`, y el módulo tiene que estar encendido en `company_modules`. El préstamo se inserta con las columnas de siempre, así que los triggers de cuotas y desembolso hacen lo de hoy.
    - **Moto nueva:** `p_garantia.vehiculo` trae los campos de la ficha, con chasis obligatorio y condición `usado` por defecto. Se inserta con origen `garantia`, el cliente y la sucursal del préstamo.
    - **Moto ya registrada:** si en cambio viene `p_garantia.vehicle_id`, se bloquea con `for update` y se valida con la regla del mensaje "Esa moto no se puede usar…".
    - **Al final:** con `motos.sistema` y `motos.evento = 'garantia'` deja la moto en `en_garantia` y enlaza el `loan_id`. La matrícula queda `en_custodia` si `p_garantia.matricula_en_custodia` es true y `no_aplica` si no, y se guardan `registration_location` y `registration_since = now()`. Los datos de entrega se limpian.
  - `motos_prestamo_estado()`, trigger `after update of status on loans`, cuando el estado cambia:
    - a `paid` o `cancelled`: las motos `en_garantia` de ese préstamo pasan a `liberado` (evento `liberacion`), y su matrícula, si estaba `en_custodia`, a `lista_para_entregar`;
    - de `paid` a `active`: vuelven `liberado` → `en_garantia` y `lista_para_entregar` → `en_custodia`, con la nota `Se anuló un abono`;
    - a `refinanced`: nada.
  - `motos_prestamo_refinanciado()`, trigger `after insert on loans when (new.refinanced_from_id is not null)`: las motos `en_garantia` del préstamo viejo pasan al nuevo (evento `garantia`, nota `Refinanciación`).
  - `motos_venta_saldada()`, trigger `after update of payment_status on sales when (old.payment_status is distinct from new.payment_status)`. Sale enseguida si la venta está anulada o no tiene motos (índice `vehicles_sale_idx`).
    - Al pasar a `paid`, la matrícula de las motos `vendido` de esa venta pasa de `en_custodia` a `lista_para_entregar`.
    - Al salir de `paid`, vuelve de `lista_para_entregar` a `en_custodia`.
  - `motos_entregar_matricula(p_vehicle_id uuid, p_recibe text, p_cedula text, p_motivo_forzado text default null) returns void`, security definer:
    - Exige `motos_tiene_permiso(branch_id, 'motos', 'edit')` y el nombre de quien recibe.
    - Con `lista_para_entregar`, entrega.
    - Con `en_custodia`, solo un admin de la empresa o el súper admin y con motivo; si no, el mensaje de "La deuda… no está saldada".
    - Con otro estado, `Esa matrícula no está en custodia.`
    - Deja `entregada` con los datos de entrega y la nota `Entregada a <nombre> (<cédula>)`, más `· Forzada: <motivo>` si fue forzada.
  - Grants: `motos_crear_prestamo` y `motos_entregar_matricula` a `authenticated, service_role`; los triggers sin execute para `anon` ni `authenticated`.

- [ ] **Step 1: Volcar lo vivo y huellas** de `vehicles_before` y `vehicles_after`; deben coincidir con las de las Global Constraints.
- [ ] **Step 2: Suite** (UUIDs `…e4XX`; préstamos con desembolso por transferencia para no depender de la caja):
  - **Garantía nueva:** préstamo con moto nueva y matrícula en custodia. El préstamo existe con sus cuotas; la moto queda `en_garantia`, de origen `garantia`, con `loan_id` y matrícula `en_custodia`; hay evento `garantia`.
  - **Garantía que falla:** con un chasis repetido, falla `%otro vehículo con ese chasis%` y no queda préstamo de ese cliente (`count(*) = 0`). También fallan una moto de otro cliente, una moto `en_garantia` de otro préstamo activo y el módulo apagado.
  - **Saldar el préstamo:** con `register_loan_payment` por el total, la moto pasa a `liberado`, la matrícula a `lista_para_entregar` y hay evento `liberacion`.
  - **Anular el abono:** `void_loan_payment` devuelve la moto a `en_garantia` y la matrícula a `en_custodia`. Con la matrícula ya entregada, anular deja la matrícula `entregada` y la moto `en_garantia`.
  - **Refinanciar:** con `refinance_loan`, la moto queda con el `loan_id` del nuevo y sigue `en_garantia`. Saldar el nuevo la libera.
  - **Reusar una moto:** una moto `liberado` del mismo cliente sirve para un préstamo nuevo y vuelve a `en_garantia` con datos de entrega vacíos.
  - **Venta saldada:** una venta a crédito de una moto de inventario (con el gancho de 2A) deja la matrícula `en_custodia`. Al abonarla completa con `register_sale_payment` pasa a `lista_para_entregar`, y `void_credit_payment` la devuelve a `en_custodia`.
  - **Entrega de la matrícula:**
    - Lista para entregar: el usuario con permiso la entrega, con nombre y cédula guardados y evento con nota.
    - En custodia y usuario sin rol de admin (claims de un cajero de la demo): falla `%no está saldada%`.
    - Admin sin motivo: falla. Admin con motivo: pasa y la nota dice `Forzada`.
    - Sin nombre: falla.
  - **El cliente no cambia lo del sistema:** `update vehicles set loan_id = null` y `set registration_status = 'entregada'` hechos por el cliente fallan `%lo hace el sistema%`.
  - **Regresión:** un préstamo sin moto se crea, se abona, se salda y se anula el abono igual que antes, y no aparece ninguna fila en `vehicle_events`. Igual con una venta a crédito sin moto. `motos_vehiculos.sql` y `motos_venta.sql` pasan con esta migración.
- [ ] **Step 3:** Correr sin la migración → falla.
- [ ] **Step 4:** Escribir la migración.
- [ ] **Step 5:** `begin; <migración Task 1> <esta> <suite> rollback;` → `ok`, y las dos suites de 2A.
- [ ] **Step 6:** Commit: `Motopréstamos: préstamo con garantía y matrículas en custodia`.

---

### Task 3: Lógica pura de garantía y matrículas

**Files:**
- Modify: `src/lib/motos.ts`, `src/lib/motos-reportes.ts`
- Test: `scripts/tests/motos.test.mjs`

**Interfaces:**
- Produces:
  - `vehiculosParaGarantia<V extends { customerId?: string; status: VehicleStatus; branchId: string }>(vehicles: V[], customerId: string, branchId: string): V[]`: del cliente y la sucursal, `liberado` o `vendido`. La venta saldada la valida la base.
  - `entregaDeMatricula(v: { registrationStatus: RegistrationStatus }, esAdmin: boolean): { puede: boolean; forzada: boolean; aviso: string | null }`. Con `lista_para_entregar`: puede, no forzada. Con `en_custodia` y admin: puede, forzada, con aviso "Tiene deuda pendiente: se entregará como forzada y hay que escribir el motivo.". Con `en_custodia` y sin admin: no puede, con el mensaje de las Global Constraints. Con cualquier otro estado: no puede.
  - `diasDesde(fecha: Date, hoy: Date): number` (días enteros de calendario).
  - `matriculasPorPestana<V>(vehicles: V[]): { enCustodia: V[]; listas: V[]; entregadas: V[] }`: `listas` va ordenada por `registrationSince` (la más vieja primero) y `entregadas` por `registrationDeliveredAt` (la más reciente primero).
  - `deudaDelVehiculo(v: { saleId?: string; loanId?: string; status: VehicleStatus }, ventas: Map<string, Saldo>, prestamos: Map<string, Saldo>): Saldo | null`, con `type Saldo = { pendiente: number; atrasado: boolean }`. `en_garantia` y `liberado` miran el préstamo; `vendido` mira la venta.
  - `carteraDeVehiculos(vehicles, saldoPorVenta, saldoPorPrestamo = new Map())` suma `prestamosConGarantia: { cantidad; pendiente; atrasados }`, que cuenta cada préstamo **una vez** aunque tenga dos motos.
  - `reporteDeMatriculas(vehicles, desde: Date, hasta: Date, hoy: Date): { enCustodia: number; listas: number; listasMasDe30: number; entregadasEnPeriodo: number }`.
- [ ] **Step 1: Pruebas:**
  - Elegibles: cliente correcto + `liberado` sí; `vendido` sí; `en_garantia` no; otro cliente no; otra sucursal no.
  - Entrega: los cuatro casos de `entregaDeMatricula`.
  - `diasDesde` cruzando un cambio de mes da los días correctos.
  - Pestañas con su orden.
  - `deudaDelVehiculo`: préstamo, venta y sin cuenta (`null`).
  - Cartera: dos motos del mismo préstamo con saldo 40,000 atrasado dan `{ cantidad: 1, pendiente: 40000, atrasados: 1 }`, y los datos de 2A no cambian.
  - Reporte de matrículas: una lista hace 45 días cuenta en `listasMasDe30`; una entregada fuera del período no cuenta.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`node --test scripts/tests/motos.test.mjs`).
- [ ] **Step 5:** Commit: `Motopréstamos: reglas de garantía y matrículas`.

---

### Task 4: Datos en el front

**Files:**
- Modify: `src/lib/types.ts` (`Customer` + `nickname?`, `workplace?`, `zone?`, `collectionAddress?`, `collectionReference?`; `Vehicle` + `loanId?`, `registrationDeliveredTo?`, `registrationDeliveredDoc?`, `registrationDeliveredAt?: Date`, `registrationDeliveredByName?`; `VehicleEvent.kind` + `'garantia' | 'liberacion'`, `loanId?`; tipos `CustomerGuarantor`, `CustomerReference`), `src/lib/supabase/mappers.ts`, `src/hooks/use-vehiculos.ts`, `src/context/loan-provider.tsx`
- Create: `src/hooks/use-garantes.ts`, `src/hooks/use-saldos-de-vehiculos.ts`

**Interfaces:**
- Produces:
  - `customerToRow` manda los cinco campos nuevos **solo si vienen definidos** (spread condicional como `vehicleToRow`), para que una edición de otra pantalla no los borre.
  - `useVehiculos` suma `entregarMatricula(v: Vehicle, recibe: string, cedula: string, motivoForzado?: string): Promise<void>` y `fetchVehiculosDelCliente(customerId: string): Promise<Vehicle[]>`.
  - `useLoans().addLoanConGarantia(loan: NewLoanInput, garantia: GarantiaInput): Promise<Loan>`, con `type GarantiaInput = { vehicleId?: string; vehiculo?: Partial<Vehicle>; matriculaEnCustodia: boolean; ubicacion?: string }`. Llama a `motos_crear_prestamo` y recarga.
  - `useGarantes(customerId)` → `{ garantes, referencias, loading, addGarante, updateGarante, removeGarante, addReferencia, removeReferencia }`.
  - `useSaldosDeVehiculos()` → `{ ventas: Map<string, Saldo>; prestamos: Map<string, Saldo> }`:
    - de `useSales()`: las financiadas con `calculateFinancingStatus`, y las a crédito con pendiente = total − pagado, sin atraso;
    - de `useLoans()`: los préstamos con `calculateLoanStatus`, usando la mora del perfil como en el reporte de 2A.
- [ ] **Step 1:** Tipos, mappers y hooks. `npx tsc --noEmit` sin errores; `npm test` pasa.
- [ ] **Step 2:** Commit: `Motopréstamos: datos de garantía, matrículas y garantes en el front`.

---

### Task 5: Cliente — datos de cobranza, garantes y referencias

**Files:**
- Modify: `src/components/customers/customer-dialog.tsx`, `src/components/customers/customer-actions.tsx`
- Create: `src/components/customers/garantes-dialog.tsx`

- [ ] **Step 1:** Con el módulo encendido (`isModuleEnabled('motoprestamos')`), el diálogo del cliente muestra la sección **Datos de cobranza**: apodo, lugar de trabajo o parada, sector o zona, dirección de cobro y referencia de la dirección. Sin el módulo no se muestran ni se mandan.
- [ ] **Step 2:** En el menú de acciones del cliente, con el módulo encendido, **Garantes y referencias** abre un diálogo de dos listas:
  - garantes: nombre, cédula, teléfono, dirección y parentesco;
  - referencias: nombre, teléfono y relación.
  - Cada lista se puede agregar, editar y quitar; quitar pide confirmación.
- [ ] **Step 3:** `npx tsc --noEmit`; commit: `Motopréstamos: datos de cobranza y garantes en el cliente`.

---

### Task 6: Préstamo con garantía

**Files:**
- Modify: `src/components/loans/loan-dialog.tsx`, `src/app/(app)/prestamos/detalle/loan-detail-client.tsx`
- Create: `src/components/motos/garantia-fields.tsx`, `src/components/motos/garantia-card.tsx`

- [ ] **Step 1:** Con el módulo encendido, el diálogo **Nuevo préstamo** gana la sección **Garantía**, con el interruptor "Con la moto del cliente en garantía". Encendido:
  - **Moto:** "Registrar moto" (marca, modelo, año, color, chasis obligatorio, motor, placa, número de matrícula y tipo de vehículo) o "Una suya ya registrada" (selector con `vehiculosParaGarantia` sobre `fetchVehiculosDelCliente`).
  - **Matrícula:** "La matrícula queda en custodia" (encendido por defecto) y "Dónde se guarda".
  - **Validación en pantalla:** sin chasis o sin moto elegida, "Prestar" queda deshabilitado con un aviso. Cambiar de cliente vacía la moto elegida.
- [ ] **Step 2:** Con garantía se guarda con `addLoanConGarantia`; sin garantía, con `addLoan` como hoy. El error de la base se muestra tal cual, con el chasis repetido traducido como en 2A.
- [ ] **Step 3:** En el detalle del préstamo, la tarjeta **Garantía** sale si hay motos con ese `loan_id`. Muestra la moto (`vehicleLabel`), el chasis, la placa, el estado de la moto y el de la matrícula, y un enlace a la ficha.
- [ ] **Step 4:** `npx tsc --noEmit`; commit: `Motopréstamos: préstamo con la moto en garantía`.

---

### Task 7: Matrículas y ficha del vehículo

**Files:**
- Create: `src/app/(app)/motos/matriculas/page.tsx`, `src/components/motos/entregar-matricula-dialog.tsx`, `src/components/motos/constancia-entrega.tsx`
- Modify: `src/app/(app)/motos/ficha/ficha-client.tsx`, `src/app/(app)/authed-layout.tsx` (`{ href: '/motos/matriculas', icon: FileCheck, label: 'Matrículas', module: 'motoprestamos', permission: 'motos' }` en `featuresNavItems`, después de Vehículos)

- [ ] **Step 1: `/motos/matriculas`.** Tres pestañas con `matriculasPorPestana`:
  - **En custodia:** moto, chasis, cliente, saldo y "Atrasado" con `deudaDelVehiculo`, dónde se guarda y desde cuándo.
  - **Listas para entregar:** lo mismo más los días que lleva lista.
  - **Entregadas:** a quién, cédula, fecha y quién entregó.
  - En las tres hay búsqueda con `matchesVehicle`, y botón **Entregar** con `motos:edit`.
- [ ] **Step 2: Entregar.** El diálogo pide nombre (obligatorio) y cédula de quien retira, y usa `entregaDeMatricula`:
  - si no puede, el botón queda deshabilitado con el aviso;
  - si es forzada, el motivo es obligatorio.
  - Al entregar, ofrece **Imprimir constancia** con `react-to-print`, como `loan-ticket-dialog`. La constancia lleva empresa, moto, chasis, placa, número de matrícula, cliente, quién la retira y su cédula, fecha, quién entregó y dos líneas de firma.
  - En las entregadas, **Constancia** la reimprime.
- [ ] **Step 3: Ficha.**
  - Tarjeta **Cuenta** con la venta o el préstamo enlazado (enlace), saldo y atraso, usando `useSaldosDeVehiculos`.
  - Bloque **Matrícula** con el estado, dónde se guarda (editable con `motos:edit`), desde cuándo, los datos de entrega y los botones **Entregar** o **Constancia**.
  - Historial con las etiquetas nuevas: `garantia` "En garantía de un préstamo" y `liberacion` "Liberado".
- [ ] **Step 4:** `npx tsc --noEmit`; commit: `Motopréstamos: matrículas en custodia y entrega`.

---

### Task 8: Reportes

**Files:**
- Modify: `src/app/(app)/reports/vehiculos/page.tsx`

- [ ] **Step 1:** **Cartera:** la tarjeta nueva "Préstamos con garantía" muestra cantidad, pendiente y atrasados, desde `carteraDeVehiculos(…, saldoPorPrestamo)`. Los saldos salen de `useSaldosDeVehiculos`, que ahora también cubre las ventas a crédito.
- [ ] **Step 2:** **Matrículas:** una sección con `reporteDeMatriculas` en el período del reporte: en custodia, listas para entregar, listas hace más de 30 días y entregadas en el período. Debajo, la tabla de las listas para entregar, la más vieja primero, con exportar CSV.
- [ ] **Step 3:** `npx tsc --noEmit`; `npm test`; commit: `Motopréstamos: cartera con préstamos y reporte de matrículas`.

---

### Task 9: Aplicar, probar en pantalla y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit` y `next build`.
- [ ] **Step 2: Aplicar.**
  - Las huellas de `vehicles_before`, `vehicles_after`, `register_loan_payment`, `void_loan_payment`, `refinance_loan`, `register_sale_payment` y `void_credit_payment` tienen que coincidir con las del Step 1 de la Task 2. Las de abonos se anotan para probar que no cambiaron.
  - Aplicar las dos migraciones con `apply_migration`. Son compatibles con el front de producción: columnas nulas, tablas nuevas y triggers que no hacen nada sin vehículos.
  - Correr las suites contra lo aplicado, `get_advisors` y revisar que los logs no tengan `42501`.
- [ ] **Step 3: En pantalla** (empresa demo, con la sesión de Louis):
  - **Cliente:** encender el módulo y crear un cliente de prueba con zona y garante.
  - **Préstamo con garantía:** hacerlo con una moto nueva y desembolso por transferencia. Un préstamo no emite e-CF, pero confirmar con Louis antes de crearlo.
  - **Matrícula y ficha:** ver la matrícula en custodia, la ficha con su cuenta y el préstamo con la tarjeta Garantía.
  - **Entrega forzada:** intentar entregar la matrícula y forzarla como admin con motivo; imprimir la constancia en vista previa.
  - **Reporte:** revisarlo.
  - **Al terminar:** borrar todo lo de prueba (préstamo, moto, cliente y la fila del módulo), y dejar `caja_enabled=false` en Principal.
- [ ] **Step 4:** Spec con el estado de 2B, commit, push, PR. La base es `main` si el PR #82 ya está fusionado; si no, `claude/motoprestamos-entrega-2`. No fusionar sin Louis.
