-- Pruebas del préstamo con la moto en garantía y de las matrículas en custodia
-- (Motopréstamos 2B). NO es una migración: se corre contra producción dentro de
-- una transacción que se revierte, después del SQL de las migraciones:
--
--   begin; <20261124180000_motos_datos_del_cliente.sql> <20261124190000_motos_garantia_y_matriculas.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Datos con UUID fijos (…e4XX) en la
-- empresa demo, sucursal Principal (…0b1). Los préstamos se desembolsan por
-- transferencia y se cobran por transferencia, para no depender de la caja.

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

-- Abona todo lo que se debe del préstamo; devuelve el id del abono.
create function pg_temp.saldar(p_loan uuid) returns uuid
language plpgsql as $$
declare v_debe numeric;
begin
  select total_with_interest - amount_paid into v_debe from loans where id = p_loan;
  return (register_loan_payment(p_loan, v_debe, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null))->>'payment_id';
end $$;

-- Venta a crédito de 95,000 de una línea (con o sin vehículo).
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

create function pg_temp.v(p_id uuid) returns public.vehicles
language sql as $$ select * from vehicles where id = p_id $$;

-- Módulo encendido; dos clientes; un artículo-moto con una unidad y uno normal.
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'motoprestamos', true)
on conflict (company_id, module_key) do update set enabled = true;
insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e401', '00000000-0000-0000-0000-0000000000aa', 'Prueba dueño A'),
  ('00000000-0000-0000-0000-00000000e402', '00000000-0000-0000-0000-0000000000aa', 'Prueba dueño B');
insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
  ('00000000-0000-0000-0000-00000000e403', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba moto crédito', 95000, 70000, 0, true);
insert into products (id, company_id, branch_id, name, price, cost, stock) values
  ('00000000-0000-0000-0000-00000000e405', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba nevera crédito', 95000, 70000, 5);
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis, cost) values
  ('00000000-0000-0000-0000-00000000e404', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'inventario', '00000000-0000-0000-0000-00000000e403', 'Yamaha', 'YBR', 'GV-1', 70000);

select pg_temp.igual(has_function_privilege('anon', 'public.motos_crear_prestamo(jsonb, jsonb)', 'EXECUTE'), false, 'anon y crear préstamo');
select pg_temp.igual(has_function_privilege('anon', 'public.motos_entregar_matricula(uuid, text, text, text)', 'EXECUTE'), false, 'anon y entregar matrícula');

do $$
declare
  a  constant uuid := '00000000-0000-0000-0000-00000000e401';
  b  constant uuid := '00000000-0000-0000-0000-00000000e402';
  l1 uuid; l2 uuid; l2n uuid; l3 uuid; lr uuid;
  v1 uuid; v3 uuid;
  p1 uuid; p2 uuid;
  s  uuid; sr uuid;
  r  jsonb;
begin
  -- 1. Garantía nueva: préstamo con sus cuotas y la moto en garantía.
  l1 := pg_temp.prestamo(a, jsonb_build_object(
    'vehiculo', jsonb_build_object('brand', 'Honda', 'model', 'C70', 'chassis', 'G-100', 'plate', 'K000001'),
    'matricula_en_custodia', true, 'ubicacion', 'Gaveta 1'));
  perform pg_temp.igual((select count(*)::int from loan_installments where loan_id = l1), 4, 'cuotas del préstamo');
  select id into v1 from vehicles where loan_id = l1;
  perform pg_temp.igual((pg_temp.v(v1)).status, 'en_garantia', 'estado de la garantía');
  perform pg_temp.igual((pg_temp.v(v1)).origin, 'garantia', 'origen de la garantía');
  perform pg_temp.igual((pg_temp.v(v1)).customer_id, a, 'dueño de la garantía');
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'en_custodia', 'matrícula en custodia');
  perform pg_temp.igual((pg_temp.v(v1)).registration_location, 'Gaveta 1', 'dónde se guarda');
  perform pg_temp.igual((pg_temp.v(v1)).condition, 'usado', 'condición por defecto');
  perform pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = v1 and kind = 'garantia' and loan_id = l1), 1, 'evento garantía');

  -- 2. Garantía que falla: no queda préstamo de B.
  perform pg_temp.debe_fallar(format('select pg_temp.prestamo(%L, %L)', b,
    '{"vehiculo":{"chassis":" g-100 "},"matricula_en_custodia":true}'), '%otro vehículo con ese chasis%');
  perform pg_temp.debe_fallar(format('select pg_temp.prestamo(%L, %L)', b,
    jsonb_build_object('vehicle_id', v1)), '%no se puede usar como garantía%');
  perform pg_temp.debe_fallar(format('select pg_temp.prestamo(%L, %L)', a,
    jsonb_build_object('vehicle_id', v1)), '%no se puede usar como garantía%');
  perform pg_temp.debe_fallar(format('select pg_temp.prestamo(%L, %L)', b, '{}'), '%Falta la moto%');
  perform pg_temp.debe_fallar(format('select pg_temp.prestamo(%L, %L)', b,
    '{"vehiculo":{"brand":"Sin chasis"}}'), '%Falta el chasis%');
  update company_modules set enabled = false
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'motoprestamos';
  perform pg_temp.debe_fallar(format('select pg_temp.prestamo(%L, %L)', b,
    '{"vehiculo":{"chassis":"G-200"}}'), '%Motopréstamos está apagado%');
  update company_modules set enabled = true
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'motoprestamos';
  perform pg_temp.igual((select count(*)::int from loans where customer_id = b), 0, 'sin préstamos de B');

  -- 3. Saldar: la moto se libera y la matrícula queda lista.
  p1 := pg_temp.saldar(l1);
  perform pg_temp.igual((select status from loans where id = l1), 'paid', 'préstamo saldado');
  perform pg_temp.igual((pg_temp.v(v1)).status, 'liberado', 'liberada al saldar');
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'lista_para_entregar', 'matrícula lista');
  perform pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = v1 and kind = 'liberacion'), 1, 'evento liberación');

  -- 4. Anular el abono: vuelve atrás.
  perform void_loan_payment(p1, 'prueba');
  perform pg_temp.igual((select status from loans where id = l1), 'active', 'préstamo activo otra vez');
  perform pg_temp.igual((pg_temp.v(v1)).status, 'en_garantia', 'vuelve a garantía');
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'en_custodia', 'vuelve a custodia');

  -- 5. Con la matrícula ya entregada, anular deja la matrícula entregada.
  p2 := pg_temp.saldar(l1);
  perform motos_entregar_matricula(v1, 'Juan Pérez', '001-1', null);
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'entregada', 'matrícula entregada');
  perform pg_temp.igual((pg_temp.v(v1)).registration_delivered_to, 'Juan Pérez', 'a quién se entregó');
  perform pg_temp.igual((pg_temp.v(v1)).registration_delivered_doc, '001-1', 'cédula de quien retira');
  perform pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = v1 and kind = 'matricula'
                          and note like 'Entregada a Juan Pérez (001-1)%'), 1, 'evento de entrega');
  perform void_loan_payment(p2, 'prueba');
  perform pg_temp.igual((pg_temp.v(v1)).status, 'en_garantia', 'en garantía tras anular');
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'entregada', 'sigue entregada');
  perform pg_temp.saldar(l1);
  perform pg_temp.igual((pg_temp.v(v1)).status, 'liberado', 'liberada de nuevo');
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'entregada', 'entregada no cambia al saldar');

  -- 6. Reusar una moto liberada del mismo cliente.
  l2 := pg_temp.prestamo(a, jsonb_build_object('vehicle_id', v1, 'matricula_en_custodia', true, 'ubicacion', 'Gaveta 2'));
  perform pg_temp.igual((pg_temp.v(v1)).loan_id, l2, 'moto en el préstamo nuevo');
  perform pg_temp.igual((pg_temp.v(v1)).status, 'en_garantia', 'en garantía otra vez');
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'en_custodia', 'custodia otra vez');
  perform pg_temp.igual((pg_temp.v(v1)).registration_delivered_to, null::text, 'entrega anterior limpia');

  -- 7. Refinanciar: la moto pasa al préstamo nuevo y se libera al saldar ese.
  r := refinance_loan(l2, 'balance', null, 0, 10, 4, 'weekly', null, 'prueba');
  l2n := (r->>'new_loan_id')::uuid;
  perform pg_temp.igual((pg_temp.v(v1)).loan_id, l2n, 'moto sigue al refinanciado');
  perform pg_temp.igual((pg_temp.v(v1)).status, 'en_garantia', 'sigue en garantía');
  perform pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = v1 and kind = 'garantia'
                          and loan_id = l2n and note = 'Refinanciación'), 1, 'evento de refinanciación');
  perform pg_temp.saldar(l2n);
  perform pg_temp.igual((pg_temp.v(v1)).status, 'liberado', 'liberada al saldar el refinanciado');
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'lista_para_entregar', 'lista tras el refinanciado');

  -- 8. Venta a crédito de una moto: lista al saldar, en custodia al anular el abono.
  s := pg_temp.vender_a_credito('00000000-0000-0000-0000-00000000e403', '00000000-0000-0000-0000-00000000e404', b);
  perform pg_temp.igual((pg_temp.v('00000000-0000-0000-0000-00000000e404')).registration_status, 'en_custodia', 'custodia en venta a crédito');
  r := register_sale_payment(s, 95000, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  perform pg_temp.igual((select payment_status::text from sales where id = s), 'paid', 'venta saldada');
  perform pg_temp.igual((pg_temp.v('00000000-0000-0000-0000-00000000e404')).registration_status, 'lista_para_entregar', 'lista al saldar la venta');
  perform void_credit_payment((r->>'payment_id')::uuid, 'prueba');
  perform pg_temp.igual((pg_temp.v('00000000-0000-0000-0000-00000000e404')).registration_status, 'en_custodia', 'custodia al anular el abono');

  -- 9. Entrega: con deuda solo el admin y con motivo.
  l3 := pg_temp.prestamo(b, jsonb_build_object('vehiculo', jsonb_build_object('chassis', 'G-300'), 'matricula_en_custodia', true));
  select id into v3 from vehicles where loan_id = l3;
  -- cc56c633 entra a la demo como cajero en b1, con permiso de editar vehículos.
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
  update roles set permissions = coalesce(permissions, '{}'::jsonb) || '{"motos":["view","edit"]}'::jsonb
   where id = 'd7bb7626-3aa0-4f4b-9b1b-eb61264a4b04';
  perform pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
  assert not is_company_admin(), 'cc56c633 no debe ser admin de la demo';
  perform pg_temp.debe_fallar(format('select motos_entregar_matricula(%L, %L, null, null)', v3, 'Pedro'), '%no está saldada%');
  perform pg_temp.debe_fallar(format('select motos_entregar_matricula(%L, %L, null, %L)', v3, 'Pedro', 'me dijeron'), '%no está saldada%');
  perform motos_entregar_matricula(v1, 'Ana Gómez', null, null);  -- lista: el cajero sí puede
  perform pg_temp.igual((pg_temp.v(v1)).registration_status, 'entregada', 'cajero entrega una lista');
  perform pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
  perform pg_temp.debe_fallar(format('select motos_entregar_matricula(%L, %L, null, null)', v3, 'Pedro'), '%no está saldada%');
  perform motos_entregar_matricula(v3, 'Pedro', '002-2', 'Pagó fuera del sistema');
  perform pg_temp.igual((pg_temp.v(v3)).registration_status, 'entregada', 'entrega forzada');
  perform pg_temp.igual((select count(*)::int from vehicle_events where vehicle_id = v3 and kind = 'matricula'
                          and note like '%Forzada: Pagó fuera del sistema%'), 1, 'nota de forzada');
  perform pg_temp.debe_fallar(format('select motos_entregar_matricula(%L, %L, null, null)',
    '00000000-0000-0000-0000-00000000e404', '  '), '%nombre de quien retira%');
  perform pg_temp.debe_fallar(format('select motos_entregar_matricula(%L, %L, null, null)', v3, 'Otra vez'), '%no está en custodia%');

  -- 10. El cliente no cambia lo que hace el sistema.
  perform pg_temp.debe_fallar(format('update vehicles set loan_id = null where id = %L', v3), '%lo hace el sistema%');
  perform pg_temp.debe_fallar(format('update vehicles set registration_status = %L where id = %L',
    'entregada', '00000000-0000-0000-0000-00000000e404'), '%lo hace el sistema%');
  perform pg_temp.debe_fallar(format('update vehicles set registration_delivered_to = %L where id = %L', 'X', v3), '%lo hace el sistema%');
  update vehicles set registration_location = 'Archivo 3' where id = v3;  -- esto sí
  perform pg_temp.igual((pg_temp.v(v3)).registration_location, 'Archivo 3', 'ubicación editable');

  -- 11. Regresión: préstamo y venta a crédito sin moto, igual que antes.
  insert into loans (branch_id, customer_id, principal, interest_rate, installments_count, payment_frequency, disbursement_method)
  values ('00000000-0000-0000-0000-0000000000b1', b, 5000, 5, 2, 'monthly', 'transfer')
  returning id into lr;
  p1 := pg_temp.saldar(lr);
  perform pg_temp.igual((select status from loans where id = lr), 'paid', 'préstamo sin moto saldado');
  perform void_loan_payment(p1, 'prueba');
  perform pg_temp.igual((select status from loans where id = lr), 'active', 'préstamo sin moto activo');
  perform pg_temp.igual((select count(*)::int from vehicle_events where loan_id = lr), 0, 'sin eventos de moto');
  sr := pg_temp.vender_a_credito('00000000-0000-0000-0000-00000000e405', null, b);
  r := register_sale_payment(sr, 95000, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, null);
  perform pg_temp.igual((select payment_status::text from sales where id = sr), 'paid', 'venta sin moto saldada');
  perform void_credit_payment((r->>'payment_id')::uuid, 'prueba');
  perform pg_temp.igual((select payment_status::text from sales where id = sr), 'credit', 'venta sin moto a crédito');
  perform pg_temp.igual((select count(*)::int from vehicle_events where sale_id = sr), 0, 'sin eventos en la venta');
end $$;

select 'ok';
