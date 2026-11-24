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

select 'ok';
