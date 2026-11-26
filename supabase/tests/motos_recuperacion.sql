-- Pruebas de la recuperación de motos (Motopréstamos 4A). NO es una migración: se
-- corre contra producción dentro de una transacción que se revierte, después del
-- SQL de las migraciones:
--
--   begin; <20261126120000_motos_recuperacion_base.sql> <20261126130000_motos_recuperacion_rpc.sql> <20261126140000_motos_recuperacion_arreglos.sql> <este archivo> rollback;
--
-- (Ya aplicadas en producción: basta `begin; <este archivo> rollback;`.)
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


-- ---------------------------------------------------------------------------
-- 2. Incautar, devolver, liquidar y recuperar (Task 2)
-- ---------------------------------------------------------------------------
-- Caja de b1 encendida con una sesión abierta. cc56c633 entra a la demo con un
-- rol sin Motopréstamos (no incauta ni liquida).

create function pg_temp.vid(p_chassis text) returns uuid language sql as $$
  select id from vehicles where company_id = '00000000-0000-0000-0000-0000000000aa' and chassis = p_chassis
$$;

insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'caja', true)
on conflict (company_id, module_key) do update set enabled = true;
update branches set caja_enabled = true where id = '00000000-0000-0000-0000-0000000000b1';
update caja_sessions set status = 'closed' where branch_id = '00000000-0000-0000-0000-0000000000b1' and status = 'open';
insert into caja_sessions (id, company_id, branch_id, opening_amount) values
  ('00000000-0000-0000-0000-00000000e8c0', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 0);
update caja_sessions set opened_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-00000000e8c0';

insert into roles (id, company_id, name, is_system, description, permissions) values
  ('00000000-0000-0000-0000-00000000e8f1', '00000000-0000-0000-0000-0000000000aa', 'Prueba sin motos', false, '', '{"pos":["view"]}');
insert into profile_companies (profile_id, company_id, role)
select 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa', 'cashier'
 where not exists (select 1 from profile_companies where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and company_id = '00000000-0000-0000-0000-0000000000aa');
update profiles set company_id = '00000000-0000-0000-0000-0000000000aa' where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
delete from profile_branches where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and branch_id = '00000000-0000-0000-0000-0000000000b1';
insert into profile_branches (profile_id, company_id, branch_id, role_id) values
  ('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e8f1');

do $$
declare
  yo   constant uuid := '92381752-13b2-4f43-8b09-612647754599';
  cc56 constant uuid := 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
  a    constant uuid := '00000000-0000-0000-0000-00000000e8a1';
  b1   constant uuid := '00000000-0000-0000-0000-0000000000b1';
  ses  constant uuid := '00000000-0000-0000-0000-00000000e8c0';
  moto constant uuid := '00000000-0000-0000-0000-00000000e803';
  hoy  date := company_today('00000000-0000-0000-0000-0000000000aa');
  l uuid; v uuid; r jsonb; d numeric; stock0 numeric; s uuid; pago uuid;
