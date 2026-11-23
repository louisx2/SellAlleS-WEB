// Calendario de cuotas: frecuencias diarias, topes y planes largos. Es el espejo
// de las funciones de la base (financing_due_date, financing_months,
// max_installments, late_fee_period_days): las fechas de prueba son las mismas
// que las de supabase/tests/cobro_diario.sql.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addPeriods, firstDueAnchor, FREQUENCY_OPTIONS, installmentLabel, maxInstallments, monthsFor,
} from '../../src/lib/frequency.ts';
import { lateFeeModeHelp, lateFeePeriodDays } from '../../src/lib/late-fee.ts';
import { cuotasParaTicket } from '../../src/lib/plan-largo.ts';

// Noviembre de 2026: sáb 21, dom 22, lun 23, vie 27, sáb 28, lun 30.
const nov = (d) => new Date(2026, 10, d);
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('diario lun–sáb salta los domingos', () => {
  assert.equal(ymd(addPeriods(nov(21), 'daily', 1)), '2026-11-23'); // sáb → lun
  assert.equal(ymd(addPeriods(nov(22), 'daily', 1)), '2026-11-23'); // dom → lun
  assert.equal(ymd(addPeriods(nov(23), 'daily', 5)), '2026-11-28'); // lun + 5 → sáb
  assert.equal(ymd(addPeriods(nov(23), 'daily', 6)), '2026-11-30'); // salta el dom 29
  assert.equal(ymd(addPeriods(nov(27), 'daily', 2)), '2026-11-30');
  assert.equal(ymd(addPeriods(nov(22), 'daily', 0)), '2026-11-22'); // k = 0 no se mueve
});

test('diario todos los días cuenta días corridos', () => {
  assert.equal(ymd(addPeriods(nov(21), 'daily_all', 1)), '2026-11-22');
});

test('semanal, quincenal y mensual no cambian', () => {
  assert.equal(ymd(addPeriods(nov(23), 'weekly', 2)), '2026-12-07');
  assert.equal(ymd(addPeriods(nov(23), 'biweekly', 1)), '2026-12-07');
  assert.equal(ymd(addPeriods(nov(23), 'monthly', 1)), '2026-12-23');
});

test('meses de interés del plan diario', () => {
  assert.equal(monthsFor('daily', 26, 'monthly_prorated'), 1);
  assert.equal(monthsFor('daily_all', 30, 'monthly_prorated'), 1);
  assert.equal(monthsFor('weekly', 8, 'monthly_prorated'), 2);
  assert.equal(monthsFor('daily', 26, 'per_installment'), 26);
});

test('tope de cuotas por frecuencia', () => {
  assert.deepEqual(FREQUENCY_OPTIONS, ['daily', 'daily_all', 'weekly', 'biweekly', 'monthly']);
  assert.deepEqual(FREQUENCY_OPTIONS.map(maxInstallments), [312, 312, 240, 120, 60]);
});

test('etiqueta de la cuota diaria', () => {
  assert.equal(installmentLabel('daily'), 'Cuota Diaria');
  assert.equal(installmentLabel('daily_all'), 'Cuota Diaria');
  assert.equal(installmentLabel('weekly'), 'Cuota Semanal');
});

test('la mora de un plan diario corre por día', () => {
  assert.equal(lateFeePeriodDays('daily'), 1);
  assert.equal(lateFeePeriodDays('daily_all'), 1);
  assert.equal(lateFeeModeHelp('per_period', 5, 'daily'), '5% del saldo vencido por cada día de atraso.');
});

test('el ticket de un plan corto lleva todas las cuotas', () => {
  const corto = Array.from({ length: 24 }, (_, i) => ({ n: i + 1, status: 'pending' }));
  const t = cuotasParaTicket(corto);
  assert.equal(t.mostrar.length, 24);
  assert.equal(t.restantes, 0);
});

test('el ticket de un plan largo lleva las próximas 12 sin pagar', () => {
  const largo = Array.from({ length: 52 }, (_, i) => ({ n: i + 1, status: i < 5 ? 'paid' : 'pending' }));
  const t = cuotasParaTicket(largo);
  assert.deepEqual(t.mostrar.map((c) => c.n), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.equal(t.restantes, 35); // 47 sin pagar − 12
});

test('plan lun–sáb con primer pago elegido en domingo arranca el lunes, sin repetir fecha', () => {
  const ancla = firstDueAnchor('daily', nov(22));
  assert.equal(ymd(addPeriods(ancla, 'daily', 0)), '2026-11-23'); // cuota 1
  assert.equal(ymd(addPeriods(ancla, 'daily', 1)), '2026-11-24'); // cuota 2
  // Otro día de la semana no se mueve, y "todos los días" sí cobra el domingo elegido.
  assert.equal(ymd(firstDueAnchor('daily', nov(23))), '2026-11-23');
  assert.equal(ymd(firstDueAnchor('daily_all', nov(22))), '2026-11-22');
  assert.equal(ymd(firstDueAnchor('weekly', nov(22))), '2026-11-22');
});
