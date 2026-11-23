-- Pruebas del cobro diario y del tope de cuotas. NO es una migración: se corre
-- contra producción dentro de una transacción que se revierte, después del SQL
-- de la migración:
--
--   begin; <supabase/migrations/20261124120000_cobro_diario_y_mas_cuotas.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Las fechas son las mismas que las de
-- scripts/tests/frecuencia.test.mjs (noviembre de 2026: sáb 21, dom 22, lun 23,
-- vie 27, sáb 28, lun 30). Datos con UUID fijos (…d1XX) en la empresa demo.

select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);

create function pg_temp.debe_fallar(p_sql text, p_like text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like then
      raise exception 'falló con otro mensaje: % (esperaba %)', sqlerrm, p_like;
    end if;
    return;
  end;
  raise exception 'debió fallar: %', p_sql;
end $$;

create function pg_temp.igual(p_real anyelement, p_esperado anyelement, p_que text) returns void
language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception '%: dio %, esperaba %', p_que, p_real, p_esperado;
  end if;
end $$;

-- Fechas del calendario diario
select pg_temp.igual(financing_due_date('2026-11-21', 'daily', 1), date '2026-11-23', 'sáb + 1 hábil');
select pg_temp.igual(financing_due_date('2026-11-22', 'daily', 1), date '2026-11-23', 'dom + 1 hábil');
select pg_temp.igual(financing_due_date('2026-11-23', 'daily', 5), date '2026-11-28', 'lun + 5 hábiles');
select pg_temp.igual(financing_due_date('2026-11-23', 'daily', 6), date '2026-11-30', 'lun + 6 hábiles');
select pg_temp.igual(financing_due_date('2026-11-27', 'daily', 2), date '2026-11-30', 'vie + 2 hábiles');
select pg_temp.igual(financing_due_date('2026-11-23', 'daily', 0), date '2026-11-23', 'k = 0 en lunes');
select pg_temp.igual(financing_due_date('2026-11-22', 'daily', 0), date '2026-11-22', 'k = 0 en domingo');
-- Un primer pago elegido en domingo: el plan lun–sáb arranca el lunes y sigue el
-- martes; "todos los días" sí cobra ese domingo.
select pg_temp.igual(financing_schedule_due_date('2026-11-20', '2026-11-22', 'daily', 1), date '2026-11-23', 'primer pago domingo, cuota 1');
select pg_temp.igual(financing_schedule_due_date('2026-11-20', '2026-11-22', 'daily', 2), date '2026-11-24', 'primer pago domingo, cuota 2');
select pg_temp.igual(financing_schedule_due_date('2026-11-20', '2026-11-22', 'daily_all', 1), date '2026-11-22', 'primer pago domingo, todos los días');
select pg_temp.igual(financing_schedule_due_date('2026-11-20', '2026-11-23', 'daily', 2), date '2026-11-24', 'primer pago lunes, cuota 2');
select pg_temp.igual(financing_due_date('2026-11-21', 'daily_all', 1), date '2026-11-22', 'todos los días');

-- Regresión: semanal, quincenal y mensual no cambian
select pg_temp.igual(financing_due_date('2026-11-23', 'weekly', 2), date '2026-12-07', 'semanal');
select pg_temp.igual(financing_due_date('2026-11-23', 'biweekly', 1), date '2026-12-07', 'quincenal');
select pg_temp.igual(financing_due_date('2026-11-23', 'monthly', 1), date '2026-12-23', 'mensual');

-- Meses de interés
select pg_temp.igual(financing_months('daily', 26, 'monthly_prorated'), 1::numeric, 'meses diario');
select pg_temp.igual(financing_months('daily_all', 30, 'monthly_prorated'), 1::numeric, 'meses todos los días');
select pg_temp.igual(financing_months('weekly', 8, 'monthly_prorated'), 2::numeric, 'meses semanal');
select pg_temp.igual(financing_months('daily', 26, 'per_installment'), 26::numeric, 'por cuota');

-- Regresión: el plan quincenal de siempre
select pg_temp.igual((financing_plan(10000, 5, 12, 'biweekly', 'monthly_prorated')->>'debt')::numeric, 13000::numeric, 'deuda quincenal');
select pg_temp.igual((financing_plan(10000, 5, 12, 'biweekly', 'monthly_prorated')->>'installment')::numeric, 1083.33, 'cuota quincenal');
select pg_temp.igual((financing_plan(10000, 5, 12, 'biweekly', 'per_installment')->>'debt')::numeric, 16000::numeric, 'deuda por cuota');

-- Topes
select pg_temp.igual(max_installments('daily'), 312, 'tope diario');
select pg_temp.igual(max_installments('daily_all'), 312, 'tope todos los días');
select pg_temp.igual(max_installments('weekly'), 240, 'tope semanal');
select pg_temp.igual(max_installments('biweekly'), 120, 'tope quincenal');
select pg_temp.igual(max_installments('monthly'), 60, 'tope mensual');
select validate_financing_params(5, 240, 'weekly', 'monthly_prorated');
select pg_temp.debe_fallar($$select validate_financing_params(5, 241, 'weekly', 'monthly_prorated')$$, '%entre 1 y 240%');
select validate_financing_params(5, 312, 'daily', 'monthly_prorated');
select pg_temp.debe_fallar($$select validate_financing_params(5, 313, 'daily', 'monthly_prorated')$$, '%entre 1 y 312%');
select pg_temp.debe_fallar($$select validate_financing_params(5, 61, 'monthly', 'monthly_prorated')$$, '%entre 1 y 60%');
select pg_temp.debe_fallar($$select validate_financing_params(5, 12, 'yearly', 'monthly_prorated')$$, '%Frecuencia%');

-- Mora
select pg_temp.igual(late_fee_period_days('daily'), 1, 'mora diaria');
select pg_temp.igual(late_fee_period_days('daily_all'), 1, 'mora todos los días');
select pg_temp.igual(late_fee_period_days('monthly'), 30, 'mora mensual');

-- Préstamo diario de 26 cuotas desde el próximo lunes
insert into customers (id, company_id, name, email)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000aa', 'Prueba cobro diario', 'prueba-diario@example.com');

do $$
declare
  v_first date := company_today('00000000-0000-0000-0000-0000000000aa')
                  + (8 - extract(isodow from company_today('00000000-0000-0000-0000-0000000000aa'))::int);
  v_loan uuid := '00000000-0000-0000-0000-0000000000d2';
begin
  insert into loans (id, company_id, branch_id, customer_id, principal, interest_rate, installments_count,
                     payment_frequency, first_due_date)
  values (v_loan, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000000d1', 10000, 20, 26, 'daily', v_first);

  perform pg_temp.igual((select count(*)::int from loan_installments where loan_id = v_loan), 26, 'cuotas del préstamo');
  perform pg_temp.igual((select due_date from loan_installments where loan_id = v_loan and installment_number = 1), v_first, 'cuota 1');
  perform pg_temp.igual((select due_date from loan_installments where loan_id = v_loan and installment_number = 6), v_first + 5, 'cuota 6 (sábado)');
  perform pg_temp.igual((select due_date from loan_installments where loan_id = v_loan and installment_number = 7), v_first + 7, 'cuota 7 (lunes)');
  perform pg_temp.igual((select count(*)::int from loan_installments where loan_id = v_loan and extract(isodow from due_date) = 7), 0, 'cuotas en domingo');
  perform pg_temp.igual((select total_with_interest from loans where id = v_loan), 12000::numeric, 'total del préstamo');
end $$;

select pg_temp.debe_fallar($$
  insert into loans (company_id, branch_id, customer_id, principal, interest_rate, installments_count, payment_frequency)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000000d1', 10000, 5, 241, 'weekly')
$$, '%entre 1 y 240%');

-- Venta financiada diaria de 26 cuotas
insert into sales (id, company_id, branch_id, customer_id, subtotal, itbis_amount, total,
                   payment_method, payment_status, amount_paid, financing_details)
values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000aa',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1',
        10000, 0, 10000, 'financing', 'in_financing', 0,
        '{"interestRate":5,"installments":26,"frequency":"daily","interestMode":"monthly_prorated"}');

select pg_temp.igual((select count(*)::int from financing_installments where sale_id = '00000000-0000-0000-0000-0000000000d3'), 26, 'cuotas de la venta');
select pg_temp.igual((select count(*)::int from financing_installments
                      where sale_id = '00000000-0000-0000-0000-0000000000d3' and extract(isodow from due_date) = 7), 0, 'cuotas de la venta en domingo');

-- Los planes diarios no reciben el aviso por correo
select pg_temp.igual((select count(*)::int from pending_due_reminders(400) r
                      where r.installment_id in (select id from loan_installments where loan_id = '00000000-0000-0000-0000-0000000000d2')
                         or r.installment_id in (select id from financing_installments where sale_id = '00000000-0000-0000-0000-0000000000d3')),
                     0, 'avisos de planes diarios');

-- La frecuencia por defecto de empresa y sucursal acepta las diarias
update companies set financing_default_frequency = 'daily', financing_default_installments = 240
 where id = '00000000-0000-0000-0000-0000000000aa';
update branches set financing_default_frequency = 'daily_all', financing_default_installments = 312
 where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.debe_fallar($$update companies set financing_default_installments = 313
                             where id = '00000000-0000-0000-0000-0000000000aa'$$, '%financing_default_installments%');

select 'ok';