begin
  -- Incautar: solo con permiso de editar motos; la moto va al patio y el préstamo sigue.
  l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-G2'), 'matricula_en_custodia', true));
  v := pg_temp.vid('REC-G2');
  perform pg_temp.como(cc56);
  perform pg_temp.debe_fallar(format('select motos_incautar(%L, %L, %L)', v, hoy, 'No paga'), '%permiso%');
  perform pg_temp.como(yo);
  perform motos_incautar(v, hoy, 'No paga', null);
  perform pg_temp.igual((select status from vehicles where id = v), 'recuperado', 'incautada en el patio');
  perform pg_temp.igual((select status from loans where id = l), 'active', 'el préstamo sigue');
  perform pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = v and kind = 'incautacion'), 1, 'evento de incautación');
  perform pg_temp.debe_fallar(format('select motos_incautar(%L, %L, %L)', v, hoy, 'Otra vez'), '%no está en garantía%');

  -- Devolver con el préstamo activo: vuelve a garantía.
  perform motos_devolver_garantia(v, 'Se puso al día');
  perform pg_temp.igual((select status from vehicles where id = v), 'en_garantia', 'devuelta a garantía');
  perform pg_temp.igual((select status from vehicle_recoveries where vehicle_id = v), 'devuelta', 'recuperación devuelta');

  -- Incautar otra vez, saldar y devolver: liberada con la matrícula lista.
  perform motos_incautar(v, hoy, 'No paga', null);
  perform register_loan_payment(l, motos_deuda_prestamo(l), 'transfer', b1, null, 'T-S');
  perform pg_temp.igual((select status from loans where id = l), 'paid', 'préstamo saldado');
  perform motos_devolver_garantia(v, null);
  perform pg_temp.igual((select status from vehicles where id = v), 'liberado', 'liberada al devolver');
  perform pg_temp.igual((select registration_status from vehicles where id = v), 'lista_para_entregar', 'matrícula lista');

  -- Liquidar a un tercero por menos de la deuda, dejando el resto como deuda.
  l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-G3')));
  v := pg_temp.vid('REC-G3');
  perform motos_incautar(v, hoy, 'No paga', null);
  perform pg_temp.como(cc56);
  perform pg_temp.debe_fallar(format('select motos_liquidar_garantia(%L, %L, 3000)', v, 'tercero'), '%Solo un administrador%');
  perform pg_temp.como(yo);
  d := motos_deuda_prestamo(l);
  r := motos_liquidar_garantia(v, 'tercero', 3000, 'transfer', null, 'deuda', 'T-L', null);
  perform pg_temp.igual((r->>'aplicado')::numeric, 3000::numeric, 'aplicado al préstamo');
  perform pg_temp.igual((r->>'faltante')::numeric, d - 3000, 'faltante');
  perform pg_temp.igual((select status from loans where id = l), 'active', 'el resto queda como deuda');
  perform pg_temp.igual((select status from vehicles where id = v), 'baja', 'vendida a un tercero');
  perform pg_temp.igual((select status from vehicle_recoveries where vehicle_id = v), 'liquidada', 'recuperación liquidada');

  -- Liquidar a un tercero por menos, dando de baja el resto.
  l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-G4')));
  v := pg_temp.vid('REC-G4');
  perform motos_incautar(v, hoy, 'No paga', null);
  d := motos_deuda_prestamo(l);
  r := motos_liquidar_garantia(v, 'tercero', 3000, 'transfer', null, 'baja', 'T-L', null);
  perform pg_temp.igual((select status from loans where id = l), 'cancelled', 'préstamo dado de baja');
  perform pg_temp.igual((select written_off_amount from loans where id = l), d - 3000, 'saldo dado de baja');

  -- Liquidar a un tercero por más de la deuda (con mora), en efectivo: se aplica la deuda
  -- exacta y el sobrante pasa del comprador al cliente sin entrar a la caja.
  l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-G5')));
  v := pg_temp.vid('REC-G5');
  update loan_installments set due_date = hoy - 10 where loan_id = l and installment_number = 1;
  perform motos_incautar(v, hoy, 'No paga', null);
  d := motos_deuda_prestamo(l);
  perform pg_temp.igual(d > (select total_with_interest - amount_paid from loans where id = l), true, 'la deuda lleva mora');
  r := motos_liquidar_garantia(v, 'tercero', d + 500, 'cash', null, 'deuda', null, null);
  perform pg_temp.igual((r->>'aplicado')::numeric, d, 'deuda exacta');
  perform pg_temp.igual((r->>'sobrante')::numeric, 500::numeric, 'sobrante');
  perform pg_temp.igual((select status from loans where id = l), 'paid', 'saldado al liquidar');
  perform pg_temp.igual((select count(*)::int from caja_movements where session_id = ses and type = 'out'), 0, 'el sobrante del tercero no sale de la caja');
  perform pg_temp.igual((select refunded from vehicle_recoveries where vehicle_id = v), 500::numeric, 'sobrante devuelto');

  -- Dación en pago: el negocio se queda la moto por la tasación.
  l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-G6')));
  v := pg_temp.vid('REC-G6');
  perform motos_incautar(v, hoy, 'No paga', null);
  perform pg_temp.debe_fallar(format('select motos_liquidar_garantia(%L, %L, 6000, %L, %L)', v, 'dacion', 'cash', '00000000-0000-0000-0000-00000000e805'), '%artículo-vehículo%');
  select stock into stock0 from products where id = moto;
  r := motos_liquidar_garantia(v, 'dacion', 6000, 'cash', moto, 'deuda', null, 'Tasación del taller');
  pago := (r->>'payment_id')::uuid;
  perform pg_temp.igual((select method from loan_payments where id = pago), 'dacion', 'abono por dación');
  perform pg_temp.igual((select row(origin, status, condition, cost, customer_id, loan_id, product_id)::text from vehicles where id = v),
                        row('inventario', 'disponible', 'usado', 6000.00::numeric(14,2), null::uuid, null::uuid, moto)::text, 'la moto entra al inventario');
  perform pg_temp.igual((select stock from products where id = moto), stock0 + 1, 'stock del artículo');
  perform pg_temp.debe_fallar(format('select void_loan_payment(%L, %L)', pago, 'x'), '%dación en pago%');
  perform pg_temp.debe_fallar(format('select register_loan_payment(%L, 10, %L, %L, null, null)', l, 'dacion', b1), '%Método de pago no válido%');

  -- Dación por más que la deuda: el sobrante en efectivo sale de la caja.
  l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-G7')));
  v := pg_temp.vid('REC-G7');
  perform motos_incautar(v, hoy, 'No paga', null);
  d := motos_deuda_prestamo(l);
  r := motos_liquidar_garantia(v, 'dacion', d + 1000, 'cash', moto, 'deuda', null, null);
  perform pg_temp.igual((select amount from caja_movements where session_id = ses and type = 'out'), 1000::numeric, 'sobrante de la dación por caja');

  -- Recuperar una moto vendida a crédito con un abono: vuelve al inventario y el saldo se da de baja.
  s := pg_temp.vender_a_credito(moto, '00000000-0000-0000-0000-00000000e804', a);
  perform register_sale_payment(s, 20000, 'transfer', b1, null, 'T-V');
  select stock into stock0 from products where id = moto;
  perform pg_temp.como(cc56);
  perform pg_temp.debe_fallar(format('select motos_recuperar_venta(%L, %L, %L, %L, 50000)', '00000000-0000-0000-0000-00000000e804', hoy, 'No paga', 'Rayada'), '%Solo un administrador%');
  perform pg_temp.como(yo);
  r := motos_recuperar_venta('00000000-0000-0000-0000-00000000e804', hoy, 'No paga', 'Rayada', 50000, 1000, 'cash', null);
  perform pg_temp.igual((r->>'deuda')::numeric, 75000::numeric, 'deuda de la venta');
  perform pg_temp.igual((select row(status, condition, cost, sale_id, customer_id, registration_status)::text from vehicles where id = '00000000-0000-0000-0000-00000000e804'),
                        row('disponible', 'usado', 50000.00::numeric(14,2), null::uuid, null::uuid, 'no_aplica')::text, 'la moto vuelve al inventario');
  perform pg_temp.igual((select stock from products where id = moto), stock0 + 1, 'stock tras recuperar');
  perform pg_temp.igual((select row(payment_status::text, recovered_at is not null, written_off_amount)::text from sales where id = s),
                        row('paid', true, 75000.00::numeric(14,2))::text, 'venta recuperada');
  perform pg_temp.igual((select credit_balance from customers where id = a), 0::numeric, 'saldo del cliente');
  perform pg_temp.igual((select count(*)::int from caja_movements where session_id = ses and type = 'out' and amount = 1000
                          and reason like 'Devolución al cliente%'), 1, 'devolución por caja');
  perform pg_temp.debe_fallar(format('select register_sale_payment(%L, 10, %L, %L, null, null)', s, 'transfer', b1), '%saldada%');
  perform pg_temp.debe_fallar(format('update sales set cancelled_at = now() where id = %L', s), '%se recuperó%');
  perform pg_temp.debe_fallar(format('select motos_recuperar_venta(%L, %L, %L, %L, 1)', '00000000-0000-0000-0000-00000000e804', hoy, 'Otra', 'x'), '%no está vendida a crédito%');

  -- Sin caja abierta, la devolución en efectivo no pasa.
  insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis, cost) values
    ('00000000-0000-0000-0000-00000000e806', '00000000-0000-0000-0000-0000000000aa', b1, 'inventario', moto, 'Yamaha', 'YBR', 'REC-2', 70000);
  s := pg_temp.vender_a_credito(moto, '00000000-0000-0000-0000-00000000e806', a);
  update caja_sessions set status = 'closed' where id = ses;
  perform pg_temp.debe_fallar(format('select motos_recuperar_venta(%L, %L, %L, %L, 50000, 500, %L)', '00000000-0000-0000-0000-00000000e806', hoy, 'No paga', 'Bien', 'cash'),
                              '%Abre la caja de esta sucursal para devolver el dinero%');
