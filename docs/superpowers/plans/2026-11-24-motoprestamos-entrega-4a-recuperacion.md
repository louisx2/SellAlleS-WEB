# Motopréstamos · Entrega 4A (recuperación de motos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el negocio recupere la moto cuando el cliente deja de pagar:
- la vendida a cuotas vuelve al inventario como usada y el saldo se da de baja;
- la que está en garantía de un préstamo se incauta, se devuelve o se liquida;
- un reporte muestra qué se recuperó y cuánto se perdió.

**Architecture:**
- **Registro:** cada recuperación es una fila de `vehicle_recoveries`.
- **RPC:** cuatro funciones con `security definer`: `motos_incautar`, `motos_devolver_garantia`, `motos_liquidar_garantia` y `motos_recuperar_venta`.
  - Cambian el estado de la moto con el mecanismo de siempre: `motos.sistema`, `motos.evento` y `motos.nota`, que leen `vehicles_before` y `vehicles_after`.
  - El dinero va por las RPC de abonos de siempre y por movimientos de caja.
- **Venta recuperada:** se cierra con `payment_status = 'paid'`, más `recovered_at` y `written_off_amount`.
  - Así sale de todo lo abierto (Cuentas por Cobrar, ruta, mora, saldo del cliente, reportes) sin un estado nuevo que obligue a tocar cada filtro.
  - La pantalla la muestra como «Recuperada», no como «Pagada».
- **Dación en pago** (el negocio se queda la moto incautada): un abono al préstamo con método nuevo `dacion`.
  - No es efectivo, así que la caja no lo cuenta.
  - Solo lo puede usar la RPC de liquidar, igual que `app.cobranza` en 3A.

**Tech Stack:** Next 14 (export estático), TypeScript, Supabase/Postgres, `node --test`, suites SQL en `begin … rollback`.

**Spec:** `docs/superpowers/specs/2026-11-23-motoprestamos-design.md`, "Entrega 4 — Recuperación". La entrega 4 se parte en:
- **4A** (este plan): incautar, devolver y liquidar la garantía (las dos formas), recuperar la moto vendida dando de baja el saldo, y el reporte.
- **4B:** al recuperar una venta, la opción de emitir una **nota de crédito parcial** (B04/E34, con su e-CF) por lo no pagado. Va en un plan aparte, después de estudiar cómo `annul_sale` y `ecf-emitir` hacen hoy la nota de crédito de la venta completa.

Louis (2026-11-24) pidió que se puedan **las dos** formas en los dos casos:
- **Venta:** dar de baja el saldo (4A) o nota de crédito parcial (4B).
- **Garantía:** vender a un tercero y abonar lo obtenido, o que el negocio se quede la moto (dación en pago).

