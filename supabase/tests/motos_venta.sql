-- Pruebas de venta y anulación por chasis (Motopréstamos 2A). NO es una
-- migración: se corre contra producción dentro de una transacción que se
-- revierte, después de las dos migraciones de 2A:
--
--   begin; <20261124150000_motos_vehiculos.sql> <20261124160000_motos_venta_por_chasis.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Datos con UUID fijos (…e2XX) en la
-- empresa demo. La demo emite e-CF: dentro de la transacción no sale nada, y
-- antes de anular se marca el comprobante como rechazado (anula sin E34).

select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);
-- El súper admin opera en la demo (lo revierte el rollback).
update profiles set company_id = '00000000-0000-0000-0000-0000000000aa' where id = '92381752-13b2-4f43-8b09-612647754599';

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

-- Vende por create_sale_with_items una línea del artículo e201 (o el que se
-- diga) con ese vehículo. Devuelve el id de la venta.
create function pg_temp.vender(p_vehicle uuid, p_method text,
                               p_customer uuid default '00000000-0000-0000-0000-00000000e210',
                               p_qty numeric default 1,
                               p_product uuid default '00000000-0000-0000-0000-00000000e201') returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select s.id into v_id from create_sale_with_items(
    jsonb_build_object(
      'branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', p_customer,
      'subtotal', 95000 * p_qty, 'itbis_amount', 0, 'total', 95000 * p_qty,
      'payment_method', p_method,
      'payment_status', case when p_method = 'financing' then 'in_financing' else 'paid' end,
      'amount_paid', case when p_method = 'financing' then 0 else 95000 * p_qty end,
      'financing_details', case when p_method = 'financing'
        then '{"interestRate":5,"installments":12,"frequency":"monthly","interestMode":"monthly_prorated"}'::jsonb end),
    jsonb_build_array(jsonb_build_object(
      'product_id', p_product, 'product_name', 'Moto', 'quantity', p_qty, 'price', 95000,
      'itbis', false, 'unit', 'und', 'vehicle_id', p_vehicle))) s;
  return v_id;
end $$;

insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e210', '00000000-0000-0000-0000-0000000000aa', 'Prueba comprador de moto');
insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
  ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba moto venta', 95000, 70000, 0, true),
  ('00000000-0000-0000-0000-00000000e203', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba otra moto', 80000, 60000, 0, true);
insert into products (id, company_id, branch_id, name, price, cost, stock) values
  ('00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba casco venta', 2500, 1200, 5);
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis, engine_number, cost) values
  ('00000000-0000-0000-0000-00000000e211', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e201', 'Honda', 'CG 150', 'V-1', null, 70000),
  ('00000000-0000-0000-0000-00000000e212', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e201', 'Honda', 'CG 150', 'V-2', 'E-2', 72000),
  ('00000000-0000-0000-0000-00000000e213', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e201', 'Honda', 'CG 150', 'V-3', null, 71000),
  ('00000000-0000-0000-0000-00000000e214', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e203', 'Suzuki', 'GN 125', 'V-4', null, 60000);
select pg_temp.igual((select stock from products where id = '00000000-0000-0000-0000-00000000e201'), 3::numeric, 'stock inicial');

do $$
declare
  s_contado uuid;
  s_cuotas  uuid;
  s_normal  uuid;
begin
  -- De contado: la unidad pasa a vendida, la matrícula se entrega, el stock baja.
  s_contado := pg_temp.vender('00000000-0000-0000-0000-00000000e211', 'cash');
  perform pg_temp.igual((select status from vehicles where id = '00000000-0000-0000-0000-00000000e211'), 'vendido'::text, 'estado vendido');
  perform pg_temp.igual((select customer_id from vehicles where id = '00000000-0000-0000-0000-00000000e211'), '00000000-0000-0000-0000-00000000e210'::uuid, 'cliente de la moto');
  perform pg_temp.igual((select sale_id from vehicles where id = '00000000-0000-0000-0000-00000000e211'), s_contado, 'venta de la moto');
  perform pg_temp.igual((select registration_status from vehicles where id = '00000000-0000-0000-0000-00000000e211'), 'entregada'::text, 'matrícula de contado');
  perform pg_temp.igual((select stock from products where id = '00000000-0000-0000-0000-00000000e201'), 2::numeric, 'stock tras vender');
  perform pg_temp.igual((select cost from sale_items where sale_id = s_contado), 70000::numeric, 'costo de la unidad');
  perform pg_temp.igual((select product_name from sale_items where sale_id = s_contado), 'Honda CG 150 · Chasis V-1'::text, 'descripción en la línea');
  perform pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = '00000000-0000-0000-0000-00000000e211' and kind = 'venta' and sale_id = s_contado), 1, 'evento de venta');

  -- Financiada: la matrícula queda en custodia.
  s_cuotas := pg_temp.vender('00000000-0000-0000-0000-00000000e212', 'financing');
  perform pg_temp.igual((select registration_status from vehicles where id = '00000000-0000-0000-0000-00000000e212'), 'en_custodia'::text, 'matrícula financiada');
  perform pg_temp.igual((select product_name from sale_items where sale_id = s_cuotas), 'Honda CG 150 · Chasis V-2 · Motor E-2'::text, 'descripción con motor');

  -- Rechazos.
  perform pg_temp.debe_fallar($q$select pg_temp.vender('00000000-0000-0000-0000-00000000e213', 'cash', null)$q$, '%elige el cliente%');
  perform pg_temp.debe_fallar($q$select pg_temp.vender('00000000-0000-0000-0000-00000000e213', 'cash', '00000000-0000-0000-0000-00000000e210', 2)$q$, '%cantidad 1%');
  perform pg_temp.debe_fallar($q$select pg_temp.vender('00000000-0000-0000-0000-00000000e211', 'cash')$q$, '%no está disponible%');
  perform pg_temp.debe_fallar($q$select pg_temp.vender('00000000-0000-0000-0000-00000000e214', 'cash')$q$, '%no corresponde%');
  perform pg_temp.debe_fallar($q$select pg_temp.vender(null, 'cash')$q$, '%Elige el chasis%');
  perform pg_temp.debe_fallar($q$
    select create_sale_with_items(
      jsonb_build_object('branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', '00000000-0000-0000-0000-00000000e210',
                         'subtotal', 190000, 'itbis_amount', 0, 'total', 190000, 'payment_method', 'cash', 'payment_status', 'paid', 'amount_paid', 190000),
      jsonb_build_array(
        jsonb_build_object('product_id', '00000000-0000-0000-0000-00000000e201', 'product_name', 'Moto', 'quantity', 1, 'price', 95000, 'itbis', false, 'unit', 'und', 'vehicle_id', '00000000-0000-0000-0000-00000000e213'),
        jsonb_build_object('product_id', '00000000-0000-0000-0000-00000000e201', 'product_name', 'Moto', 'quantity', 1, 'price', 95000, 'itbis', false, 'unit', 'und', 'vehicle_id', '00000000-0000-0000-0000-00000000e213')))
  $q$, '%dos veces%');

  -- Anular la de contado: la unidad vuelve a estar disponible y el stock sube.
  update ecf_documentos set estado = 'rechazado' where sale_id = s_contado;
  perform annul_sale(s_contado, 'prueba', null);
  perform pg_temp.igual((select status from vehicles where id = '00000000-0000-0000-0000-00000000e211'), 'disponible'::text, 'estado tras anular');
  perform pg_temp.igual((select customer_id from vehicles where id = '00000000-0000-0000-0000-00000000e211'), null::uuid, 'sin cliente tras anular');
  perform pg_temp.igual((select sale_id from vehicles where id = '00000000-0000-0000-0000-00000000e211'), null::uuid, 'sin venta tras anular');
  perform pg_temp.igual((select registration_status from vehicles where id = '00000000-0000-0000-0000-00000000e211'), 'no_aplica'::text, 'matrícula tras anular');
  perform pg_temp.igual((select stock from products where id = '00000000-0000-0000-0000-00000000e201'), 2::numeric, 'stock tras anular (una vendida financiada)');
  perform pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = '00000000-0000-0000-0000-00000000e211' and kind = 'venta_anulada'), 1, 'evento de anulación');

  -- Anular la financiada: también vuelve a disponible y el stock sube.
  update ecf_documentos set estado = 'rechazado' where sale_id = s_cuotas;
  perform annul_sale(s_cuotas, 'prueba', null);
  perform pg_temp.igual((select status from vehicles where id = '00000000-0000-0000-0000-00000000e212'), 'disponible'::text, 'financiada anulada');
  perform pg_temp.igual((select registration_status from vehicles where id = '00000000-0000-0000-0000-00000000e212'), 'no_aplica'::text, 'matrícula de la financiada anulada');
  perform pg_temp.igual((select stock from products where id = '00000000-0000-0000-0000-00000000e201'), 3::numeric, 'stock tras anular la financiada');

  -- Regresión: un artículo normal se vende y se anula como siempre.
  select s.id into s_normal from create_sale_with_items(
    jsonb_build_object('branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', '00000000-0000-0000-0000-00000000e210',
                       'subtotal', 5000, 'itbis_amount', 0, 'total', 5000, 'payment_method', 'cash', 'payment_status', 'paid', 'amount_paid', 5000),
    jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-00000000e202', 'product_name', 'Prueba casco venta', 'quantity', 2, 'price', 2500, 'itbis', false, 'unit', 'und'))) s;
  perform pg_temp.igual((select stock from products where id = '00000000-0000-0000-0000-00000000e202'), 3::numeric, 'stock normal tras vender');
  perform pg_temp.igual((select product_name from sale_items where sale_id = s_normal), 'Prueba casco venta'::text, 'nombre normal intacto');
  update ecf_documentos set estado = 'rechazado' where sale_id = s_normal;
  perform annul_sale(s_normal, 'prueba', null);
  perform pg_temp.igual((select stock from products where id = '00000000-0000-0000-0000-00000000e202'), 5::numeric, 'stock normal tras anular');
end $$;

-- Borrar una empresa o una sucursal (súper admin): borra sus ventas, y la FK deja
-- la venta de la unidad en null; el guardia no lo toma por un cambio a mano. La
-- sucursal se lleva sus unidades.
do $$
declare
  s uuid;
begin
  s := pg_temp.vender('00000000-0000-0000-0000-00000000e213', 'cash');
  -- Mientras la venta exista, quitarla a mano sigue sin poderse.
  perform pg_temp.debe_fallar($q$update vehicles set sale_id = null where id = '00000000-0000-0000-0000-00000000e213'$q$, '%lo hace el sistema%');
  delete from ecf_documentos where sale_id = s;
  delete from sales where id = s;
  perform pg_temp.igual((select sale_id from vehicles where id = '00000000-0000-0000-0000-00000000e213'), null::uuid, 'venta borrada');

  insert into branches (id, company_id, name) values
    ('00000000-0000-0000-0000-00000000e2b2', '00000000-0000-0000-0000-0000000000aa', 'Prueba sucursal a borrar');
  insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
    ('00000000-0000-0000-0000-00000000e204', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e2b2', 'Prueba moto sucursal', 1, 1, 0, true);
  insert into vehicles (id, company_id, branch_id, origin, product_id, chassis) values
    ('00000000-0000-0000-0000-00000000e215', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e2b2', 'inventario', '00000000-0000-0000-0000-00000000e204', 'V-5');
  delete from branches where id = '00000000-0000-0000-0000-00000000e2b2';
  perform pg_temp.igual((select count(*)::int from vehicles where id = '00000000-0000-0000-0000-00000000e215'), 0, 'la unidad se va con su sucursal');
end $$;

select 'ok' as resultado;
