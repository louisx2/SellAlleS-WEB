-- Pruebas de vehículos con chasis y stock por unidad (Motopréstamos 2A). NO es
-- una migración: se corre contra producción dentro de una transacción que se
-- revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261124150000_motos_vehiculos.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Datos con UUID fijos (…e1XX) en la
-- empresa demo (sucursal Principal …0b1 y "Sucursal Prueba" 169fe6bb…).

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

create function pg_temp.stock(p_id uuid) returns numeric
language sql as $$ select stock from products where id = p_id $$;

-- Un artículo-vehículo y dos normales en la sucursal Principal; un cliente.
insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Prueba moto CG 150', 95000, 70000, 0, true),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Prueba casco', 2500, 1200, 10, false),
  ('00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Prueba moto con stock', 90000, 60000, 3, false);
insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e110', '00000000-0000-0000-0000-0000000000aa', 'Prueba dueño de moto');

-- Dos unidades de inventario: el stock del artículo pasa a 2.
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, year, color, chassis, engine_number, cost) values
  ('00000000-0000-0000-0000-00000000e111', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'inventario', '00000000-0000-0000-0000-00000000e101', 'Honda', 'CG 150', 2025, 'Roja', '  abc 123 ', 'M-1', 70000),
  ('00000000-0000-0000-0000-00000000e112', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'inventario', '00000000-0000-0000-0000-00000000e101', 'Honda', 'CG 150', 2025, 'Negra', 'XYZ999', null, 71000);
select pg_temp.igual(pg_temp.stock('00000000-0000-0000-0000-00000000e101'), 2::numeric, 'stock con 2 unidades');
select pg_temp.igual((select status from vehicles where id = '00000000-0000-0000-0000-00000000e111'), 'disponible'::text, 'estado al ingresar');
select pg_temp.igual((select chassis from vehicles where id = '00000000-0000-0000-0000-00000000e111'), 'abc 123'::text, 'chasis recortado');
select pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = '00000000-0000-0000-0000-00000000e111' and kind = 'ingreso'), 1, 'evento de ingreso');

-- Una moto en garantía (del cliente) no toca el stock y queda en garantía.
insert into vehicles (id, company_id, branch_id, origin, customer_id, brand, model, chassis) values
  ('00000000-0000-0000-0000-00000000e113', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'garantia', '00000000-0000-0000-0000-00000000e110', 'Yamaha', 'YBR', 'GAR-1');
select pg_temp.igual((select status from vehicles where id = '00000000-0000-0000-0000-00000000e113'), 'en_garantia'::text, 'estado en garantía');
select pg_temp.igual(pg_temp.stock('00000000-0000-0000-0000-00000000e101'), 2::numeric, 'la garantía no suma stock');
select pg_temp.debe_fallar($$insert into vehicles (company_id, branch_id, origin, brand, chassis)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'garantia', 'Suzuki', 'GAR-2')$$, '%vehicles_origen_check%');

-- Chasis único por empresa, sin importar mayúsculas ni espacios.
select pg_temp.debe_fallar($$insert into vehicles (company_id, branch_id, origin, product_id, chassis)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario',
          '00000000-0000-0000-0000-00000000e101', 'ABC123')$$, '%vehicles_chassis_uq%');

-- El cliente no cambia el estado a vendido; sí puede dar de baja una disponible.
select pg_temp.debe_fallar($$update vehicles set status = 'vendido' where id = '00000000-0000-0000-0000-00000000e112'$$, '%lo hace el sistema%');
update vehicles set status = 'baja', notes = 'robada' where id = '00000000-0000-0000-0000-00000000e112';
select pg_temp.igual(pg_temp.stock('00000000-0000-0000-0000-00000000e101'), 1::numeric, 'stock tras la baja');
select pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = '00000000-0000-0000-0000-00000000e112' and kind = 'baja'), 1, 'evento de baja');
-- Con la de baja, su chasis se puede volver a usar.
insert into vehicles (company_id, branch_id, origin, product_id, chassis)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario',
        '00000000-0000-0000-0000-00000000e101', 'xyz 999');
select pg_temp.igual(pg_temp.stock('00000000-0000-0000-0000-00000000e101'), 2::numeric, 'stock con el chasis reusado');

-- Editar datos descriptivos queda en el historial.
update vehicles set color = 'Azul', plate = 'K000001' where id = '00000000-0000-0000-0000-00000000e111';
select pg_temp.igual((select note from vehicle_events where vehicle_id = '00000000-0000-0000-0000-00000000e111' and kind = 'edicion'), 'Cambió: color, placa'::text, 'evento de edición');

-- El stock de un artículo-vehículo solo lo mueven sus unidades.
select pg_temp.debe_fallar($$update products set stock = 5 where id = '00000000-0000-0000-0000-00000000e101'$$, '%las mueven sus unidades%');
update products set stock = 7 where id = '00000000-0000-0000-0000-00000000e102';
select pg_temp.igual(pg_temp.stock('00000000-0000-0000-0000-00000000e102'), 7::numeric, 'un artículo normal sigue igual');
select pg_temp.debe_fallar($$update products set is_vehicle = true where id = '00000000-0000-0000-0000-00000000e103'$$, '%deja sus existencias en 0%');
select pg_temp.debe_fallar($$update products set is_vehicle = false where id = '00000000-0000-0000-0000-00000000e101'$$, '%dalos de baja%');
select pg_temp.debe_fallar($$insert into products (company_id, branch_id, name, stock, is_vehicle)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba moto nueva', 4, true)$$, '%deja sus existencias en 0%');

-- La unidad tiene que ser de un artículo-vehículo de su misma sucursal.
select pg_temp.debe_fallar($$insert into vehicles (company_id, branch_id, origin, product_id, chassis)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario',
          '00000000-0000-0000-0000-00000000e102', 'NOVEH-1')$$, '%artículo-vehículo%');
select pg_temp.debe_fallar($$insert into vehicles (company_id, branch_id, origin, product_id, chassis)
  values ('00000000-0000-0000-0000-0000000000aa', '169fe6bb-91fa-4633-8e43-5a45e410e2b0', 'inventario',
          '00000000-0000-0000-0000-00000000e101', 'OTRASUC-1')$$, '%artículo-vehículo%');

-- La descripción de la línea de venta (espejo de vehicleLineName en src/lib/motos.ts):
-- chasis y motor antes que año y color, porque el e-CF corta el nombre a 80.
select pg_temp.igual(motos_descripcion(v), 'Honda CG 150 · Chasis abc 123 · Motor M-1 · 2025 · Azul'::text, 'descripción completa')
  from vehicles v where v.id = '00000000-0000-0000-0000-00000000e111';
select pg_temp.igual(motos_descripcion(v), 'Yamaha YBR · Chasis GAR-1'::text, 'descripción sin año ni motor')
  from vehicles v where v.id = '00000000-0000-0000-0000-00000000e113';

-- Nada de esto lo ejecuta anon.
select pg_temp.igual(has_function_privilege('anon', 'public.motos_recalcular_stock(uuid)', 'EXECUTE'), false, 'anon recalcula');
select pg_temp.igual(has_function_privilege('anon', 'public.motos_tiene_permiso(uuid,text,text)', 'EXECUTE'), false, 'anon permiso');
select pg_temp.igual(has_table_privilege('anon', 'public.vehicles', 'SELECT'), false, 'anon ve vehículos');
select pg_temp.igual(has_table_privilege('authenticated', 'public.vehicle_events', 'INSERT'), false, 'authenticated escribe historial');

select 'ok' as resultado;