Base: rama `claude/motoprestamos-entrega-3b` (PR #86).

## Decisiones de este plan (para que Louis las revise)

- **Quién puede:**
  - **Incautar y devolver** (mover la moto al patio y sacarla): permiso `motos` editar.
  - **Liquidar y recuperar una venta** (dan de baja deuda y pueden sacar dinero de la caja): solo el administrador, como anular abonos.
- **Recuperar una venta a cuotas:**
  - **Datos:** fecha, motivo, estado de la moto (texto), **valor de reingreso** (tasación) y, si el negocio le devuelve algo al cliente, el monto y cómo (efectivo sale de la caja abierta; transferencia solo se anota).
  - **La moto:** vuelve a `disponible`, usada, con costo = valor de reingreso, sin cliente ni venta, matrícula `no_aplica`. El stock del artículo sube solo.
  - **La venta:** queda «Recuperada», con el saldo pendiente dado de baja y sin generar mora. Lo cobrado se queda como cobrado. Ya no se puede anular ni recibir abonos.
- **Liquidar la garantía** (moto incautada de un préstamo activo):
  - **Vender a un tercero:** se anota lo obtenido y el método.
    - Hasta la deuda va como abono al préstamo; en efectivo pide caja abierta, como cualquier abono.
    - Lo que sobre se le devuelve al cliente (efectivo: sale de la caja).
    - La moto queda de `baja`, vendida a un tercero.
  - **Se la queda el negocio (dación en pago):** se anota la tasación y a qué artículo-vehículo entra.
    - Hasta la deuda va como abono `dacion`, sin caja.
    - Lo que sobre se le devuelve al cliente.
    - La moto pasa a ser inventario del negocio: `disponible`, usada, costo = tasación. Se vende después por el POS como cualquier otra, con su factura.
  - **Si falta:** el administrador elige dejarlo como **deuda** (el préstamo sigue activo) o **darlo de baja** (el préstamo queda `cancelled` con `written_off_amount`).
- **Devolver** una moto incautada: si el préstamo sigue activo, vuelve a `en_garantia`; si ya se pagó, a `liberado` con la matrícula lista para entregar.
- **Mientras está incautada** el préstamo sigue vivo: genera mora y sale en la ruta.
- **Un abono `dacion` no se anula** desde el préstamo: revertir una dación es deshacer la liquidación, y queda fuera de esta entrega.
- **Reporte «Recuperaciones»** (período, sucursal activa): una fila por recuperación con fecha, moto, cliente, tipo, estado, deuda al recuperar, recuperado, dado de baja, devuelto y resultado.
  - **Recuperado:** el valor de reingreso, o lo aplicado al préstamo.
  - **Resultado:** recuperado − dado de baja − devuelto.

## Global Constraints

- **Tabla nueva `vehicle_recoveries`:**
  - **Columnas:**
    - `id`, `company_id`, `branch_id`, `vehicle_id`;
    - `kind` (`venta` | `garantia`);
    - `sale_id`, `loan_id`;
    - `status` (`incautada` | `devuelta` | `liquidada` | `recuperada`);
    - `recovered_on date`, `reason`, `condition_note`;
    - `debt_at_recovery`, `reentry_value`, `written_off`, `refunded`, `refund_method`;
    - `liquidation_mode` (`tercero` | `dacion`), `proceeds`, `applied`, `shortfall_action` (`deuda` | `baja`), `payment_id`;
    - `note`, `created_by`, `created_by_name`, `created_at`, `closed_at`.
  - **Reglas:** `revoke all` antes de los grants; RLS de lectura por empresa con permiso `motos` ver (`motos_tiene_permiso`), y escritura solo por las RPC; `trg_bloquear_empresa_suspendida`.
  - **PostgREST:** sin restricciones únicas con FK a `companies` y `branches` a la vez.
- **Columnas nuevas:** `sales.recovered_at timestamptz`, `sales.written_off_amount numeric(14,2)` y `loans.written_off_amount numeric(14,2)`.
- **`vehicle_events.kind`** suma `incautacion`, `devolucion`, `liquidacion` y `recuperacion` (rehacer el check con los valores vivos más estos).
- **`loan_payments.method`** suma `dacion` (rehacer el check). `register_loan_payment` acepta `dacion` solo con `current_setting('app.motos_dacion', true) = 'on'`; si no, `Método de pago no válido.` como hoy.
- **Funciones vivas que cambian** (desde `pg_get_functiondef`, con huella anotada en la migración):
  - `register_loan_payment`, huella viva `5191136b…` (solo la validación del método);
  - `void_loan_payment`, la versión de 3A (rechaza `dacion` con `Este abono es una dación en pago: se revierte desde la ficha de la moto.`).
  - Nada más de lo vivo cambia; `annul_sale` no se toca.
- **Venta recuperada no se anula:** un trigger nuevo `before update of cancelled_at on sales` rechaza con `Esta venta se recuperó: no se puede anular.` si `old.recovered_at is not null`.
- **Orden dentro de `motos_recuperar_venta`:** primero se suelta la moto (`sale_id = null`) y después se pone la venta en `paid`. Así `motos_venta_saldada` no encuentra moto y no marca la matrícula como lista para entregar.
- **Deuda de un préstamo:** lo máximo que `register_loan_payment` acepta, mora incluida. Se lee su cálculo en la definición viva y se reutiliza (o se replica en `motos_deuda_prestamo(p_loan_id) returns numeric`, probado contra el mensaje `excede la deuda pendiente (RD$X)`).
- **Deuda de una venta:** la misma fórmula que `recompute_customer_balance`. Después de recuperar se llama a `recompute_customer_balance`.
- **Caja:** una devolución o un sobrante en efectivo es un movimiento `out` en la caja abierta de la sucursal (si la sucursal usa caja; si no, solo se anota).
  - Motivos: `Devolución al cliente por recuperación: <cliente>` y `Sobrante de la garantía: <cliente>`.
  - Sin caja abierta: `Abre la caja de esta sucursal para devolver el dinero.`
- **Mensajes:**
  - `Esta moto no está en garantía de un préstamo activo.`
  - `Esta moto no está incautada.`
  - `Esta moto no está vendida a crédito con saldo pendiente.`
  - `Solo un administrador puede liquidar una garantía o recuperar una venta.`
  - `El artículo tiene que ser un artículo-vehículo de la misma sucursal.`
- **Front:**
  - `LoanPaymentMethod = PaymentMethod | 'dacion'`, con etiqueta «Dación en pago» donde se listan abonos de préstamo.
  - «Recuperada» donde se muestra el estado de la venta.
  - Sin dependencias nuevas.
- **Empresa demo:** `…0aa`, sucursal `…0b1`, súper admin `92381752-…`. La demo emite e-CF: en pantalla no se cobra ni se vende; la venta y el préstamo de prueba se crean por SQL y se borran.

## Review Focus

1. **Venta recuperada fuera de todo lo abierto:** no sale en Cuentas por Cobrar, la ruta, Avisos, Antigüedad, el saldo del cliente ni el portal, y no genera mora. → Task 2 (suite: saldo del cliente, `cobranza_reporte`) y Task 5 (pantalla).
2. **La matrícula no queda «lista para entregar» al recuperar** (`motos_venta_saldada`). → Task 2.
3. **Caja:**
   - la devolución o el sobrante en efectivo sale de la caja abierta;
   - el abono `dacion` no entra al cierre;
   - un abono en efectivo de la liquidación sí entra, como cualquier abono de oficina.
   → Task 2.
4. **Deuda con mora:** liquidar por más que la deuda no falla en `register_loan_payment`: aplica la deuda exacta y el resto es sobrante. → Task 2.
5. **Empresas sin el módulo** (Pujols, Delmas): abonar, anular abonos y anular ventas da lo mismo que hoy. → Task 2 (regresión).

---

### Task 1: Migración — registro, columnas y estados

**Files:**
- Create: `supabase/migrations/20261126120000_motos_recuperacion_base.sql`
- Create: `supabase/tests/motos_recuperacion.sql` (§1)

**Interfaces:**
- Produces: `vehicle_recoveries`, las columnas nuevas, los checks ampliados y el trigger `trg_venta_recuperada_no_se_anula`.
- [ ] **Step 1: Suite §1:**
  - una fila en `vehicle_recoveries` con `kind` o `status` inválidos falla;
  - `anon` no lee la tabla;
  - `authenticated` no inserta;
  - `vehicle_events` acepta `recuperacion`;
  - `loan_payments` acepta `method = 'dacion'` en un insert directo (el check);
  - una venta con `recovered_at` no se puede anular (`update sales set cancelled_at = now()` falla con el mensaje);
  - las filas vivas de `loan_payments` y `vehicle_events` cumplen los checks nuevos (`count(*) = 0` de las que no).
- [ ] **Step 2:** Correr sin la migración → falla.
- [ ] **Step 3:** Migración con grants y RLS. Los checks se rehacen leyendo los valores vivos.
- [ ] **Step 4:** `begin; <esta> <suite §1> rollback;` → `ok`.
- [ ] **Step 5:** Commit: `Motopréstamos: registro de recuperaciones, columnas y estados`.

### Task 2: Migración — incautar, devolver, liquidar y recuperar

**Files:**
- Create: `supabase/migrations/20261126130000_motos_recuperacion_rpc.sql`
- Modify: `supabase/tests/motos_recuperacion.sql` (§2)

**Interfaces:**
- Consumes: Task 1.
- Produces (todas `security definer`, `search_path = public`; grants a `authenticated` y `service_role`, nada a `anon`):
  - `motos_incautar(p_vehicle_id uuid, p_fecha date, p_motivo text, p_nota text default null) returns uuid` (id de la recuperación);
  - `motos_devolver_garantia(p_vehicle_id uuid, p_nota text default null) returns void`;
  - `motos_liquidar_garantia(p_vehicle_id uuid, p_modo text, p_monto numeric, p_metodo text default 'cash', p_product_id uuid default null, p_faltante text default 'deuda', p_referencia text default null, p_nota text default null) returns jsonb` → `{ recovery_id, deuda, aplicado, sobrante, faltante, payment_id }`;
  - `motos_recuperar_venta(p_vehicle_id uuid, p_fecha date, p_motivo text, p_estado text, p_valor_reingreso numeric, p_devolucion numeric default 0, p_devolucion_metodo text default 'cash', p_nota text default null) returns jsonb` → `{ recovery_id, deuda, devuelto }`;
  - `register_loan_payment` y `void_loan_payment` con los cambios de Global Constraints.
- [ ] **Step 1: Volcar lo vivo y huellas:** `register_loan_payment`, `void_loan_payment`, `motos_venta_saldada`, `motos_prestamo_estado`, `vehicles_before`, `vehicles_after` y `recompute_customer_balance`. Las cinco últimas se leen, no se cambian.
- [ ] **Step 2: Suite §2** (préstamo semanal de prueba con moto en garantía, creado como en `motos_garantia.sql`; venta financiada de prueba con moto; caja de b1 encendida con sesión abierta):
  - **incautar:** moto `recuperado`, préstamo sigue activo, evento `incautacion`; incautar dos veces falla; un cajero sin `motos` editar falla;
  - **devolver** con el préstamo activo → `en_garantia`;
  - **devolver** después de saldar el préstamo → `liberado` y matrícula lista;
  - **liquidar a un tercero:**
    - por **menos** de la deuda con `deuda`: el préstamo sigue activo con el resto y la moto queda `baja`;
    - con `baja`: el préstamo queda `cancelled` y `written_off_amount` = faltante;
    - por **más** de la deuda en efectivo: se aplica la deuda exacta (mora incluida), el préstamo queda `paid` y el sobrante es un movimiento `out` en la sesión abierta;
  - **liquidar por dación:**
    - abono `dacion` por la tasación;
    - la moto queda `inventario`/`disponible`/usada, con costo = tasación, sin cliente ni préstamo, y el stock del artículo sube 1;
    - el cierre de caja no cuenta el abono `dacion`;
    - anularlo falla con el mensaje;
    - un artículo que no es vehículo falla;
  - **`register_loan_payment(…, 'dacion', …)`** llamado directo (sin `app.motos_dacion`) falla `%Método de pago no válido%`;
  - **recuperar la venta:**
    - la moto queda `disponible`, usada, con costo = reingreso, sin venta, y el stock sube 1;
    - la venta queda `paid`, con `recovered_at` y `written_off_amount` = deuda;
    - el saldo del cliente baja a 0 en esa venta;
    - la matrícula **no** queda lista para entregar;
    - un abono a la venta falla (`ya está saldada`);
    - anularla falla;
    - la devolución en efectivo es un `out` en la caja;
    - sin caja abierta, la devolución en efectivo falla con el mensaje;
  - **`cobranza_reporte`:** la venta recuperada ya no suma atrasados;
  - **permisos:** un usuario que no es admin no puede liquidar ni recuperar.
  - **Regresión:** `desembolso_caja.sql`, la §2 de `cobranza.sql` y el bloque de préstamos de `refinanciacion.sql` con esta migración.
- [ ] **Step 3:** Correr sin la migración → falla.
- [ ] **Step 4:** Escribir la migración desde lo volcado (solo las líneas necesarias en las dos funciones vivas).
- [ ] **Step 5:** `begin; <Task 1> <esta> <suite> rollback;` → `ok`, más las regresiones.
- [ ] **Step 6:** Commit: `Motopréstamos: incautar, devolver, liquidar la garantía y recuperar la venta`.

### Task 3: Lógica pura de la recuperación

**Files:**
- Create: `src/lib/motos-recuperacion.ts`
- Test: `scripts/tests/motos-recuperacion.test.mjs`

**Interfaces:**
- Produces:
  - `accionesDeRecuperacion(v: { status: VehicleStatus; origin: 'inventario' | 'garantia'; saleId?: string; loanId?: string }, venta?: { abierta: boolean }, prestamo?: { activo: boolean }, esAdmin?: boolean, puedeEditar?: boolean): ('incautar' | 'devolver' | 'liquidar' | 'recuperar_venta')[]`.
    - `incautar`: en garantía con préstamo activo y `puedeEditar`;
    - `devolver`: `recuperado` de garantía y `puedeEditar`;
    - `liquidar`: `recuperado` de garantía, admin y préstamo activo;
    - `recuperar_venta`: vendida con la venta abierta y admin.
  - `repartoDeLiquidacion(deuda: number, monto: number): { aplicado: number; sobrante: number; faltante: number }`, en centavos exactos.
  - `resultadoDeRecuperacion(r: { recuperado: number; dadoDeBaja: number; devuelto: number }): number`.
  - `TEXTO_ESTADO_RECUPERACION: Record<'incautada' | 'devuelta' | 'liquidada' | 'recuperada', string>`.
- [ ] **Step 1: Pruebas:**
  - cada acción aparece y desaparece según estado, origen, cuenta y permisos;
  - reparto: monto menor, igual y mayor que la deuda; `0.1 + 0.2`;
  - resultado positivo y negativo.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`npm test`).