end $$;

select pg_temp.igual(has_function_privilege('anon', 'public.motos_liquidar_garantia(uuid, text, numeric, text, uuid, text, text, text)', 'EXECUTE'), false, 'anon y liquidar');
select pg_temp.igual(has_function_privilege('authenticated', 'public.motos_devolver_dinero(uuid, uuid, numeric, text, text)', 'EXECUTE'), false, 'devolver dinero solo por dentro');

-- ---------------------------------------------------------------------------
-- 3. Arreglos de la revisión final (Task 7)
-- ---------------------------------------------------------------------------
-- Cada caso corre en su propio bloque y anota si pasó: una corrida muestra todos
-- los que fallan. Al final, si alguno falló, la suite se detiene con la lista.

create temp table s3_resultado (caso text, error text);
update customers set email = 'recuperacion-prueba@example.com' where id = '00000000-0000-0000-0000-00000000e8a1';
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis, cost) values
  ('00000000-0000-0000-0000-00000000e807', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e803', 'Yamaha', 'YBR', 'REC-3', 70000),
  ('00000000-0000-0000-0000-00000000e808', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e803', 'Yamaha', 'YBR', 'REC-4', 70000),
  ('00000000-0000-0000-0000-00000000e809', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e803', 'Yamaha', 'YBR', 'REC-5', 70000),
  ('00000000-0000-0000-0000-00000000e80a', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'inventario', '00000000-0000-0000-0000-00000000e803', 'Yamaha', 'YBR', 'REC-6', 70000);

-- Préstamo con el saldo dado de baja: no manda avisos de cuota.
do $$
declare a constant uuid := '00000000-0000-0000-0000-00000000e8a1'; hoy date := company_today('00000000-0000-0000-0000-0000000000aa'); l uuid; v uuid;
begin
  begin
    l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-F1')));
    v := pg_temp.vid('REC-F1');
    perform pg_temp.igual((select count(*) > 0 from pending_due_reminders(60) r join loan_installments li on li.id = r.installment_id where li.loan_id = l), true, 'el préstamo activo avisa');
    perform motos_incautar(v, hoy, 'No paga', null);
    perform motos_liquidar_garantia(v, 'tercero', 3000, 'transfer', null, 'baja', 'T-F1', null);
    perform pg_temp.igual((select count(*)::int from pending_due_reminders(60) r join loan_installments li on li.id = r.installment_id where li.loan_id = l), 0, 'sin avisos del préstamo dado de baja');
    insert into s3_resultado values ('avisos del préstamo dado de baja', null);
  exception when others then
    insert into s3_resultado values ('avisos del préstamo dado de baja', sqlerrm);
  end;
end $$;

-- Venta financiada recuperada: no manda avisos de cuota.
do $$
declare a constant uuid := '00000000-0000-0000-0000-00000000e8a1'; hoy date := company_today('00000000-0000-0000-0000-0000000000aa'); s uuid;
begin
  begin
    select x.id into s from create_sale_with_items(
      jsonb_build_object('branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', a,
        'subtotal', 95000, 'itbis_amount', 0, 'total', 95000, 'payment_method', 'financing', 'payment_status', 'in_financing', 'amount_paid', 0,
        'financing_details', '{"interestRate":5,"installments":12,"frequency":"monthly","interestMode":"monthly_prorated"}'::jsonb),
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-00000000e803', 'product_name', 'Moto', 'quantity', 1, 'price', 95000,
        'itbis', false, 'unit', 'und', 'vehicle_id', '00000000-0000-0000-0000-00000000e807'))) x;
    perform pg_temp.igual((select count(*) > 0 from pending_due_reminders(400) r join financing_installments fi on fi.id = r.installment_id where fi.sale_id = s), true, 'la venta financiada avisa');
    perform motos_recuperar_venta('00000000-0000-0000-0000-00000000e807', hoy, 'No paga', null, 50000, 0, 'cash', null);
    perform pg_temp.igual((select count(*)::int from pending_due_reminders(400) r join financing_installments fi on fi.id = r.installment_id where fi.sale_id = s), 0, 'sin avisos de la venta recuperada');
    insert into s3_resultado values ('avisos de la venta recuperada', null);
  exception when others then
    insert into s3_resultado values ('avisos de la venta recuperada', sqlerrm);
  end;
end $$;

-- Anular un abono viejo no reabre la venta recuperada.
do $$
declare a constant uuid := '00000000-0000-0000-0000-00000000e8a1'; b1 constant uuid := '00000000-0000-0000-0000-0000000000b1';
  hoy date := company_today('00000000-0000-0000-0000-0000000000aa'); s uuid; pago uuid; saldo numeric;
begin
  begin
    s := pg_temp.vender_a_credito('00000000-0000-0000-0000-00000000e803', '00000000-0000-0000-0000-00000000e808', a);
    perform register_sale_payment(s, 20000, 'transfer', b1, null, 'T-V3');
    select id into pago from credit_payments where sale_id = s order by date desc limit 1;
    perform motos_recuperar_venta('00000000-0000-0000-0000-00000000e808', hoy, 'No paga', null, 50000, 0, 'cash', null);
    select credit_balance into saldo from customers where id = a;
    perform pg_temp.debe_fallar(format('select void_credit_payment(%L, %L)', pago, 'Error'), '%se recuperó%');
    perform pg_temp.igual((select payment_status::text from sales where id = s), 'paid', 'la venta sigue recuperada');
    perform pg_temp.igual((select credit_balance from customers where id = a), saldo, 'el cliente no vuelve a deber la venta');
    insert into s3_resultado values ('anular abono de venta recuperada', null);
  exception when others then
    insert into s3_resultado values ('anular abono de venta recuperada', sqlerrm);
  end;
end $$;

-- Una venta con dos motos no se recupera desde una sola.
do $$
declare a constant uuid := '00000000-0000-0000-0000-00000000e8a2'; hoy date := company_today('00000000-0000-0000-0000-0000000000aa'); s uuid;
begin
  begin
    select x.id into s from create_sale_with_items(
      jsonb_build_object('branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', a,
        'subtotal', 190000, 'itbis_amount', 0, 'total', 190000, 'payment_method', 'credit', 'payment_status', 'credit', 'amount_paid', 0),
      jsonb_build_array(
        jsonb_build_object('product_id', '00000000-0000-0000-0000-00000000e803', 'product_name', 'Moto', 'quantity', 1, 'price', 95000,
          'itbis', false, 'unit', 'und', 'vehicle_id', '00000000-0000-0000-0000-00000000e809'),
        jsonb_build_object('product_id', '00000000-0000-0000-0000-00000000e803', 'product_name', 'Moto', 'quantity', 1, 'price', 95000,
          'itbis', false, 'unit', 'und', 'vehicle_id', '00000000-0000-0000-0000-00000000e80a'))) x;
    perform pg_temp.debe_fallar(format('select motos_recuperar_venta(%L, %L, %L, null, 50000)', '00000000-0000-0000-0000-00000000e809', hoy, 'No paga'), '%más de una moto%');
    insert into s3_resultado values ('venta con dos motos', null);
  exception when others then
    insert into s3_resultado values ('venta con dos motos', sqlerrm);
  end;
end $$;

-- Un préstamo con el saldo dado de baja no recibe abonos.
do $$
declare a constant uuid := '00000000-0000-0000-0000-00000000e8a1'; b1 constant uuid := '00000000-0000-0000-0000-0000000000b1';
  hoy date := company_today('00000000-0000-0000-0000-0000000000aa'); l uuid; v uuid;
begin
  begin
    l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-F5')));
    v := pg_temp.vid('REC-F5');
    perform motos_incautar(v, hoy, 'No paga', null);
    perform motos_liquidar_garantia(v, 'tercero', 3000, 'transfer', null, 'baja', 'T-F5', null);
    perform pg_temp.debe_fallar(format('select register_loan_payment(%L, 10, %L, %L, null, %L)', l, 'transfer', b1, 'T-X'), '%dado de baja%');
    perform pg_temp.igual((select status from loans where id = l), 'cancelled', 'sigue dado de baja');
    insert into s3_resultado values ('abono a préstamo dado de baja', null);
  exception when others then
    insert into s3_resultado values ('abono a préstamo dado de baja', sqlerrm);
  end;
end $$;

-- El abono de la liquidación a un tercero no se anula.
do $$
declare a constant uuid := '00000000-0000-0000-0000-00000000e8a1'; hoy date := company_today('00000000-0000-0000-0000-0000000000aa'); l uuid; v uuid; r jsonb;
begin
  begin
    l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-F6')));
    v := pg_temp.vid('REC-F6');
    perform motos_incautar(v, hoy, 'No paga', null);
    r := motos_liquidar_garantia(v, 'tercero', 3000, 'transfer', null, 'deuda', 'T-F6', null);
    perform pg_temp.debe_fallar(format('select void_loan_payment(%L, %L)', r->>'payment_id', 'Error'), '%liquidación%');
    insert into s3_resultado values ('anular abono de liquidación', null);
  exception when others then
    insert into s3_resultado values ('anular abono de liquidación', sqlerrm);
  end;
end $$;

-- Refinanciar con la moto incautada: la moto y su recuperación pasan al préstamo nuevo.
do $$
declare a constant uuid := '00000000-0000-0000-0000-00000000e8a1'; hoy date := company_today('00000000-0000-0000-0000-0000000000aa'); l uuid; v uuid; r jsonb; nuevo uuid;
begin
  begin
    l := pg_temp.prestamo(a, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'REC-F7')));
    v := pg_temp.vid('REC-F7');
    perform motos_incautar(v, hoy, 'No paga', null);
    r := refinance_loan(l, 'capital', null, 0, 5, 4, 'weekly', null, 'Acuerdo de pago');
    nuevo := (r->>'new_loan_id')::uuid;
    perform pg_temp.igual((select loan_id from vehicles where id = v), nuevo, 'la moto pasa al préstamo nuevo');
    perform pg_temp.igual((select status from vehicles where id = v), 'recuperado', 'sigue incautada');
    perform pg_temp.igual((select loan_id from vehicle_recoveries where vehicle_id = v and status = 'incautada'), nuevo, 'la recuperación pasa al préstamo nuevo');
    perform motos_devolver_garantia(v, null);
    perform pg_temp.igual((select row(status, loan_id)::text from vehicles where id = v), row('en_garantia', nuevo)::text, 'devuelta en garantía del préstamo nuevo');
    insert into s3_resultado values ('refinanciar con la moto incautada', null);
  exception when others then
    insert into s3_resultado values ('refinanciar con la moto incautada', sqlerrm);
  end;
end $$;

do $$
declare f text;
begin
  select string_agg(caso || ': ' || error, ' | ' order by caso) into f from s3_resultado where error is not null;
  if f is not null then raise exception 'FALLAN §3: %', f; end if;
  if (select count(*) from s3_resultado) <> 7 then raise exception '§3: corrieron % casos de 7', (select count(*) from s3_resultado); end if;
end $$;

select 'ok';
