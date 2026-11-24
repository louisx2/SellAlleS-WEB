-- Pruebas de los ajustes del módulo Motopréstamos, las fotos, la custodia por
-- defecto, exigir garante y la moto en el portal (2C). NO es una migración: se
-- corre contra producción dentro de una transacción que se revierte, después del
-- SQL de las migraciones:
--
--   begin; <20261124200000_motos_ajustes_y_fotos.sql> <20261124210000_motos_reglas_y_portal.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Datos con UUID fijos (…e5XX) en la
-- empresa demo, sucursal Principal (…0b1). La RLS se prueba con `set local role`.

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

create function pg_temp.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ---------------------------------------------------------------------------
-- 1. Ajustes y fotos (Task 1)
-- ---------------------------------------------------------------------------

-- Ajustes de la demo con los valores por defecto.
insert into motos_settings (company_id) values ('00000000-0000-0000-0000-0000000000aa');
select pg_temp.igual((select custody_financed_sale from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa'), true, 'custodia financiada por defecto');
select pg_temp.igual((select custody_cash_sale from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa'), false, 'custodia contado por defecto');
select pg_temp.igual((select custody_loan from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa'), true, 'custodia préstamo por defecto');
select pg_temp.igual((select require_guarantor from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa'), false, 'garante por defecto');
select pg_temp.igual((select contract_sale from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa'), null::text, 'contrato de venta vacío');

-- Una moto y un cliente con su foto.
insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
  ('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba moto fotos', 95000, 70000, 0, true);
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis) values
  ('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'inventario', '00000000-0000-0000-0000-00000000e501', 'Honda', 'C70', 'FOTO-1');
insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e503', '00000000-0000-0000-0000-0000000000aa', 'Prueba cédula fotos');
insert into vehicle_photos (company_id, vehicle_id, path) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-0000000000aa/vehiculos/e502/a.jpg');
insert into customer_photos (company_id, customer_id, path) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e503', '00000000-0000-0000-0000-0000000000aa/clientes/e503/a.jpg');
select pg_temp.igual((select kind from customer_photos where customer_id = '00000000-0000-0000-0000-00000000e503'), 'cedula'::text, 'tipo de foto por defecto');
select pg_temp.debe_fallar($q$insert into customer_photos (company_id, customer_id, kind, path)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e503', 'selfie', 'x')$q$, '%check%');

-- anon no tiene nada; el bucket es privado y tiene sus tres políticas.
select pg_temp.igual(has_table_privilege('anon', 'public.motos_settings', 'SELECT'), false, 'anon y ajustes');
select pg_temp.igual(has_table_privilege('anon', 'public.vehicle_photos', 'SELECT'), false, 'anon y fotos de motos');
select pg_temp.igual(has_table_privilege('anon', 'public.customer_photos', 'SELECT'), false, 'anon y fotos de clientes');
select pg_temp.igual((select public from storage.buckets where id = 'motos'), false, 'bucket privado');
select pg_temp.igual((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
                       and policyname like 'motos_fotos_%'), 3, 'políticas del bucket');

-- Con RLS: otra empresa no ve fotos ni ajustes; el super admin sí.
set local role authenticated;
select pg_temp.igual((select count(*)::int from vehicle_photos where vehicle_id = '00000000-0000-0000-0000-00000000e502'), 1, 'super admin ve la foto');
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
select pg_temp.igual((select count(*)::int from vehicle_photos where vehicle_id = '00000000-0000-0000-0000-00000000e502'), 0, 'otra empresa no ve fotos de motos');
select pg_temp.igual((select count(*)::int from customer_photos where customer_id = '00000000-0000-0000-0000-00000000e503'), 0, 'otra empresa no ve fotos de clientes');
select pg_temp.igual((select count(*)::int from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa'), 0, 'otra empresa no ve ajustes');
select pg_temp.debe_fallar($q$insert into vehicle_photos (company_id, vehicle_id, path)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e502', 'x')$q$, '%row-level security%');
reset role;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

-- Un cajero de la demo (sin motos-config) no cambia los ajustes.
insert into profile_companies (profile_id, company_id, role)
select 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa', 'cashier'
 where not exists (select 1 from profile_companies
                    where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566'
                      and company_id = '00000000-0000-0000-0000-0000000000aa');
update profiles set company_id = '00000000-0000-0000-0000-0000000000aa'
 where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
insert into profile_branches (profile_id, company_id, branch_id, role_id)
select 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa',
       '00000000-0000-0000-0000-0000000000b1', 'd7bb7626-3aa0-4f4b-9b1b-eb61264a4b04'
 where not exists (select 1 from profile_branches
                    where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566'
                      and branch_id = '00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
select pg_temp.igual((select count(*)::int from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa'), 1, 'el cajero ve los ajustes');
update motos_settings set require_guarantor = true where company_id = '00000000-0000-0000-0000-0000000000aa';
reset role;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
select pg_temp.igual((select require_guarantor from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa'), false, 'el cajero no cambió los ajustes');

-- Las fotos se van con su moto y su cliente.
delete from vehicles where id = '00000000-0000-0000-0000-00000000e502';
delete from customers where id = '00000000-0000-0000-0000-00000000e503';
select pg_temp.igual((select count(*)::int from vehicle_photos where vehicle_id = '00000000-0000-0000-0000-00000000e502'), 0, 'fotos de la moto borradas');
select pg_temp.igual((select count(*)::int from customer_photos where customer_id = '00000000-0000-0000-0000-00000000e503'), 0, 'fotos del cliente borradas');
delete from motos_settings where company_id = '00000000-0000-0000-0000-0000000000aa';

-- ---------------------------------------------------------------------------
-- 2. Custodia por defecto, exigir garante y portal (Task 2)
-- ---------------------------------------------------------------------------

-- Vende por create_sale_with_items una moto (de contado o financiada).
create function pg_temp.vender(p_vehicle uuid, p_customer uuid, p_method text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select s.id into v_id from create_sale_with_items(
    jsonb_build_object(
      'branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', p_customer,
      'subtotal', 95000, 'itbis_amount', 0, 'total', 95000,
      'payment_method', p_method,
      'payment_status', case when p_method = 'financing' then 'in_financing' else 'paid' end,
      'amount_paid', case when p_method = 'financing' then 0 else 95000 end,
      'financing_details', case when p_method = 'financing'
        then '{"interestRate":5,"installments":12,"frequency":"monthly","interestMode":"monthly_prorated"}'::jsonb end),
    jsonb_build_array(jsonb_build_object(
      'product_id', '00000000-0000-0000-0000-00000000e510', 'product_name', 'Moto', 'quantity', 1, 'price', 95000,
      'itbis', false, 'unit', 'und', 'vehicle_id', p_vehicle))) s;
  return v_id;
end $$;

-- Préstamo como lo crea el front (insert directo).
create function pg_temp.prestamo(p_customer uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into loans (branch_id, customer_id, principal, interest_rate, installments_count, payment_frequency, disbursement_method)
  values ('00000000-0000-0000-0000-0000000000b1', p_customer, 5000, 5, 2, 'monthly', 'transfer')
  returning id into v_id;
  return v_id;
end $$;

create function pg_temp.matricula(p_id uuid) returns text
language sql as $$ select registration_status from vehicles where id = p_id $$;

insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'motoprestamos', true), ('00000000-0000-0000-0000-0000000000aa', 'customer-portal', true)
on conflict (company_id, module_key) do update set enabled = true;
insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
  ('00000000-0000-0000-0000-00000000e510', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba moto ajustes', 95000, 70000, 0, true);
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis, plate) values
  ('00000000-0000-0000-0000-00000000e511', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e510', 'Honda', 'C70', 'AJ-1', 'P-1'),
  ('00000000-0000-0000-0000-00000000e512', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e510', 'Honda', 'C70', 'AJ-2', 'P-2'),
  ('00000000-0000-0000-0000-00000000e513', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e510', 'Honda', 'C70', 'AJ-3', 'P-3'),
  ('00000000-0000-0000-0000-00000000e514', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e510', 'Honda', 'C70', 'AJ-4', 'P-4'),
  ('00000000-0000-0000-0000-00000000e515', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e510', 'Honda', 'C70', 'AJ-5', 'P-5'),
  ('00000000-0000-0000-0000-00000000e516', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e510', 'Honda', 'C70', 'AJ-6', 'P-6');
insert into customers (id, company_id, name, rnc) values
  ('00000000-0000-0000-0000-00000000e520', '00000000-0000-0000-0000-0000000000aa', 'Prueba sin garante', null),
  ('00000000-0000-0000-0000-00000000e521', '00000000-0000-0000-0000-0000000000aa', 'Prueba con garante', '99999999901');

do $$
declare
  sin constant uuid := '00000000-0000-0000-0000-00000000e520';
  con constant uuid := '00000000-0000-0000-0000-00000000e521';
  l_vieja uuid; l_moto uuid; l_sin_moto uuid;
  r jsonb; b jsonb;
begin
  -- Sin fila de ajustes: lo de siempre.
  perform pg_temp.vender('00000000-0000-0000-0000-00000000e511', sin, 'cash');
  perform pg_temp.igual(pg_temp.matricula('00000000-0000-0000-0000-00000000e511'), 'entregada', 'contado sin ajustes');
  perform pg_temp.vender('00000000-0000-0000-0000-00000000e512', sin, 'financing');
  perform pg_temp.igual(pg_temp.matricula('00000000-0000-0000-0000-00000000e512'), 'en_custodia', 'financiada sin ajustes');

  -- Custodia en contado encendida y en financiada apagada.
  insert into motos_settings (company_id, custody_cash_sale, custody_financed_sale)
  values ('00000000-0000-0000-0000-0000000000aa', true, false);
  perform pg_temp.vender('00000000-0000-0000-0000-00000000e513', sin, 'cash');
  perform pg_temp.igual(pg_temp.matricula('00000000-0000-0000-0000-00000000e513'), 'lista_para_entregar', 'contado con custodia');
  perform pg_temp.vender('00000000-0000-0000-0000-00000000e514', sin, 'financing');
  perform pg_temp.igual(pg_temp.matricula('00000000-0000-0000-0000-00000000e514'), 'entregada', 'financiada sin custodia');

  -- Exigir garante.
  l_vieja := pg_temp.prestamo(sin);   -- antes de exigirlo
  update motos_settings set require_guarantor = true, custody_cash_sale = false, custody_financed_sale = true
   where company_id = '00000000-0000-0000-0000-0000000000aa';
  perform pg_temp.debe_fallar(format('select pg_temp.prestamo(%L)', sin), '%no tiene garante%');
  insert into customer_guarantors (company_id, customer_id, name)
  values ('00000000-0000-0000-0000-0000000000aa', con, 'Garante de prueba');
  l_sin_moto := pg_temp.prestamo(con);
  r := refinance_loan(l_vieja, 'balance', null, 0, 5, 2, 'monthly', null, 'prueba');
  perform pg_temp.igual((select status from loans where id = l_vieja), 'refinanced', 'refinanciación sin garante pasa');
  perform pg_temp.debe_fallar(format('select pg_temp.vender(%L, %L, %L)', '00000000-0000-0000-0000-00000000e515', sin, 'financing'), '%no tiene garante%');
  perform pg_temp.vender('00000000-0000-0000-0000-00000000e516', sin, 'cash');
  perform pg_temp.igual(pg_temp.matricula('00000000-0000-0000-0000-00000000e516'), 'entregada', 'contado sin garante pasa');
  update company_modules set enabled = false
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'motoprestamos';
  perform pg_temp.prestamo(sin);  -- con el módulo apagado no se exige
  update company_modules set enabled = true
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'motoprestamos';

  -- Portal: el préstamo con moto trae su moto; el otro, []; la matrícula lista sale arriba.
  l_moto := motos_crear_prestamo(
    jsonb_build_object('branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', con,
      'principal', 10000, 'interest_rate', 10, 'installments_count', 4, 'payment_frequency', 'weekly',
      'disbursement_method', 'transfer'),
    jsonb_build_object('vehiculo', jsonb_build_object('brand', 'Suzuki', 'model', 'AX100', 'chassis', 'AJ-PORTAL', 'plate', 'P-777'),
      'matricula_en_custodia', true));
  perform register_loan_payment(l_moto, (select total_with_interest from loans where id = l_moto), 'transfer',
                                '00000000-0000-0000-0000-0000000000b1', null, null);
  r := resolve_portal_customers('99999999901');
  perform pg_temp.igual(jsonb_array_length(r), 1, 'una empresa en el portal');
  b := r->0;
  perform pg_temp.igual((select l->'vehicles'->0->>'plate' from jsonb_array_elements(b->'loans') l where l->>'id' = l_moto::text), 'P-777', 'placa en el préstamo');
  perform pg_temp.igual((select l->'vehicles'->0->>'registrationStatus' from jsonb_array_elements(b->'loans') l where l->>'id' = l_moto::text), 'lista_para_entregar', 'matrícula del préstamo');
  perform pg_temp.igual((select l->'vehicles' from jsonb_array_elements(b->'loans') l where l->>'id' = l_sin_moto::text), '[]'::jsonb, 'préstamo sin moto');
  perform pg_temp.igual((select jsonb_array_length(l->'installments') from jsonb_array_elements(b->'loans') l where l->>'id' = l_moto::text), 4, 'cuotas en el portal');
  perform pg_temp.igual((select jsonb_array_length(l->'payments') from jsonb_array_elements(b->'loans') l where l->>'id' = l_moto::text), 1, 'abonos en el portal');
  perform pg_temp.igual(jsonb_array_length(b->'registrationsReady'), 1, 'matrículas listas');
  perform pg_temp.igual(b->'registrationsReady'->0->>'plate', 'P-777', 'matrícula lista del cliente');
  perform pg_temp.igual(position('P-3' in b::text), 0, 'no salen motos de otro cliente');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Revisión final: ajustes con columnas nuevas, módulo apagado y portal
-- ---------------------------------------------------------------------------

-- La función del portal solo la llama el servidor (portal-data).
select pg_temp.igual(has_function_privilege('anon', 'public.resolve_portal_customers(text)', 'EXECUTE'), false, 'anon y portal');
select pg_temp.igual(has_function_privilege('authenticated', 'public.resolve_portal_customers(text)', 'EXECUTE'), false, 'authenticated y portal');

do $$
begin
  -- Con el módulo apagado, un ajuste viejo de «exigir garante» no traba la venta
  -- financiada de una moto (igual que los préstamos).
  update company_modules set enabled = false
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'motoprestamos';
  perform pg_temp.vender('00000000-0000-0000-0000-00000000e515', '00000000-0000-0000-0000-00000000e520', 'financing');
  perform pg_temp.igual(pg_temp.matricula('00000000-0000-0000-0000-00000000e515'), 'en_custodia', 'financiada con el módulo apagado');
  update company_modules set enabled = true
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'motoprestamos';

  -- Una columna nueva en los ajustes (p. ej. el texto de WhatsApp de la entrega 3)
  -- no rompe la lectura de los ajustes, con o sin fila.
  alter table motos_settings add column prueba_columna_nueva text;
  perform pg_temp.igual((motos_ajuste('00000000-0000-0000-0000-0000000000aa')).require_guarantor, true, 'ajustes con fila y columna nueva');
  perform pg_temp.igual((motos_ajuste('b463d8b5-b589-4194-b0c3-2a912b58b7c9')).custody_loan, true, 'ajustes por defecto con columna nueva');
end $$;

select 'ok';