- [ ] **Step 5:** Commit: `Motopréstamos: reglas de la recuperación`.

### Task 4: Datos en el front

**Files:**
- Modify: `src/lib/types.ts` (`VehicleRecovery`, `Sale.recoveredAt?`, `Sale.writtenOffAmount?`, `Loan.writtenOffAmount?`, `LoanPaymentMethod`), `src/lib/supabase/mappers.ts`, las etiquetas de método donde se listan abonos de préstamo.
- Create: `src/hooks/use-recuperaciones.ts`

**Interfaces:**
- Consumes: Task 2 (RPC), Task 3.
- Produces: `useRecuperaciones(vehicleId?)` → `{ recuperaciones, loading, reload, incautar(...), devolver(...), liquidar(...), recuperarVenta(...) }`. Cada acción llama a su RPC y lanza el error de la base tal cual.
- [ ] **Step 1:** Implementar. `npx tsc --noEmit` (las etiquetas que falten salen como error de tipos).
- [ ] **Step 2:** Commit: `Motopréstamos: datos de la recuperación`.

### Task 5: Pantallas

**Files:**
- Create: `src/components/motos/recuperacion/incautar-dialog.tsx`, `devolver-dialog.tsx`, `liquidar-dialog.tsx`, `recuperar-venta-dialog.tsx`
- Modify: `src/app/(app)/motos/ficha/ficha-client.tsx` (botones según `accionesDeRecuperacion` e historial de recuperaciones), el detalle de la venta (`src/app/(app)/sales/detail/…`: botón «Recuperar vehículo» y aviso «Recuperada», sin botones de cobro), el detalle del préstamo (`/prestamos/detalle`: aviso «Garantía incautada» o «Garantía liquidada») y las listas que muestran el estado de la venta («Recuperada» en vez de «Pagada»).

