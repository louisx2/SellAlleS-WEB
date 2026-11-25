-- Pruebas de la recuperación de motos (Motopréstamos 4A). NO es una migración: se
-- corre contra producción dentro de una transacción que se revierte, después del
-- SQL de las migraciones:
--
--   begin; <20261126120000_motos_recuperacion_base.sql> <20261126130000_motos_recuperacion_rpc.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Datos con UUID fijos (…e8XX) en la empresa
-- demo, sucursal Principal (…0b1). Los préstamos se desembolsan por transferencia.

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

-- Préstamo de 10,000 al 10% en 4 cuotas semanales, con la garantía dada.
create function pg_temp.prestamo(p_customer uuid, p_garantia jsonb) returns uuid
language plpgsql as $$
begin
  return motos_crear_prestamo(
    jsonb_build_object(
      'branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', p_customer,
      'principal', 10000, 'interest_rate', 10, 'installments_count', 4,
      'payment_frequency', 'weekly', 'disbursement_method', 'transfer', 'disbursement_reference', 'T-1'),
    p_garantia);
end $$;

-- Venta a crédito de 95,000 de una moto.
create function pg_temp.vender_a_credito(p_product uuid, p_vehicle uuid, p_customer uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select s.id into v_id from create_sale_with_items(
    jsonb_build_object(
      'branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', p_customer,
      'subtotal', 95000, 'itbis_amount', 0, 'total', 95000,
      'payment_method', 'credit', 'payment_status', 'credit', 'amount_paid', 0),
    jsonb_build_array(jsonb_build_object(
      'product_id', p_product, 'product_name', 'Moto', 'quantity', 1, 'price', 95000,
      'itbis', false, 'unit', 'und', 'vehicle_id', p_vehicle))) s;
  return v_id;
end $$;

insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'motoprestamos', true)
on conflict (company_id, module_key) do update set enabled = true;
insert into customers (id, company_id, name, phone) values
  ('00000000-0000-0000-0000-00000000e8a1', '00000000-0000-0000-0000-0000000000aa', 'Prueba recuperación A', '8095550111'),
  ('00000000-0000-0000-0000-00000000e8a2', '00000000-0000-0000-0000-0000000000aa', 'Prueba recuperación B', null);
insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
  ('00000000-0000-0000-0000-00000000e803', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba moto recuperación', 95000, 70000, 0, true);
insert into products (id, company_id, branch_id, name, price, cost, stock) values
  ('00000000-0000-0000-0000-00000000e805', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba casco recuperación', 1000, 500, 5);
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis, cost) values
  ('00000000-0000-0000-0000-00000000e804', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'inventario', '00000000-0000-0000-0000-00000000e803', 'Yamaha', 'YBR', 'REC-1', 70000);

-- ---------------------------------------------------------------------------
-- 1. Registro, columnas y estados (Task 1)
-- ---------------------------------------------------------------------------

select pg_temp.debe_fallar($q$insert into vehicle_recoveries (company_id, branch_id, vehicle_id, kind, status, recovered_on)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e804', 'otra', 'incautada', current_date)$q$, '%check%');
select pg_temp.debe_fallar($q$insert into vehicle_recoveries (company_id, branch_id, vehicle_id, kind, status, recovered_on)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e804', 'venta', 'perdida', current_date)$q$, '%check%');
select pg_temp.igual(has_table_privilege('anon', 'public.vehicle_recoveries', 'SELECT'), false, 'anon y recuperaciones');
select pg_temp.igual(has_table_privilege('authenticated', 'public.vehicle_recoveries', 'INSERT'), false, 'recuperaciones solo por las RPC');
select pg_temp.igual(has_table_privilege('authenticated', 'public.vehicle_recoveries', 'SELECT'), true, 'se leen con RLS');

-- Los tipos de evento y el método de abono nuevos.
insert into vehicle_events (company_id, vehicle_id, kind, note)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000e804', 'recuperacion', 'prueba');

do $$
declare l uuid; s uuid;
begin
  l := pg_temp.prestamo('00000000-0000-0000-0000-00000000e8a1', jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-G1')));
  insert into loan_payments (company_id, loan_id, customer_id, branch_id, amount, method, date)
  values ('00000000-0000-0000-0000-0000000000aa', l, '00000000-0000-0000-0000-00000000e8a1', '00000000-0000-0000-0000-0000000000b1', 1, 'dacion', now());

  -- Una venta recuperada no se puede anular.
  s := pg_temp.vender_a_credito('00000000-0000-0000-0000-00000000e805', null, '00000000-0000-0000-0000-00000000e8a2');
  update sales set recovered_at = now(), written_off_amount = 1000 where id = s;
  perform pg_temp.debe_fallar(format('update sales set cancelled_at = now() where id = %L', s), '%se recuperó%');
end $$;

select pg_temp.igual((select count(*)::int from loan_payments where method not in ('cash', 'card', 'transfer', 'dacion')), 0, 'métodos vivos válidos');
select pg_temp.igual((select count(*)::int from sales where written_off_amount is not null and recovered_at is null), 0, 'baja solo con recuperación');

select 'ok';
