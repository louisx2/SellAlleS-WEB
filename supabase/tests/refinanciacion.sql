-- Pruebas de la refinanciación. NO es una migración: se corre contra producción
-- dentro de una transacción que se revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261016090000_refinanciacion.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`; si una aserción falla, la llamada
-- devuelve el error con su mensaje. Cada sección crea sus propios datos con
-- UUID fijos (…cfXX) en la empresa demo y no depende de las demás.

select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);

-- Comprueba que una sentencia falla con el mensaje esperado (sus efectos se
-- revierten con el subbloque).
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

-- Venta de 10,000 al 5% mensual en 10 cuotas (15,000; cuota 1,500), con mora
-- congelada de 5% una vez, y lo abonado.
create function pg_temp.venta_financiada(p_sale uuid, p_customer uuid, p_paid numeric) returns void
language plpgsql as $$
begin
  insert into customers (id, company_id, name)
  values (p_customer, '00000000-0000-0000-0000-0000000000aa', 'Prueba refinanciación ' || right(p_customer::text, 4))
  on conflict (id) do nothing;
  insert into sales (id, company_id, branch_id, customer_id, subtotal, itbis_amount, total,
                     payment_method, payment_status, amount_paid, financing_details)
  values (p_sale, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', p_customer,
          10000, 0, 10000, 'financing', 'in_financing', 0,
          '{"interestRate":5,"installments":10,"frequency":"monthly","interestMode":"monthly_prorated"}');
  update sales set financing_details = financing_details || '{"lateFeeRate":5,"lateFeeMode":"once","lateFeeGraceDays":0,"lateFeeMaxRate":0}'
   where id = p_sale;
  if p_paid > 0 then
    perform register_sale_payment(p_sale, p_paid, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  end if;
end $$;

-- Préstamo de 10,000 al 5% mensual en 10 cuotas (15,000; cuota 1,500), con
-- mora congelada de 5% una vez, y lo abonado.
create function pg_temp.prestamo(p_loan uuid, p_customer uuid, p_paid numeric) returns void
language plpgsql as $$
begin
  insert into customers (id, company_id, name)
  values (p_customer, '00000000-0000-0000-0000-0000000000aa', 'Prueba refinanciación ' || right(p_customer::text, 4))
  on conflict (id) do nothing;
  insert into loans (id, company_id, branch_id, customer_id, principal, interest_rate, installments_count, payment_frequency)
  values (p_loan, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', p_customer,
          10000, 5, 10, 'monthly');
  update loans set late_fee_rate = 5, late_fee_mode = 'once', late_fee_grace_days = 0, late_fee_max_rate = 0
   where id = p_loan;
  if p_paid > 0 then
    perform register_loan_payment(p_loan, p_paid, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  end if;
end $$;

-- == Task 1: esquema ==
insert into customers (id, company_id, name)
values ('00000000-0000-0000-0000-00000000cf01', '00000000-0000-0000-0000-0000000000aa', 'Prueba refinanciación 1');

do $$
declare d date[];
begin
  -- Sin first_due_date: igual que hoy (semanal = created_at::date + 7k).
  insert into loans (id, company_id, branch_id, customer_id, principal, interest_rate, installments_count, payment_frequency)
  values ('00000000-0000-0000-0000-00000000cf10', '00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000cf01', 1000, 5, 3, 'weekly');
  select array_agg(due_date order by installment_number) into d from loan_installments where loan_id = '00000000-0000-0000-0000-00000000cf10';
  assert d = array[now()::date + 7, now()::date + 14, now()::date + 21], 'calendario sin first_due cambió: ' || d::text;

  -- Con first_due_date: la cuota 1 cae ahí y las demás siguen la frecuencia.
  insert into loans (id, company_id, branch_id, customer_id, principal, interest_rate, installments_count, payment_frequency, first_due_date)
  values ('00000000-0000-0000-0000-00000000cf11', '00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000cf01', 1000, 5, 3, 'weekly', current_date + 10);
  select array_agg(due_date order by installment_number) into d from loan_installments where loan_id = '00000000-0000-0000-0000-00000000cf11';
  assert d = array[current_date + 10, current_date + 17, current_date + 24], 'first_due_date ignorado: ' || d::text;

  update loans set status = 'refinanced' where id = '00000000-0000-0000-0000-00000000cf11';

  begin
    insert into refinancings (company_id, customer_id, kind, sale_id, base_mode, new_principal, reason)
    values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000cf01', 'loan',
            gen_random_uuid(), 'capital', 1, 'x');
    raise exception 'debió fallar: kind loan con sale_id';
  exception when others then
    assert sqlerrm like '%violates%', sqlerrm;
  end;

  assert has_table_privilege('authenticated', 'public.refinancings', 'SELECT'), 'authenticated sin SELECT';
  assert not has_table_privilege('authenticated', 'public.refinancings', 'INSERT'), 'authenticated con INSERT';
  assert not has_table_privilege('anon', 'public.refinancings', 'SELECT'), 'anon con SELECT';
end $$;

-- == Task 2: cotización de financiamiento ==
-- 10,000 al 5% mensual en 10 cuotas = 15,000 (cuota 1,500). Con 6,000 pagados:
-- saldo 9,000, de eso 6,000 de capital y 3,000 de interés futuro.
insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000cf06', '00000000-0000-0000-0000-0000000000aa', 'Prueba refinanciación 6'),
  ('00000000-0000-0000-0000-00000000cf07', '00000000-0000-0000-0000-0000000000aa', 'Prueba refinanciación 7');

insert into sales (id, company_id, branch_id, customer_id, subtotal, itbis_amount, total,
                   payment_method, payment_status, amount_paid, down_payment_method, financing_details)
values
  ('00000000-0000-0000-0000-00000000cf20', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-00000000cf06', 10000, 0, 10000, 'financing', 'in_financing', 0, null,
   '{"interestRate":5,"installments":10,"frequency":"monthly","interestMode":"monthly_prorated"}'),
  -- Con abono inicial de 3,000: capital 7,000, deuda 10,500, cuota 1,050.
  ('00000000-0000-0000-0000-00000000cf21', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-00000000cf07', 10000, 0, 10000, 'financing', 'in_financing', 3000, 'transfer',
   '{"interestRate":5,"installments":10,"frequency":"monthly","interestMode":"monthly_prorated"}');

do $$
declare q jsonb;
begin
  update sales set financing_details = financing_details || '{"lateFeeRate":5,"lateFeeMode":"once","lateFeeGraceDays":0,"lateFeeMaxRate":0}'
   where id in ('00000000-0000-0000-0000-00000000cf20', '00000000-0000-0000-0000-00000000cf21');

  perform register_sale_payment('00000000-0000-0000-0000-00000000cf20', 6000, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  q := refinance_quote('financing', '00000000-0000-0000-0000-00000000cf20');
  assert (q->>'pending_balance')::numeric = 9000, q::text;
  assert (q->>'pending_capital')::numeric = 6000, q::text;
  assert (q->>'unearned_interest')::numeric = 3000, q::text;
  assert (q->>'late_fee_due')::numeric = 0, q::text;
  assert (q->>'plan_principal')::numeric = 10000 and (q->>'plan_debt')::numeric = 15000, q::text;
  assert (q->>'first_installment')::int = 1, q::text;
  assert q->'terms'->>'frequency' = 'monthly' and (q->'terms'->>'installments')::int = 10, q::text;
  assert (q->'terms'->>'interestRate')::numeric = 5 and q->'terms'->>'interestMode' = 'monthly_prorated', q::text;
  assert q->>'customer_id' = '00000000-0000-0000-0000-00000000cf06', q::text;
  assert q->'new_late_fee' ? 'rate' and q->'new_late_fee' ? 'mode'
     and q->'new_late_fee' ? 'graceDays' and q->'new_late_fee' ? 'maxRate', q::text;

  -- Mora: la cuota 5 vencida hace 10 días, 5% una vez sobre 1,500.
  update financing_installments set due_date = company_today('00000000-0000-0000-0000-0000000000aa') - 10
   where sale_id = '00000000-0000-0000-0000-00000000cf20' and installment_number = 5;
  q := refinance_quote('financing', '00000000-0000-0000-0000-00000000cf20');
  assert (q->>'late_fee_due')::numeric = 75, q::text;

  -- 6,500 cubren 6 cuotas y 200 de la séptima: saldo 4,000.
  perform register_sale_payment('00000000-0000-0000-0000-00000000cf21', 6500, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  q := refinance_quote('financing', '00000000-0000-0000-0000-00000000cf21');
  assert (q->>'plan_principal')::numeric = 7000 and (q->>'plan_debt')::numeric = 10500, q::text;
  assert (q->>'pending_balance')::numeric = 4000, q::text;
  assert (q->>'pending_capital')::numeric = 2666.67 and (q->>'unearned_interest')::numeric = 1333.33, q::text;

  assert not has_function_privilege('anon', 'public.refinance_quote(text,uuid)', 'EXECUTE'), 'anon puede cotizar';
  assert has_function_privilege('authenticated', 'public.refinance_quote(text,uuid)', 'EXECUTE'), 'authenticated no puede cotizar';
  assert not has_function_privilege('authenticated', 'public.refinance_quote_data(text,uuid)', 'EXECUTE'), 'helper expuesto';
end $$;

-- == Task 3: refinanciar un financiamiento ==
do $$
declare
  aa  constant uuid := '00000000-0000-0000-0000-0000000000aa';
  r   jsonb;
  q   jsonb;
  fd  jsonb;
  v_id uuid;
  rf  refinancings%rowtype;
begin
  -- Base capital, 12 al 5% mensual: capital 6,000, interés 3,600, deuda 9,600, cuota 800.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf30', '00000000-0000-0000-0000-00000000cf02', 6000);
  q := refinance_quote('financing', '00000000-0000-0000-0000-00000000cf30');
  r := refinance_financing('00000000-0000-0000-0000-00000000cf30', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'cliente pidió más plazo');
  assert (r->>'new_principal')::numeric = 6000 and (r->>'interest')::numeric = 3600, r::text;
  assert (r->>'installment_amount')::numeric = 800 and (r->>'first_installment')::int = 5, r::text;
  assert (r->>'total_with_interest')::numeric = 15600 and (r->>'customer_balance')::numeric = 9600, r::text;
  select financing_details into fd from sales where id = '00000000-0000-0000-0000-00000000cf30';
  assert (fd->>'totalWithInterest')::numeric = 15600 and (fd->>'principal')::numeric = 6000, fd::text;
  assert (fd->>'firstInstallment')::int = 5 and (fd->>'installments')::int = 12 and fd ? 'refinancedAt', fd::text;
  assert (fd->>'lateFeeRate')::numeric = (q->'new_late_fee'->>'rate')::numeric, fd::text;
  assert (select credit_balance from customers where id = '00000000-0000-0000-0000-00000000cf02') = 9600;
  assert (select count(*) from financing_installments where sale_id = '00000000-0000-0000-0000-00000000cf30') = 16;
  assert (select min(installment_number) from financing_installments
           where sale_id = '00000000-0000-0000-0000-00000000cf30' and amount = 800) = 5;
  assert (select due_date from financing_installments
           where sale_id = '00000000-0000-0000-0000-00000000cf30' and installment_number = 5)
       = financing_due_date(company_today(aa), 'monthly', 1);
  select * into rf from refinancings where sale_id = '00000000-0000-0000-0000-00000000cf30';
  assert rf.kind = 'financing' and rf.base_mode = 'capital' and rf.pending_balance = 9000
     and rf.pending_capital = 6000 and rf.unearned_interest = 3000 and rf.new_principal = 6000
     and rf.late_fee_action is null and rf.reason = 'cliente pidió más plazo'
     and jsonb_array_length(rf.plan_before->'installments') = 10, row_to_json(rf)::text;

  -- Base saldo: 9,000.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf31', '00000000-0000-0000-0000-00000000cf03', 6000);
  r := refinance_financing('00000000-0000-0000-0000-00000000cf31', 'balance', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x');
  assert (r->>'new_principal')::numeric = 9000, r::text;

  -- Cuota parcial: 6,500 abonados. La cuota 5 queda en 500 y pagada; capital 5,666.67; las nuevas desde la 6.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf32', '00000000-0000-0000-0000-00000000cf08', 6500);
  r := refinance_financing('00000000-0000-0000-0000-00000000cf32', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x');
  assert (r->>'new_principal')::numeric = 5666.67 and (r->>'first_installment')::int = 6, r::text;
  assert (select amount = 500 and paid_amount = 500 and status = 'paid' and paid_at is not null
            from financing_installments where sale_id = '00000000-0000-0000-0000-00000000cf32' and installment_number = 5);

  -- Mora sumada: la cuota 5 vencida hace 10 días (75) → capital 6,075.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf33', '00000000-0000-0000-0000-00000000cf09', 6000);
  update financing_installments set due_date = company_today(aa) - 10
   where sale_id = '00000000-0000-0000-0000-00000000cf33' and installment_number = 5;
  r := refinance_financing('00000000-0000-0000-0000-00000000cf33', 'capital', 'capitalize', 5, 12, 'monthly', 'monthly_prorated', null, 'x');
  assert (r->>'new_principal')::numeric = 6075, r::text;
  assert (select late_fee_amount = 75 and late_fee_action = 'capitalize'
            from refinancings where sale_id = '00000000-0000-0000-0000-00000000cf33');

  -- Mora perdonada: capital 6,000 y la mora queda registrada.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf34', '00000000-0000-0000-0000-00000000cf0a', 6000);
  update financing_installments set due_date = company_today(aa) - 10
   where sale_id = '00000000-0000-0000-0000-00000000cf34' and installment_number = 5;
  r := refinance_financing('00000000-0000-0000-0000-00000000cf34', 'capital', 'forgive', 5, 12, 'monthly', 'monthly_prorated', null, 'x');
  assert (r->>'new_principal')::numeric = 6000, r::text;
  assert (select late_fee_amount = 75 and late_fee_action = 'forgive'
            from refinancings where sale_id = '00000000-0000-0000-0000-00000000cf34');

  -- Con mora y sin decir qué hacer con ella: rechazo.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf35', '00000000-0000-0000-0000-00000000cf0b', 6000);
  update financing_installments set due_date = company_today(aa) - 10
   where sale_id = '00000000-0000-0000-0000-00000000cf35' and installment_number = 5;
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf35', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x')$q$, '%mora%');

  -- Cuota con solo mora pagada: se conserva con monto 0, pagada.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf36', '00000000-0000-0000-0000-00000000cf0c', 6000);
  update financing_installments set due_date = company_today(aa) - 10, late_fee_paid = 75
   where sale_id = '00000000-0000-0000-0000-00000000cf36' and installment_number = 5;
  r := refinance_financing('00000000-0000-0000-0000-00000000cf36', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x');
  assert (select amount = 0 and late_fee_paid = 75 and status = 'paid'
            from financing_installments where sale_id = '00000000-0000-0000-0000-00000000cf36' and installment_number = 5);
  assert (r->>'first_installment')::int = 6, r::text;

  -- Corregir plan queda bloqueado (venta refinanciada sin abonos a cuotas, que
  -- es la única que el chequeo de abonos no frenaría).
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf37', '00000000-0000-0000-0000-00000000cf0d', 0);
  perform refinance_financing('00000000-0000-0000-0000-00000000cf37', 'capital', null, 4, 12, 'monthly', 'monthly_prorated', null, 'x');
  perform pg_temp.debe_fallar($q$select amend_sale_financing('00000000-0000-0000-0000-00000000cf37', 5, 12, 'monthly', 'monthly_prorated', 'x')$q$, '%refinanci%');

  -- Abonos: el de antes de refinanciar no se anula; uno posterior sí.
  select id into v_id from credit_payments where sale_id = '00000000-0000-0000-0000-00000000cf30' and amount = 6000;
  perform pg_temp.debe_fallar(format('select void_credit_payment(%L, %L)', v_id, 'x'), '%refinanci%');
  perform register_sale_payment('00000000-0000-0000-0000-00000000cf30', 800, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  select id into v_id from credit_payments where sale_id = '00000000-0000-0000-0000-00000000cf30' and amount = 800;
  perform void_credit_payment(v_id, 'abono equivocado');

  -- Segunda refinanciación: con 1,600 abonados (cuotas 5 y 6) el capital
  -- pendiente sale del plan vigente: 6,000 × 8,000 / 9,600 = 5,000.
  perform register_sale_payment('00000000-0000-0000-0000-00000000cf30', 1600, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  q := refinance_quote('financing', '00000000-0000-0000-0000-00000000cf30');
  assert (q->>'pending_capital')::numeric = 5000 and (q->>'pending_balance')::numeric = 8000, q::text;
  -- Reprogramar sigue funcionando sobre las cuotas nuevas.
  perform reschedule_financing_installments('00000000-0000-0000-0000-00000000cf30', 7,
    (select due_date + 5 from financing_installments
      where sale_id = '00000000-0000-0000-0000-00000000cf30' and installment_number = 7), false, 'x');
  r := refinance_financing('00000000-0000-0000-0000-00000000cf30', 'capital', null, 5, 6, 'monthly', 'monthly_prorated', null, 'otra vez');
  assert (r->>'new_principal')::numeric = 5000 and (r->>'first_installment')::int = 7, r::text;
  assert (select count(*) from refinancings where sale_id = '00000000-0000-0000-0000-00000000cf30') = 2;

  -- Abono general repartido entre dos ventas: si una se refinancia, no se anula.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf38', '00000000-0000-0000-0000-00000000cf0e', 0);
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf39', '00000000-0000-0000-0000-00000000cf0e', 0);
  perform register_customer_payment('00000000-0000-0000-0000-00000000cf0e', 25000, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  select id into v_id from sales
   where id in ('00000000-0000-0000-0000-00000000cf38', '00000000-0000-0000-0000-00000000cf39')
     and payment_status::text = 'in_financing'
   order by id limit 1;
  perform refinance_financing(v_id, 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x');
  select id into v_id from credit_payments where customer_id = '00000000-0000-0000-0000-00000000cf0e' and amount = 25000;
  perform pg_temp.debe_fallar(format('select void_credit_payment(%L, %L)', v_id, 'x'), '%refinanci%');

  -- Rechazos.
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf3a', '00000000-0000-0000-0000-00000000cf0f', 6000);
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf3a', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', current_date - 1, 'x')$q$, '%primera cuota%');
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf3a', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, '  ')$q$, '%motivo%');
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf3a', 'capital', null, 5, 61, 'monthly', 'monthly_prorated', null, 'x')$q$, '%entre 1 y 60%');
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf3a', 'otra', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x')$q$, '%base%');
  update sales set cancelled_at = now() where id = '00000000-0000-0000-0000-00000000cf3a';
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf3a', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x')$q$, '%no tiene un financiamiento%');
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf3b', '00000000-0000-0000-0000-00000000cf0f', 15000);
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf3b', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x')$q$, '%no tiene un financiamiento%');

  assert not has_function_privilege('anon', 'public.refinance_financing(uuid,text,text,numeric,integer,text,text,date,text)', 'EXECUTE'), 'anon puede refinanciar';
  assert not has_function_privilege('authenticated', 'public.build_financing_schedule(uuid,uuid,date,text,integer,numeric,numeric,date,integer)', 'EXECUTE'), 'schedule expuesto';

  -- Permisos (al final: cambian de usuario). El usuario de prueba es super
  -- admin de plataforma y pasa todos los chequeos, así que aquí se usan dos
  -- admins normales de la empresa b463: 8a7c952b (también miembro de la demo)
  -- y cc56c633 (solo de b463).
  perform pg_temp.venta_financiada('00000000-0000-0000-0000-00000000cf3c', '00000000-0000-0000-0000-00000000cf0f', 6000);

  -- De otra empresa: ni la ve.
  perform set_config('request.jwt.claims', '{"sub":"cc56c633-4b6c-4a8e-a7e8-6ee3a1934566","role":"authenticated"}', true);
  assert not is_super_admin() and current_company_id() <> aa, 'cc56c633 no es de otra empresa';
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf3c', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x')$q$, '%no encontrada%');
  perform pg_temp.debe_fallar($q$select refinance_quote('financing', '00000000-0000-0000-0000-00000000cf3c')$q$, '%no encontrada%');

  -- Cajero de la empresa: no puede. cc56c633 entra a la demo como cajero (los
  -- cambios de perfil los hace el super admin: un trigger no deja que otro
  -- usuario reasigne empresas, y otro no deja degradar al último admin).
  perform set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);
  insert into profile_companies (profile_id, company_id, role)
  values ('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', aa, 'cashier');
  update profiles set company_id = aa where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
  perform set_config('request.jwt.claims', '{"sub":"cc56c633-4b6c-4a8e-a7e8-6ee3a1934566","role":"authenticated"}', true);
  assert current_company_id() = aa and not is_company_admin(), 'el cajero de prueba es admin';
  perform pg_temp.debe_fallar($q$select refinance_financing('00000000-0000-0000-0000-00000000cf3c', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x')$q$, '%administrador%');
  perform pg_temp.debe_fallar($q$select refinance_quote('financing', '00000000-0000-0000-0000-00000000cf3c')$q$, '%administrador%');

  -- Admin normal de la empresa: sí. 8a7c952b ya es admin de la demo; solo se
  -- le cambia la empresa activa.
  perform set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);
  update profiles set company_id = aa where id = '8a7c952b-a951-4478-b82f-ae7c9ddc8ba3';
  perform set_config('request.jwt.claims', '{"sub":"8a7c952b-a951-4478-b82f-ae7c9ddc8ba3","role":"authenticated"}', true);
  assert is_company_admin() and not is_super_admin(), 'el admin de prueba no es admin normal';
  r := refinance_financing('00000000-0000-0000-0000-00000000cf3c', 'capital', null, 5, 12, 'monthly', 'monthly_prorated', null, 'x');
  assert (r->>'new_principal')::numeric = 6000, r::text;

  -- Los perfiles quedan como estaban, para que otras secciones no hereden
  -- el cajero ni la empresa activa.
  perform set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);
  delete from profile_companies
   where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and company_id = aa;
  update profiles set company_id = 'b463d8b5-b589-4194-b0c3-2a912b58b7c9'
   where id in ('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '8a7c952b-a951-4478-b82f-ae7c9ddc8ba3');
end $$;

-- == Task 4: préstamos ==
do $$
declare
  aa  constant uuid := '00000000-0000-0000-0000-0000000000aa';
  q   jsonb;
  r   jsonb;
  v_new uuid;
  v_id  uuid;
  rf  refinancings%rowtype;
begin
  perform pg_temp.prestamo('00000000-0000-0000-0000-00000000cf40', '00000000-0000-0000-0000-00000000cf05', 6000);
  q := refinance_quote('loan', '00000000-0000-0000-0000-00000000cf40');
  assert (q->>'pending_balance')::numeric = 9000 and (q->>'pending_capital')::numeric = 6000
     and (q->>'unearned_interest')::numeric = 3000 and (q->>'late_fee_due')::numeric = 0, q::text;
  assert q->'first_installment' = 'null'::jsonb and q->'terms'->>'interestMode' = 'monthly_prorated'
     and (q->'terms'->>'installments')::int = 10 and q->'terms'->>'frequency' = 'monthly', q::text;

  -- Renovación: base capital + 2,000, 12 al 5% → principal 8,000, arrastrado 6,000, total 12,800.
  r := refinance_loan('00000000-0000-0000-0000-00000000cf40', 'capital', null, 2000, 5, 12, 'monthly', null, 'renovación');
  v_new := (r->>'new_loan_id')::uuid;
  assert (r->>'new_principal')::numeric = 8000 and (r->>'carried_over_amount')::numeric = 6000
     and (r->>'total_with_interest')::numeric = 12800 and (r->>'installment_amount')::numeric = 1066.67, r::text;
  assert (select status from loans where id = '00000000-0000-0000-0000-00000000cf40') = 'refinanced';
  assert (select total_with_interest - amount_paid from loans where id = '00000000-0000-0000-0000-00000000cf40') = 0;
  assert (select count(*) from loan_installments where loan_id = '00000000-0000-0000-0000-00000000cf40') = 4;
  assert (select refinanced_from_id = '00000000-0000-0000-0000-00000000cf40' and carried_over_amount = 6000
                 and status = 'active' and customer_id = '00000000-0000-0000-0000-00000000cf05'
                 and branch_id = '00000000-0000-0000-0000-0000000000b1' and created_by = auth.uid()
            from loans where id = v_new);
  assert (select due_date from loan_installments where loan_id = v_new and installment_number = 1)
       = financing_due_date(company_today(aa), 'monthly', 1);
  select * into rf from refinancings where loan_id = '00000000-0000-0000-0000-00000000cf40';
  assert rf.kind = 'loan' and rf.new_loan_id = v_new and rf.additional_amount = 2000 and rf.new_principal = 8000
     and rf.pending_capital = 6000 and jsonb_array_length(rf.plan_before->'installments') = 10, row_to_json(rf)::text;

  -- El viejo queda cerrado.
  perform pg_temp.debe_fallar($q$select register_loan_payment('00000000-0000-0000-0000-00000000cf40', 100, 'transfer', null, null, null)$q$, '%refinanciado%');
  select id into v_id from loan_payments where loan_id = '00000000-0000-0000-0000-00000000cf40';
  perform pg_temp.debe_fallar(format('select void_loan_payment(%L, %L)', v_id, 'x'), '%refinanci%');
  perform pg_temp.debe_fallar($q$select refinance_loan('00000000-0000-0000-0000-00000000cf40', 'capital', null, 0, 5, 12, 'monthly', null, 'x')$q$, '%ya fue refinanciado%');
  -- El nuevo cobra y anula normal.
  perform register_loan_payment(v_new, 1066.67, 'transfer', null, null, null);
  select id into v_id from loan_payments where loan_id = v_new;
  perform void_loan_payment(v_id, 'abono equivocado');

  -- Base saldo: 9,000.
  perform pg_temp.prestamo('00000000-0000-0000-0000-00000000cf41', '00000000-0000-0000-0000-00000000cf05', 6000);
  r := refinance_loan('00000000-0000-0000-0000-00000000cf41', 'balance', null, 0, 5, 12, 'monthly', null, 'x');
  assert (r->>'new_principal')::numeric = 9000 and (r->>'carried_over_amount')::numeric = 9000, r::text;

  -- Mora sumada (cuota 5 vencida hace 10 días: 75) y perdonada.
  perform pg_temp.prestamo('00000000-0000-0000-0000-00000000cf42', '00000000-0000-0000-0000-00000000cf05', 6000);
  update loan_installments set due_date = company_today(aa) - 10
   where loan_id = '00000000-0000-0000-0000-00000000cf42' and installment_number = 5;
  q := refinance_quote('loan', '00000000-0000-0000-0000-00000000cf42');
  assert (q->>'late_fee_due')::numeric = 75, q::text;
  perform pg_temp.debe_fallar($q$select refinance_loan('00000000-0000-0000-0000-00000000cf42', 'capital', null, 0, 5, 12, 'monthly', null, 'x')$q$, '%mora%');
  r := refinance_loan('00000000-0000-0000-0000-00000000cf42', 'capital', 'capitalize', 500, 5, 12, 'monthly', null, 'x');
  assert (r->>'new_principal')::numeric = 6575 and (r->>'carried_over_amount')::numeric = 6075, r::text;
  perform pg_temp.prestamo('00000000-0000-0000-0000-00000000cf43', '00000000-0000-0000-0000-00000000cf05', 6000);
  update loan_installments set due_date = company_today(aa) - 10
   where loan_id = '00000000-0000-0000-0000-00000000cf43' and installment_number = 5;
  r := refinance_loan('00000000-0000-0000-0000-00000000cf43', 'capital', 'forgive', 0, 5, 12, 'monthly', null, 'x');
  assert (r->>'new_principal')::numeric = 6000, r::text;
  assert (select late_fee_amount = 75 and late_fee_action = 'forgive' from refinancings where loan_id = '00000000-0000-0000-0000-00000000cf43');

  -- Primera cuota elegida.
  perform pg_temp.prestamo('00000000-0000-0000-0000-00000000cf44', '00000000-0000-0000-0000-00000000cf05', 6000);
  r := refinance_loan('00000000-0000-0000-0000-00000000cf44', 'capital', null, 0, 5, 3, 'weekly', company_today(aa) + 3, 'x');
  assert (select array_agg(due_date order by installment_number) from loan_installments where loan_id = (r->>'new_loan_id')::uuid)
       = array[company_today(aa) + 3, company_today(aa) + 10, company_today(aa) + 17], r::text;

  -- Rechazos.
  perform pg_temp.prestamo('00000000-0000-0000-0000-00000000cf45', '00000000-0000-0000-0000-00000000cf05', 6000);
  perform pg_temp.debe_fallar($q$select refinance_loan('00000000-0000-0000-0000-00000000cf45', 'capital', null, -1, 5, 12, 'monthly', null, 'x')$q$, '%adicional%');
  perform pg_temp.debe_fallar($q$select refinance_loan('00000000-0000-0000-0000-00000000cf45', 'capital', null, 0, 5, 12, 'monthly', current_date, 'x')$q$, '%primera cuota%');
  perform pg_temp.debe_fallar($q$select refinance_loan('00000000-0000-0000-0000-00000000cf45', 'capital', null, 0, 5, 12, 'monthly', null, '')$q$, '%motivo%');
  perform pg_temp.prestamo('00000000-0000-0000-0000-00000000cf46', '00000000-0000-0000-0000-00000000cf05', 15000);
  perform pg_temp.debe_fallar($q$select refinance_loan('00000000-0000-0000-0000-00000000cf46', 'capital', null, 0, 5, 12, 'monthly', null, 'x')$q$, '%no está activo%');
  assert not has_function_privilege('anon', 'public.refinance_loan(uuid,text,text,numeric,numeric,integer,text,date,text)', 'EXECUTE'), 'anon puede refinanciar préstamos';

  -- Permisos: otra empresa no lo ve; un cajero de la empresa no puede.
  perform set_config('request.jwt.claims', '{"sub":"cc56c633-4b6c-4a8e-a7e8-6ee3a1934566","role":"authenticated"}', true);
  perform pg_temp.debe_fallar($q$select refinance_loan('00000000-0000-0000-0000-00000000cf45', 'capital', null, 0, 5, 12, 'monthly', null, 'x')$q$, '%no encontrado%');
  perform set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);
  insert into profile_companies (profile_id, company_id, role)
  values ('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', aa, 'cashier')
  on conflict do nothing;
  update profiles set company_id = aa where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
  perform set_config('request.jwt.claims', '{"sub":"cc56c633-4b6c-4a8e-a7e8-6ee3a1934566","role":"authenticated"}', true);
  perform pg_temp.debe_fallar($q$select refinance_loan('00000000-0000-0000-0000-00000000cf45', 'capital', null, 0, 5, 12, 'monthly', null, 'x')$q$, '%administrador%');
  perform set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);
  delete from profile_companies
   where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and company_id = aa;
  update profiles set company_id = 'b463d8b5-b589-4194-b0c3-2a912b58b7c9'
   where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
end $$;

select 'ok' as resultado;