- [ ] **Step 1: Diálogos.** Los montos aceptan comas (`parseMonto`). El error de la base se muestra tal cual. Sin `Select` de Radix dentro de diálogos: botones con `role="radio"`, como en 3A.
  - **Liquidar:**
    - el modo («Vender a un tercero» / «Se la queda el negocio»);
    - el monto (obtenido o tasación);
    - el método (tercero) o el artículo-vehículo (dación);
    - debajo, en vivo, el reparto con `repartoDeLiquidacion` contra la deuda del préstamo;
    - si hay faltante, «Dejarlo como deuda» o «Darlo de baja».
  - **Recuperar venta:**
    - fecha, motivo, estado de la moto y valor de reingreso;
    - la deuda que se da de baja;
    - «¿Se le devuelve algo al cliente?» con monto y método.
  - **Al terminar:** toast, se cierra el diálogo y se recarga la ficha.
- [ ] **Step 2:** `npx tsc --noEmit`; commit: `Motopréstamos: pantallas de la recuperación`.

### Task 6: Reporte de recuperaciones

**Files:**
- Create: `src/app/(app)/reports/recuperaciones/page.tsx`
- Modify: `src/lib/permissions.ts` (`REPORT_ITEMS` suma `recuperaciones`), `src/app/(app)/authed-layout.tsx` (ítem y filtro por módulo), `src/app/(app)/reports/page.tsx` (tarjeta con el módulo)
- Test: `scripts/tests/motos.test.mjs` (el slug está en `REPORT_ITEMS`)

