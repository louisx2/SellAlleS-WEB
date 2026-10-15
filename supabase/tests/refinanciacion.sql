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

select 'ok' as resultado;
