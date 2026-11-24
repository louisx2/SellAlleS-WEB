-- Pruebas de los datos del cliente para Motopréstamos (2B): datos de cobranza,
-- garantes y referencias. NO es una migración: se corre contra producción dentro
-- de una transacción que se revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261124180000_motos_datos_del_cliente.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Datos con UUID fijos (…e3XX) en la
-- empresa demo. La prueba de RLS cambia a `authenticated` con `set local role`.

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

-- Cliente de la demo con sus datos de cobranza.
insert into customers (id, company_id, name, nickname, workplace, zone, collection_address, collection_reference) values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-0000000000aa', 'Prueba motoconcho',
   'El Flaco', 'Parada del parque', 'Pueblo Abajo', 'Calle 5 #12', 'Frente al colmado');
select pg_temp.igual((select zone from customers where id = '00000000-0000-0000-0000-00000000e301'), 'Pueblo Abajo'::text, 'zona');
select pg_temp.igual((select nickname from customers where id = '00000000-0000-0000-0000-00000000e301'), 'El Flaco'::text, 'apodo');

-- Dos garantes y una referencia.
insert into customer_guarantors (id, company_id, customer_id, name, id_doc, phone, address, relationship) values
  ('00000000-0000-0000-0000-00000000e311', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e301',
   'Juana Pérez', '001-0000000-1', '809-555-0001', 'Calle 3', 'Madre'),
  ('00000000-0000-0000-0000-00000000e312', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e301',
   'Pedro Gómez', null, '809-555-0002', null, 'Amigo');
insert into customer_references (id, company_id, customer_id, name, phone, relationship) values
  ('00000000-0000-0000-0000-00000000e321', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e301',
   'Colmado Don Luis', '809-555-0003', 'Comercio');
select pg_temp.igual((select count(*)::int from customer_guarantors where customer_id = '00000000-0000-0000-0000-00000000e301'), 2, 'garantes');

-- Garante sin nombre: no.
select pg_temp.debe_fallar($q$
  insert into customer_guarantors (company_id, customer_id, name)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e301', '  ')$q$, '%check%');

-- anon no lee nada.
select pg_temp.igual(has_table_privilege('anon', 'public.customer_guarantors', 'SELECT'), false, 'anon y garantes');
select pg_temp.igual(has_table_privilege('anon', 'public.customer_references', 'SELECT'), false, 'anon y referencias');

-- Con RLS: el super admin los ve; un admin de otra empresa (cc56c633, solo de
-- b463) no ve ninguno ni puede crearlos en este cliente.
set local role authenticated;
select pg_temp.igual((select count(*)::int from customer_guarantors where customer_id = '00000000-0000-0000-0000-00000000e301'), 2, 'super admin ve los garantes');
select set_config('request.jwt.claims', '{"sub":"cc56c633-4b6c-4a8e-a7e8-6ee3a1934566","role":"authenticated"}', true);
select pg_temp.igual((select count(*)::int from customer_guarantors where customer_id = '00000000-0000-0000-0000-00000000e301'), 0, 'otra empresa no ve garantes');
select pg_temp.igual((select count(*)::int from customer_references where customer_id = '00000000-0000-0000-0000-00000000e301'), 0, 'otra empresa no ve referencias');
select pg_temp.debe_fallar($q$
  insert into customer_guarantors (company_id, customer_id, name)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e301', 'Intruso')$q$, '%row-level security%');
reset role;
select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);

-- Borrar el cliente borra sus garantes y referencias.
delete from customers where id = '00000000-0000-0000-0000-00000000e301';
select pg_temp.igual((select count(*)::int from customer_guarantors where customer_id = '00000000-0000-0000-0000-00000000e301'), 0, 'garantes borrados');
select pg_temp.igual((select count(*)::int from customer_references where customer_id = '00000000-0000-0000-0000-00000000e301'), 0, 'referencias borradas');

select 'ok';
