# Motopréstamos · Entrega 1 (motor común) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobro diario (lun–sáb y todos los días), hasta 312 cuotas, desembolso de préstamos por caja y reporte de antigüedad de cartera, para todas las empresas.

**Architecture:** El calendario vive en la frecuencia: dos valores nuevos (`daily`, `daily_all`) que entienden las funciones que ya reciben `p_freq` (fechas, meses, mora, tope), en la base y en su espejo `src/lib/frequency.ts`. El desembolso lo hacen los triggers de `loans` (antes: exige caja; después: movimiento de salida), así vale para el diálogo y la refinanciación. El reporte es una función pura (`src/lib/antiguedad.ts`) sobre los datos que ya cargan los providers.

**Tech Stack:** Next 15 (export estático), TypeScript, Supabase/Postgres (plpgsql), pruebas con `node --test` (scripts/tests/*.test.mjs) y suites SQL en `begin … rollback`.

**Spec:** `docs/superpowers/specs/2026-11-23-motoprestamos-design.md` (sección "Entrega 1 — Motor común").

## Global Constraints

- Frecuencias: `daily` = "Diario (lun–sáb)", `daily_all` = "Diario (todos los días)"; corto `diar.` para las dos; `installmentLabel` → "Cuota Diaria".
- Meses de interés (modo `monthly_prorated`): `daily` n/26, `daily_all` n/30; `weekly` n/4, `biweekly` n/2, `monthly` n (sin cambios). Modo `per_installment`: n.
- Tope de cuotas: `monthly` 60 · `biweekly` 120 · `weekly` 240 · `daily` 312 · `daily_all` 312. Mensaje: `La cantidad de cuotas debe estar entre 1 y <tope>.`
- Período de mora: `daily` y `daily_all` = 1 día.
- Semanal, quincenal y mensual dan **exactamente** lo mismo que hoy (regresión: quincenal 12 al 5% sobre 10,000 → deuda 13,000 y cuota 1,083.33; el mismo en modo por cuota → 16,000).
- Desembolso: `disbursement_method` ∈ `cash` | `transfer` (o nulo en préstamos viejos y en el front viejo que sirve el SW). Movimiento de caja: tipo `out`, monto = `principal − carried_over_amount`, motivo `Desembolso de préstamo: <nombre del cliente>`, `caja_movements.loan_id` = el préstamo.
- Error sin caja: `No hay una caja abierta en esta sucursal. Abre caja antes de entregar el préstamo en efectivo.`
- Tramos de antigüedad: Al día · 1–7 · 8–15 · 16–30 · 31–60 · 61–90 · +90 días, y "Sin plan" para crédito simple.
- Toda función cambiada parte de `pg_get_functiondef` en vivo (nunca del repo) y se comprueba su md5 antes de aplicar. Funciones nuevas: `grant execute … to authenticated, service_role` y `revoke … from public, anon` (SUPABASE.md, "Grants en migraciones nuevas").
- Proyecto Supabase `qwpjclqinruhtxgkrxwr`; empresa demo `00000000-0000-0000-0000-0000000000aa`, sucursal demo `00000000-0000-0000-0000-0000000000b1`, súper admin `92381752-13b2-4f43-8b09-612647754599`.
- Textos de interfaz en español. Sin dependencias nuevas.

## Review Focus

1. Plan diario que arranca sábado o domingo (venta hecha el domingo): la primera cuota cae el lunes. → prueba en Task 1 y Task 2.
2. Front viejo en caché (SW) que crea un préstamo sin `disbursement_method`: sin error y sin movimiento de caja. → prueba en Task 3.
3. Refinanciación sin dinero adicional con método efectivo: sin movimiento. → prueba en Task 3.
4. Caja encendida en la empresa pero apagada en la sucursal: el efectivo se permite y no mueve caja. → prueba en Task 3.
5. Cartera con un cliente que tiene préstamo y financiamiento en tramos distintos: una fila por cliente que suma por tramo. → prueba en Task 7.

---

### Task 1: Calendario y topes en TypeScript

**Files:**
- Modify: `src/lib/frequency.ts`
- Modify: `src/lib/late-fee.ts`
- Create: `src/lib/plan-largo.ts`
- Test: `scripts/tests/frecuencia.test.mjs`

**Interfaces:**
- Produces:
  - `type PaymentFrequency = 'daily' | 'daily_all' | 'weekly' | 'biweekly' | 'monthly'`
  - `const FREQUENCY_OPTIONS: PaymentFrequency[]` = `['daily', 'daily_all', 'weekly', 'biweekly', 'monthly']`
  - `FREQUENCY_LABEL`, `FREQUENCY_SHORT`, `PER_MONTH` con las dos claves nuevas (`PER_MONTH.daily = 26`, `PER_MONTH.daily_all = 30`)
  - `maxInstallments(freq: PaymentFrequency): number`
  - `addPeriods(base: Date, freq: PaymentFrequency, k: number): Date` (con las reglas diarias)
  - `monthsFor(freq, n, mode)` (n/26, n/30 en diario)
  - `installmentLabel(freq)` → `'Cuota Diaria'` en las dos diarias
  - `late-fee.ts`: `PERIOD_DAYS.daily = PERIOD_DAYS.daily_all = 1`, `PERIOD_NOUN` = `'día'`
  - `cuotasParaTicket<T extends { status: string }>(cuotas: T[], max = 12): { mostrar: T[]; restantes: number }` en `plan-largo.ts`

- [ ] **Step 0: Preparar el worktree**

En `<worktree sesión>/SellAlleS-WEB`: copiar `.env.local` desde `SellAlleS-WEB/`; correr `npm ci`. Si da 403 (problema conocido con `yargs-parser`), crear un junction `node_modules` → `SellAlleS-WEB/node_modules` (no trae `qrcode`/`jsbarcode`). Anotar la línea base de `npx tsc --noEmit` (cantidad y códigos de error) para compararla al final.

- [ ] **Step 1: Escribir las pruebas que fallan** en `scripts/tests/frecuencia.test.mjs` (importa de `../../src/lib/frequency.ts`, `late-fee.ts` y `plan-largo.ts`). Fechas locales con `new Date(2026, 10, d)`: sáb 21, dom 22, lun 23, vie 27, sáb 28 y lun 30 de noviembre de 2026.

```js
test('diario lun–sáb salta domingos', () => {
  assert.deepEqual(ymd(addPeriods(nov(21), 'daily', 1)), '2026-11-23'); // sáb → lun
  assert.deepEqual(ymd(addPeriods(nov(22), 'daily', 1)), '2026-11-23'); // dom → lun
  assert.deepEqual(ymd(addPeriods(nov(23), 'daily', 6)), '2026-11-28'); // lun +6 → sáb
  assert.deepEqual(ymd(addPeriods(nov(23), 'daily', 7)), '2026-11-30'); // salta el dom 29
  assert.deepEqual(ymd(addPeriods(nov(27), 'daily', 2)), '2026-11-30');
  assert.deepEqual(ymd(addPeriods(nov(22), 'daily', 0)), '2026-11-22'); // k=0 no se mueve
});
test('diario todos los días y frecuencias viejas sin cambios', () => {
  assert.equal(ymd(addPeriods(nov(21), 'daily_all', 1)), '2026-11-22');
  assert.equal(ymd(addPeriods(nov(23), 'weekly', 2)), '2026-12-07');
  assert.equal(ymd(addPeriods(nov(23), 'biweekly', 1)), '2026-12-07');
  assert.equal(ymd(addPeriods(nov(23), 'monthly', 1)), '2026-12-23');
});
test('meses de interés', () => {
  assert.equal(monthsFor('daily', 26, 'monthly_prorated'), 1);
  assert.equal(monthsFor('daily_all', 30, 'monthly_prorated'), 1);
  assert.equal(monthsFor('weekly', 8, 'monthly_prorated'), 2);
  assert.equal(monthsFor('daily', 26, 'per_installment'), 26);
});
test('topes', () => {
  assert.deepEqual(FREQUENCY_OPTIONS.map(maxInstallments), [312, 312, 240, 120, 60]);
});
test('etiquetas y mora', () => {
  assert.equal(installmentLabel('daily'), 'Cuota Diaria');
  assert.equal(installmentLabel('weekly'), 'Cuota Semanal');
  assert.equal(lateFeePeriodDays('daily'), 1);
  assert.equal(lateFeePeriodDays('daily_all'), 1);
  assert.equal(lateFeeModeHelp('per_period', 5, 'daily'), '5% del saldo vencido por cada día de atraso.');
});
test('ticket de un plan largo', () => {
  const corto = Array.from({ length: 24 }, (_, i) => ({ n: i + 1, status: 'pending' }));
  assert.equal(cuotasParaTicket(corto).mostrar.length, 24);
  const largo = Array.from({ length: 52 }, (_, i) => ({ n: i + 1, status: i < 5 ? 'paid' : 'pending' }));
  const t = cuotasParaTicket(largo);
  assert.deepEqual(t.mostrar.map((c) => c.n), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.equal(t.restantes, 35); // 47 sin pagar − 12
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test scripts/tests/frecuencia.test.mjs`
Expected: FAIL (`daily` sin manejar / `maxInstallments` no existe / `plan-largo.ts` no existe).

- [ ] **Step 3: Implementar en `src/lib/frequency.ts`, `src/lib/late-fee.ts` y `src/lib/plan-largo.ts`**

`addPeriods` para `daily` (mismo algoritmo que la función SQL de la Task 2; el domingo se trata como sábado):

```ts
if (k === 0) return base;
const iso = base.getDay() === 0 ? 7 : base.getDay();   // lun=1 … dom=7
const pos = Math.min(iso - 1, 5) + k;                    // posición en semana de 6 días
const lunes = addDays(base, -(iso - 1));
return addDays(lunes, Math.floor(pos / 6) * 7 + (pos % 6));
```

`daily_all` = `addDays(base, k)`. `lateFeeModeHelp('per_period', r, freq)` con período de 1 día devuelve `` `${r}% del saldo vencido por cada día de atraso.` `` (sin la segunda oración). `cuotasParaTicket`: si `cuotas.length <= 24`, todas y `restantes: 0`; si no, las primeras `max` sin pagar (`status !== 'paid'`) y `restantes = sinPagar − max` (mínimo 0).

- [ ] **Step 4: Correr y ver que pasa**

Run: `node --test scripts/tests/frecuencia.test.mjs` → PASS. Run: `npm test` → todas PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/frequency.ts src/lib/late-fee.ts src/lib/plan-largo.ts scripts/tests/frecuencia.test.mjs
git commit -m "Frecuencias diarias y topes de cuotas en el calendario del front"
```

---

### Task 2: Migración A — frecuencias diarias y más cuotas

**Files:**
- Create: `supabase/migrations/20261124120000_cobro_diario_y_mas_cuotas.sql`
- Create: `supabase/tests/cobro_diario.sql`

**Interfaces:**
- Produces (SQL): `max_installments(p_freq text) returns integer` (immutable); `financing_due_date`, `financing_months`, `late_fee_period_days`, `validate_financing_params`, `trg_before_loan_checks`, `pending_due_reminders` con las frecuencias diarias; CHECK de `loans.payment_frequency`, `companies.financing_default_frequency` y `branches.financing_default_frequency` con `daily` y `daily_all`.
- Task 3 parte de **esta** versión de `trg_before_loan_checks`, no de la viva.

- [ ] **Step 1: Volcar lo vivo y sus huellas.** Con `execute_sql`: `pg_get_functiondef` y `md5(replace(prosrc, E'\r', ''))` de `financing_due_date`, `financing_months`, `late_fee_period_days`, `validate_financing_params`, `trg_before_loan_checks`, `pending_due_reminders`. Pegar las huellas en un comentario al principio de la migración (`-- huella previa: <función> <md5>`).

- [ ] **Step 2: Escribir la suite** `supabase/tests/cobro_diario.sql`, con el mismo encabezado que `refinanciacion.sql` (claims del súper admin, `pg_temp.debe_fallar`), UUIDs fijos `…d1XX`, y que termine en `select 'ok';`. Aserciones (con `if … then raise exception` o `assert`):
  - `financing_due_date('2026-11-21','daily',1) = '2026-11-23'`; `('2026-11-22','daily',1) = '2026-11-23'`; `('2026-11-23','daily',7) = '2026-11-30'`; `('2026-11-22','daily',0) = '2026-11-22'`; `('2026-11-21','daily_all',1) = '2026-11-22'`.
  - Regresión: `('2026-11-23','weekly',2) = '2026-12-07'`, `('2026-11-23','biweekly',1) = '2026-12-07'`, `('2026-11-23','monthly',1) = '2026-12-23'`.
  - `financing_months('daily',26,'monthly_prorated') = 1`, `('daily_all',30,'monthly_prorated') = 1`, `('weekly',8,'monthly_prorated') = 2`.
  - `financing_plan(10000,5,12,'biweekly','monthly_prorated')`: `debt = 13000`, `installment = 1083.33`; con `per_installment`: `debt = 16000`.
  - `max_installments`: daily 312, daily_all 312, weekly 240, biweekly 120, monthly 60.
  - `validate_financing_params(5,240,'weekly','monthly_prorated')` pasa; con 241 falla `%entre 1 y 240%`; `(5,312,'daily',…)` pasa; 313 falla; `(5,61,'monthly',…)` falla `%entre 1 y 60%`; `'yearly'` falla `%Frecuencia%`.
  - `late_fee_period_days('daily') = 1`, `('daily_all') = 1`, `('monthly') = 30`.
  - Préstamo diario: cliente de prueba en la empresa demo; `v_first` = primer lunes después de `company_today(demo)`; insert en `loans` (principal 10000, tasa 20, 26 cuotas, `daily`, `first_due_date = v_first`) → 26 cuotas, la 6.ª en `v_first + 5`, la 7.ª en `v_first + 7`, ninguna en domingo, `total_with_interest = 12000`.
  - Préstamo con 241 cuotas `weekly` falla `%entre 1 y 240%`.
  - Venta financiada diaria (insert como `pg_temp.venta_financiada` de `refinanciacion.sql`, con `"frequency":"daily","installments":26`) → 26 filas en `financing_installments`, ninguna en domingo.
  - `pending_due_reminders(400)` no devuelve ninguna cuota del préstamo diario ni de la venta diaria.
  - `update companies set financing_default_frequency = 'daily' where id = <demo>` no falla.

- [ ] **Step 3: Correr la suite sin la migración y ver que falla**

Run (execute_sql): `begin; <cobro_diario.sql> rollback;`
Expected: error en la primera aserción diaria.

- [ ] **Step 4: Escribir la migración** partiendo de lo volcado en el Step 1. Cambia solo:
  - Los tres CHECK (`drop constraint` + `add constraint`) con `'daily','daily_all','weekly','biweekly','monthly'` (el de `branches` sigue admitiendo NULL).
  - `max_installments`: `case p_freq when 'monthly' then 60 when 'biweekly' then 120 when 'weekly' then 240 when 'daily' then 312 when 'daily_all' then 312 end`, con sus grants.
  - `financing_due_date`: rama `daily` con el algoritmo de la Task 1 (en SQL: `extract(isodow …)`, `least(iso-1,5)+k`, `k = 0` devuelve `p_start`) y rama `daily_all` = `p_start + p_k`.
  - `financing_months`: `daily` → `p_n / 26.0`, `daily_all` → `p_n / 30.0` (después de la rama `per_installment`).
  - `late_fee_period_days`: `daily`, `daily_all` → 1.
  - `validate_financing_params`: primero valida la frecuencia (lista de 5), después `p_n between 1 and max_installments(p_freq)` con el mensaje de las Global Constraints.
  - `trg_before_loan_checks`: la misma lista y tope; `v_months := financing_months(new.payment_frequency, new.installments_count, 'monthly_prorated')`.
  - `pending_due_reminders`: excluye `l.payment_frequency in ('daily','daily_all')` y `coalesce(s.financing_details->>'frequency','monthly') in ('daily','daily_all')`.

- [ ] **Step 5: Correr la suite con la migración**

Run (execute_sql): `begin; <migración A> <cobro_diario.sql> rollback;` → último resultado `ok`. Correr también `begin; <migración A> <supabase/tests/refinanciacion.sql> rollback;` → `ok` (regresión).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261124120000_cobro_diario_y_mas_cuotas.sql supabase/tests/cobro_diario.sql
git commit -m "Cobro diario y hasta 312 cuotas en el motor de cuotas"
```

---

### Task 3: Migración B — desembolso por caja

**Files:**
- Create: `supabase/migrations/20261124130000_desembolso_por_caja.sql`
- Create: `supabase/tests/desembolso_caja.sql`

**Interfaces:**
- Consumes: `trg_before_loan_checks` tal como queda en la Task 2.
- Produces: `loans.disbursement_method text` (CHECK `cash`/`transfer`, nulo permitido), `loans.disbursement_reference text`, `caja_movements.loan_id uuid` (FK a `loans`, `on delete set null`, con índice); `refinance_loan(… , p_disbursement_method text default null, p_disbursement_reference text default null)` — los dos parámetros nuevos al final.

- [ ] **Step 1: Volcar lo vivo y huellas** de `trg_after_loan_effects` y `refinance_loan` (más los grants actuales de `refinance_loan`: `select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'refinance_loan'`).

- [ ] **Step 2: Escribir la suite** `supabase/tests/desembolso_caja.sql` (mismo encabezado; UUIDs `…d2XX`; termina en `select 'ok';`). Preparación dentro de la transacción: módulo `caja` encendido para la demo (`company_modules`), `branches.caja_enabled = true` en la sucursal demo, cerrar cualquier sesión abierta de esa sucursal y abrir una con insert directo en `caja_sessions`. Aserciones:
  - Préstamo 5,000 `cash` → exactamente un `caja_movements` con `type = 'out'`, `amount = 5000`, `loan_id` = el préstamo, `reason like 'Desembolso de préstamo:%'`, `session_id` = la sesión abierta.
  - Préstamo `transfer` con referencia `TRX-1` → sin movimiento; `disbursement_reference = 'TRX-1'`.
  - Préstamo sin método → sin movimiento y sin error.
  - Con la sesión cerrada: préstamo `cash` falla con `%Abre caja antes de entregar el préstamo en efectivo%`; `transfer` pasa.
  - Con `caja_enabled = false` en la sucursal (sesión cerrada): `cash` pasa y no crea movimiento.
  - `disbursement_method = 'cheque'` falla (CHECK).
  - Con caja abierta: `refinance_loan(<préstamo con saldo>, 'capital', 'forgive', 3000, 5, 12, 'weekly', null, 'prueba', null, null, 'cash', null)` → un movimiento `out` de 3000 con `loan_id` = el préstamo **nuevo**; la misma refinanciación con `p_additional = 0` y `'cash'` → sin movimiento. (Ajustar los nombres de `p_base_mode`/`p_late_fee_action` a los valores válidos de la función viva.)

- [ ] **Step 3: Correr sin la migración y ver que falla**

Run (execute_sql): `begin; <migración A> <desembolso_caja.sql> rollback;`
Expected: error por columna `disbursement_method` inexistente.

- [ ] **Step 4: Escribir la migración:**
  - Columnas, CHECK, FK e índice.
  - `trg_before_loan_checks`: al final de las validaciones, `if new.disbursement_method = 'cash' and caja_blocks_cash(new.company_id, new.branch_id) then raise exception '<mensaje de Global Constraints>'`.
  - `trg_after_loan_effects`: después del bucle de cuotas, si `new.disbursement_method = 'cash'`, `is_module_enabled(new.company_id, 'caja', false)`, `branch_uses_caja(new.branch_id)` y `new.principal − coalesce(new.carried_over_amount, 0) > 0`, inserta el movimiento en la sesión abierta de la sucursal (si no hay, no inserta), con `created_by = auth.uid()` y `created_by_name` de `profiles`, y el nombre del cliente en el motivo.
  - `refinance_loan`: `drop function` con la firma vieja de 11 parámetros y `create` con los 2 nuevos; valida que el método sea `cash`/`transfer` cuando viene; el insert del préstamo nuevo pone `disbursement_method`/`disbursement_reference` solo si `p_additional > 0`. Repone los grants que tenía (Step 1) y `revoke … from public, anon`.

- [ ] **Step 5: Correr con la migración**

Run (execute_sql): `begin; <migración A> <migración B> <desembolso_caja.sql> rollback;` → `ok`. Y `begin; <A> <B> <cobro_diario.sql> rollback;` y `begin; <A> <B> <refinanciacion.sql> rollback;` → `ok`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261124130000_desembolso_por_caja.sql supabase/tests/desembolso_caja.sql
git commit -m "El desembolso de un préstamo en efectivo sale de la caja"
```

---

### Task 4: Front — frecuencias en los selectores y topes por frecuencia

**Files:**
- Modify: `src/components/pos/financing-dialog.tsx`, `src/components/financing/amend-financing-dialog.tsx`, `src/components/financing/refinance-financing-dialog.tsx`, `src/components/loans/refinance-loan-dialog.tsx`, `src/components/loans/loan-dialog.tsx`, `src/components/company-profile/financing-settings-card.tsx`, `src/components/branches/branch-dialog.tsx`

**Interfaces:**
- Consumes: `FREQUENCY_OPTIONS`, `FREQUENCY_LABEL`, `maxInstallments`, `monthsFor` (Task 1).

- [ ] **Step 1:** En los 7 archivos, los `<SelectItem>` fijos de frecuencia pasan a `FREQUENCY_OPTIONS.map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>)` (en `branch-dialog` se conserva la opción "heredar" que ya tenga).
- [ ] **Step 2:** Las cuatro `const MAX_INSTALLMENTS = 60` se quitan; la validación, el atributo `max` del input y el mensaje usan `maxInstallments(frequency)`: `` `Entre 1 y ${maxInstallments(frequency)} cuotas.` ``. En `loan-dialog.tsx` lo mismo (hoy está fijo en 60) y la vista previa usa `monthsFor(frequency, n, 'monthly_prorated')` en vez de `n / PER_MONTH[frequency]`.
- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit` → mismos errores que la línea base del Task 1 Step 0, ninguno nuevo (los `Record<PaymentFrequency, …>` incompletos saldrían aquí).

- [ ] **Step 4: Commit**

```bash
git add src/components
git commit -m "Frecuencias diarias en los selectores y tope de cuotas por frecuencia"
```

---

### Task 5: Front — forma de entrega del préstamo

**Files:**
- Modify: `src/lib/types.ts` (`Loan`: `disbursementMethod?: 'cash' | 'transfer'`, `disbursementReference?: string`)
- Modify: `src/lib/supabase/mappers.ts` (mapper de `loans`)
- Modify: `src/context/loan-provider.tsx` (`NewLoanInput` y la entrada de `refinanceLoan` ganan `disbursementMethod` y `disbursementReference`; el insert y la RPC los mandan como `disbursement_method`/`disbursement_reference` y `p_disbursement_method`/`p_disbursement_reference`)
- Modify: `src/components/loans/loan-dialog.tsx`, `src/components/loans/refinance-loan-dialog.tsx`, `src/app/(app)/prestamos/detalle/loan-detail-client.tsx`

**Interfaces:**
- Consumes: columnas y parámetros de la Task 3; `useCaja().cashBlocked` (ya existe en `register-loan-payment-dialog.tsx`).

- [ ] **Step 1:** En `loan-dialog.tsx`, bloque **"Entrega del dinero"**: select *Efectivo* / *Transferencia*; con transferencia, campo *Referencia* (opcional). Por defecto *Efectivo*; si `cashBlocked` y la sucursal elegida es la activa, por defecto *Transferencia*, *Efectivo* deshabilitado y la nota "No hay caja abierta: ábrela para entregar en efectivo." El error del servidor se muestra tal cual en el toast (cubre otras sucursales).
- [ ] **Step 2:** En `refinance-loan-dialog.tsx`, el mismo bloque, visible solo si el dinero adicional es mayor que 0.
- [ ] **Step 3:** En el detalle del préstamo, junto a los datos del préstamo: "Entregado en efectivo" / "Entregado por transferencia (ref. …)"; nada si es nulo.
- [ ] **Step 4:** `npx tsc --noEmit` sin errores nuevos.
- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/supabase/mappers.ts src/context/loan-provider.tsx src/components/loans src/app/(app)/prestamos
git commit -m "Forma de entrega del préstamo y salida por caja desde el front"
```

---

### Task 6: Front — planes largos en pantalla y en el ticket

**Files:**
- Modify: `src/components/loans/loan-ticket-dialog.tsx`
- Modify: `src/app/(app)/prestamos/detalle/loan-detail-client.tsx`, `src/app/(app)/financing/detail/financing-detail-client.tsx`

**Interfaces:**
- Consumes: `cuotasParaTicket` (Task 1).

- [ ] **Step 1:** El ticket térmico imprime `cuotasParaTicket(loan.installments).mostrar`; si `restantes > 0`, una línea final: `… y {restantes} cuotas más. Última: {fecha de la última cuota}`.
- [ ] **Step 2:** En los dos detalles, si el plan tiene más de 24 cuotas se muestran las primeras 24 y un botón `Ver las {n} cuotas restantes` que despliega el resto.
- [ ] **Step 3:** `npx tsc --noEmit` sin errores nuevos.
- [ ] **Step 4: Commit**

```bash
git add src/components/loans/loan-ticket-dialog.tsx src/app/(app)/prestamos src/app/(app)/financing
git commit -m "Planes largos: ticket con las próximas 12 cuotas y tabla plegable"
```

---

### Task 7: Reporte de antigüedad de cartera

**Files:**
- Create: `src/lib/antiguedad.ts`
- Test: `scripts/tests/antiguedad.test.mjs`
- Create: `src/app/(app)/reports/antiguedad/page.tsx`
- Modify: `src/lib/permissions.ts` (`REPORT_ITEMS`: `{ slug: 'antiguedad', label: 'Antigüedad de Cartera' }` después de `receivables`)
- Modify: `src/app/(app)/reports/page.tsx` (tarjeta "Antigüedad de Cartera" — "Atrasos por tramos de días", visible con `(hasCredit || hasFinancing || hasPrestamos) && isReportVisible(effectivePermissions, 'antiguedad')`)

**Interfaces:**
- Produces (`src/lib/antiguedad.ts`, solo `import type`):

```ts
export type Tramo = 'al_dia' | 'd1_7' | 'd8_15' | 'd16_30' | 'd31_60' | 'd61_90' | 'd90_mas';
export const TRAMOS: { key: Tramo; label: string }[]; // Al día, 1–7, 8–15, 16–30, 31–60, 61–90, +90
export function tramoDe(diasAtraso: number): Tramo;
export interface CuentaCartera {
  id: string; tipo: 'prestamo' | 'financiamiento' | 'credito';
  clienteId: string; cliente: string; telefono: string;
  saldo: number; diasAtraso: number | null; // null = crédito simple sin plan
}
export interface FilaCartera {
  clienteId: string; cliente: string; telefono: string;
  porTramo: Record<Tramo, number>; sinPlan: number; total: number; diasMax: number;
}
export function agruparCartera(cuentas: CuentaCartera[]): {
  filas: FilaCartera[]; // orden: diasMax desc, luego total desc
  totales: Record<Tramo, number> & { sinPlan: number; total: number; vencido: number };
};
```

- [ ] **Step 1: Pruebas que fallan** en `scripts/tests/antiguedad.test.mjs`:
  - `tramoDe`: 0→`al_dia`, 1→`d1_7`, 7→`d1_7`, 8→`d8_15`, 15→`d8_15`, 16→`d16_30`, 30→`d16_30`, 31→`d31_60`, 60→`d31_60`, 61→`d61_90`, 90→`d61_90`, 91→`d90_mas`.
  - Un cliente con préstamo (saldo 1,000, 3 días) y financiamiento (saldo 500, 40 días) → una fila: `porTramo.d1_7 = 1000`, `porTramo.d31_60 = 500`, `total = 1500`, `diasMax = 40`.
  - Crédito simple (`diasAtraso: null`, saldo 300) → `sinPlan = 300`, no suma a ningún tramo.
  - Cuenta con `saldo: 0` → no aparece.
  - `totales.vencido` = suma de todos los tramos menos `al_dia` y menos `sinPlan`.
  - Orden: el cliente con más días va primero.
- [ ] **Step 2:** `node --test scripts/tests/antiguedad.test.mjs` → FAIL.
- [ ] **Step 3: Implementar `src/lib/antiguedad.ts`.**
- [ ] **Step 4:** `node --test scripts/tests/antiguedad.test.mjs` → PASS.
- [ ] **Step 5: Página** `/reports/antiguedad`: arma `CuentaCartera[]` desde `useSales().financingSales` (sin anuladas; `calculateFinancingStatus`; crédito simple sin `financingDetails` ni cuotas → `diasAtraso: null`) y `useLoans().loans` (activos; `calculateLoanStatus`), con los días calculados como en `reports/receivables/page.tsx`. Tarjetas: Cartera total, Vencido, % vencido. Tabla por cliente con una columna por tramo + Sin plan + Total, fila de totales, y `ExportButton` (CSV) con las mismas columnas.
- [ ] **Step 6:** `npx tsc --noEmit` sin errores nuevos; `npm test` PASS.
- [ ] **Step 7: Commit**

```bash
git add src/lib/antiguedad.ts scripts/tests/antiguedad.test.mjs src/app/(app)/reports src/lib/permissions.ts
git commit -m "Reporte de antigüedad de cartera por tramos de días"
```

---

### Task 8: Aplicar, verificar en pantalla y PR

**Files:**
- Modify: `docs/superpowers/specs/2026-11-23-motoprestamos-design.md` (estado de la entrega 1)

- [ ] **Step 1: Build.** `npm test` PASS; `npx tsc --noEmit` igual a la línea base; `npm run build` termina (si la línea base del Step 0 ya no construía por `qrcode`, anotarlo y no darlo por verificado).
- [ ] **Step 2: Huellas.** Recalcular el md5 de las funciones de los Steps 1 de las Tasks 2 y 3; deben coincidir con las anotadas. Si alguna cambió, volver a partir de la viva antes de aplicar.
- [ ] **Step 3: Aplicar** con `apply_migration` la A y luego la B (son compatibles con el front que está en producción: frecuencias nuevas sin usar, columnas nulas, parámetros nuevos con default). Después: `select max_installments('daily')` = 312, la firma nueva de `refinance_loan` existe y la vieja no, `get_advisors` (security) sin avisos nuevos para `anon`, y logs de la API sin `42501`.
- [ ] **Step 4: Probar en pantalla** con el dev server en la empresa demo (súper admin → Gestionar empresas → Entrar en "SellAlleS Store DEMO" → sucursal Principal): con caja abierta, préstamo **Diario (lun–sáb)** de 26 cuotas en efectivo → cuotas sin domingos y salida en la caja; préstamo por transferencia → sin movimiento; refinanciación con dinero adicional en efectivo → salida; financiamiento **Diario (todos los días)** en el POS; reporte de antigüedad con datos. Captura de pantalla de la caja y del reporte. Borrar después los datos de prueba (préstamos, cuotas, movimientos, ventas) y cerrar la caja de prueba.
- [ ] **Step 5:** Actualizar la spec ("Entrega 1: hecha, PR #…"), commit, `git push -u origin claude/motoprestamos`, y abrir el PR contra `main` con resumen, migraciones aplicadas y pruebas. No fusionar: el merge despliega y lo decide Louis.
