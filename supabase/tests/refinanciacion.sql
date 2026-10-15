-- Pruebas de la refinanciación. NO es una migración: se corre contra producción
-- dentro de una transacción que se revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261016090000_refinanciacion.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`; si una aserción falla, la llamada
-- devuelve el error con su mensaje. Cada sección crea sus propios datos con
-- UUID fijos (…cfXX) en la empresa demo y no depende de las demás.

select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);

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

select 'ok' as resultado;