- [ ] **Step 1:** Prueba del slug → FAIL → agregar → PASS.
- [ ] **Step 2:** Página:
  - **Filtro:** período (`PeriodoSelector` de 3B).
  - **Lectura:** `vehicle_recoveries` de la sucursal activa (con `fetchAllRows`) y la moto y el cliente de cada una.
  - **Tabla:** fecha, moto, cliente, tipo, estado, deuda al recuperar, recuperado, dado de baja, devuelto y resultado (`resultadoDeRecuperacion`), con totales.
  - Exportar.
- [ ] **Step 3:** `npx tsc --noEmit`; commit: `Motopréstamos: reporte de recuperaciones`.

### Task 7: Revisión, aplicar, probar en pantalla y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit`, `next build` (sin `next dev` vivo).
- [ ] **Step 2: Revisión final** de toda la rama (subagente opus) y un pase de arreglos con prueba que falla primero.
- [ ] **Step 3: Aplicar:**
  - las huellas de lo vivo tienen que coincidir;
  - aplicar las dos migraciones con `apply_migration`;
  - md5 del cuerpo de cada función contra el archivo;
  - `motos_recuperacion.sql`, `cobranza.sql` y las regresiones contra lo aplicado;
  - `get_advisors` y logs de la API sin `42501`.
- [ ] **Step 4: En pantalla** (demo; módulo encendido solo para la prueba; préstamo con moto en garantía y venta financiada con moto, creados por SQL, sin cobrar ni facturar en pantalla):
  - incautar y devolver;
  - incautar y liquidar por dación;
  - recuperar la venta con una devolución por transferencia;
  - ver la ficha, la venta «Recuperada» y el reporte.
  - Al terminar, borrar todo lo de prueba, apagar el módulo y quitar el rol Cobrador de la demo.
- [ ] **Step 5:** Estado de 4A en el spec; commit, push y PR. La base es `claude/motoprestamos-entrega-3b`, o `main` si ya se fusionó. No fusionar sin Louis.
