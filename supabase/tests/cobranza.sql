-- Pruebas de la cobranza en la calle (Motopréstamos 3A). NO es una migración: se
-- corre contra producción dentro de una transacción que se revierte, después del
-- SQL de las migraciones:
--
--   begin; <20261125120000_cobranza_base.sql> <20261125130000_cobranza_cobro_y_cuadre.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Datos con UUID fijos (…e6XX) en la empresa
-- demo, sucursal Principal (…0b1). cc56c633 entra como cobrador (rol Cobrador); el
-- súper admin es el otro cobrador.

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
-- 1. Cobradores, cartera, visitas y entregas (Task 1)
-- ---------------------------------------------------------------------------

-- Encender el módulo crea el rol Cobrador, una sola vez.
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'motoprestamos', true)
on conflict (company_id, module_key) do update set enabled = true;
update company_modules set enabled = false where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'motoprestamos';
update company_modules set enabled = true where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'motoprestamos';
select pg_temp.igual((select count(*)::int from roles where company_id = '00000000-0000-0000-0000-0000000000aa' and key = 'cobrador'), 1, 'rol Cobrador');
select pg_temp.igual((select permissions from roles where company_id = '00000000-0000-0000-0000-0000000000aa' and key = 'cobrador'),
                     '{"cobranza":["view","create"],"customers":["view"]}'::jsonb, 'permisos del rol Cobrador');

-- cc56c633 entra a la demo con el rol Cobrador en b1.
insert into profile_companies (profile_id, company_id, role)
select 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa', 'cashier'
 where not exists (select 1 from profile_companies
                    where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566'
                      and company_id = '00000000-0000-0000-0000-0000000000aa');
update profiles set company_id = '00000000-0000-0000-0000-0000000000aa'
 where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
delete from profile_branches where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and branch_id = '00000000-0000-0000-0000-0000000000b1';
insert into profile_branches (profile_id, company_id, branch_id, role_id)
select 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', r.id
  from roles r where r.company_id = '00000000-0000-0000-0000-0000000000aa' and r.key = 'cobrador';

-- Dos cobradores en b1; el mismo perfil no se repite en la sucursal.
insert into collectors (id, company_id, branch_id, profile_id) values
  ('00000000-0000-0000-0000-00000000e6c1', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566'),
  ('00000000-0000-0000-0000-00000000e6c2', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '92381752-13b2-4f43-8b09-612647754599');
select pg_temp.debe_fallar($q$insert into collectors (company_id, branch_id, profile_id)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566')$q$, '%collectors_branch_profile_uq%');

-- Cartera: cada cliente una sola vez por sucursal.
insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-0000000000aa', 'Prueba cliente de cc56'),
  ('00000000-0000-0000-0000-00000000e602', '00000000-0000-0000-0000-0000000000aa', 'Prueba cliente del otro');
insert into collection_assignments (company_id, branch_id, customer_id, collector_id, visit_order) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-00000000e6c1', 1),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e602', '00000000-0000-0000-0000-00000000e6c2', 1);
select pg_temp.debe_fallar($q$insert into collection_assignments (company_id, branch_id, customer_id, collector_id)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-00000000e6c2')$q$,
  '%collection_assignments_branch_customer_uq%');

-- Una promesa necesita fecha; la diferencia de una entrega se calcula.
select pg_temp.debe_fallar($q$insert into collection_visits (company_id, branch_id, customer_id, collector_id, outcome)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-00000000e6c1', 'promesa')$q$, '%check%');
insert into collector_settlements (id, company_id, branch_id, collector_id, expected, received)
values ('00000000-0000-0000-0000-00000000e6e1', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e6c1', 1000, 950);
select pg_temp.igual((select difference from collector_settlements where id = '00000000-0000-0000-0000-00000000e6e1'), -50::numeric, 'diferencia de la entrega');
delete from collector_settlements where id = '00000000-0000-0000-0000-00000000e6e1';

-- anon no tiene nada.
select pg_temp.igual(has_table_privilege('anon', 'public.collectors', 'SELECT'), false, 'anon y cobradores');
select pg_temp.igual(has_table_privilege('anon', 'public.collection_assignments', 'SELECT'), false, 'anon y cartera');
select pg_temp.igual(has_table_privilege('anon', 'public.collection_visits', 'SELECT'), false, 'anon y visitas');
select pg_temp.igual(has_table_privilege('anon', 'public.collector_settlements', 'SELECT'), false, 'anon y entregas');
select pg_temp.igual(has_table_privilege('authenticated', 'public.collection_visits', 'INSERT'), false, 'visitas solo por la RPC');

-- Con RLS: el cobrador cc56 ve su cartera y no la del otro; ve los cobradores.
set local role authenticated;
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
select pg_temp.igual((select count(*)::int from collection_assignments where branch_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'el cobrador ve solo su cartera');
select pg_temp.igual((select customer_id from collection_assignments where branch_id = '00000000-0000-0000-0000-0000000000b1'), '00000000-0000-0000-0000-00000000e601'::uuid, 'su cliente');
select pg_temp.igual((select count(*)::int from collectors where branch_id = '00000000-0000-0000-0000-0000000000b1'), 2, 've los cobradores');
select pg_temp.igual(cobranza_mi_cobrador('00000000-0000-0000-0000-0000000000b1'), '00000000-0000-0000-0000-00000000e6c1'::uuid, 'su registro de cobrador');
select pg_temp.debe_fallar($q$insert into collection_assignments (company_id, branch_id, customer_id, collector_id)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e602', '00000000-0000-0000-0000-00000000e6c1')$q$,
  '%row-level security%');
reset role;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

-- ---------------------------------------------------------------------------
-- 2. Cobro en la calle, cierre de caja, entrega y anulaciones (Task 2)
-- ---------------------------------------------------------------------------
-- Dentro de una transacción now() no avanza: las fechas de los abonos y la
-- apertura de las cajas se mueven a mano para que el cierre vea el período.

create function pg_temp.prestamo(p_id uuid, p_customer uuid, p_branch uuid) returns void language sql as $$
  insert into loans (id, company_id, branch_id, customer_id, principal, interest_rate, installments_count, payment_frequency, disbursement_method)
  values (p_id, '00000000-0000-0000-0000-0000000000aa', p_branch, p_customer, 5000, 5, 5, 'weekly', 'transfer');
$$;

-- Caja encendida en la empresa y en b1, sin sesión abierta.
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'caja', true)
on conflict (company_id, module_key) do update set enabled = true;
update branches set caja_enabled = true where id = '00000000-0000-0000-0000-0000000000b1';
update caja_sessions set status = 'closed' where branch_id = '00000000-0000-0000-0000-0000000000b1' and status = 'open';

select pg_temp.prestamo('00000000-0000-0000-0000-00000000e611', '00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.prestamo('00000000-0000-0000-0000-00000000e612', '00000000-0000-0000-0000-00000000e602', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.prestamo('00000000-0000-0000-0000-00000000e613', '00000000-0000-0000-0000-00000000e601', '169fe6bb-91fa-4633-8e43-5a45e410e2b0');

do $$
declare
  yo   constant uuid := '92381752-13b2-4f43-8b09-612647754599';
  cc56 constant uuid := 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
  b1   constant uuid := '00000000-0000-0000-0000-0000000000b1';
  r jsonb; p1 uuid; p2 uuid; p3 uuid; pof uuid; s1 uuid; s2 uuid; ent jsonb;
begin
  -- El cobrador cobra en efectivo a su cliente con la caja cerrada: queda en la calle.
  perform pg_temp.como(cc56);
  r := cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e611', null, 500, 'cash', null, 'cuota');
  p1 := (r->>'payment_id')::uuid;
  perform pg_temp.igual((select en_calle from loan_payments where id = p1), true, 'abono en la calle');
  perform pg_temp.igual((select collector_id from loan_payments where id = p1), '00000000-0000-0000-0000-00000000e6c1'::uuid, 'cobrador del abono');
  perform pg_temp.igual((select count(*)::int from collection_visits where payment_id = p1 and outcome = 'pago'), 1, 'visita de pago');
  -- Otro cliente, otra sucursal sin registro, transferencia.
  perform pg_temp.debe_fallar($q$select cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e612', null, 100, 'cash', null, null)$q$, '%no está en tu ruta%');
  perform pg_temp.debe_fallar($q$select cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e613', null, 100, 'cash', null, null)$q$, '%No estás registrado como cobrador%');
  r := cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e611', null, 100, 'transfer', 'T-9', null);
  perform pg_temp.igual((select en_calle from loan_payments where id = (r->>'payment_id')::uuid), false, 'transferencia fuera del cuadre');

  -- Visitas: la promesa queda; otro cliente no; con cobranza-all (admin) sí.
  perform cobranza_registrar_visita(b1, '00000000-0000-0000-0000-00000000e601', 'promesa', current_date + 1, 300, 'el viernes');
  perform pg_temp.igual((select promise_date from collection_visits where customer_id = '00000000-0000-0000-0000-00000000e601' and outcome = 'promesa'),
                        current_date + 1, 'promesa con fecha');
  perform pg_temp.debe_fallar(format('select cobranza_registrar_visita(%L, %L, %L, null, null, null)', b1, '00000000-0000-0000-0000-00000000e602', 'no_estaba'), '%no está en tu ruta%');

  -- La oficina (admin) sigue necesitando caja abierta para el efectivo.
  perform pg_temp.como(yo);
  perform cobranza_registrar_visita(b1, '00000000-0000-0000-0000-00000000e601', 'no_estaba', null, null, null);
  perform pg_temp.debe_fallar(format('select register_loan_payment(%L, 10, %L, %L, null, null)', '00000000-0000-0000-0000-00000000e612', 'cash', b1), '%caja abierta%');

  -- Sesión 1 (abierta hace 2 horas): un abono de oficina y el de la calle, ambos de hace 1 hora.
  insert into caja_sessions (company_id, branch_id, opening_amount) values ('00000000-0000-0000-0000-0000000000aa', b1, 1000) returning id into s1;
  update caja_sessions set opened_at = now() - interval '2 hours' where id = s1;
  pof := (register_loan_payment('00000000-0000-0000-0000-00000000e612', 300, 'cash', b1, null, null))->>'payment_id';
  update loan_payments set date = now() - interval '1 hour' where id in (pof, p1);
  r := close_caja_session(s1, 1300, null);
  perform pg_temp.igual((select (breakdown->>'loanCashPayments')::numeric from caja_sessions where id = s1), 300::numeric, 'el cierre no cuenta lo de la calle');

  -- Sesión 2 (abierta hace 30 minutos): la entrega entra como movimiento.
  insert into caja_sessions (company_id, branch_id, opening_amount) values ('00000000-0000-0000-0000-0000000000aa', b1, 0) returning id into s2;
  update caja_sessions set opened_at = now() - interval '30 minutes' where id = s2;
  ent := cobranza_recibir_entrega('00000000-0000-0000-0000-00000000e6c1', 450, 'faltan 50');
  perform pg_temp.igual((ent->>'expected')::numeric, 500::numeric, 'esperado de la entrega');
  perform pg_temp.igual((ent->>'difference')::numeric, -50::numeric, 'diferencia de la entrega');
  perform pg_temp.igual((select settlement_id from loan_payments where id = p1), (ent->>'settlement_id')::uuid, 'abono liquidado');
  perform pg_temp.igual((select amount from caja_movements where session_id = s2 and type = 'in'), 450::numeric, 'entrada a la caja');
  perform pg_temp.debe_fallar($q$select cobranza_recibir_entrega('00000000-0000-0000-0000-00000000e6c1', 10, null)$q$, '%no tiene abonos en efectivo sin entregar%');

  -- Anular el abono ya entregado: sale de la caja abierta. Anular el de oficina de
  -- la sesión cerrada: sale como hoy.
  perform void_loan_payment(p1, 'prueba');
  perform pg_temp.igual((select count(*)::int from caja_movements where session_id = s2 and type = 'out' and amount = 500), 1, 'sale lo entregado');
  r := void_loan_payment(pof, 'prueba');
  perform pg_temp.igual((r->>'cash_returned')::boolean, true, 'el de oficina sale como hoy');
  -- Uno de oficina cobrado en la sesión abierta: se excluye del cierre, no sale nada.
  r := void_loan_payment(((register_loan_payment('00000000-0000-0000-0000-00000000e612', 50, 'cash', b1, null, null))->>'payment_id')::uuid, 'prueba');
  perform pg_temp.igual((r->>'cash_returned')::boolean, false, 'el del día no sale');

  -- Anular uno de la calle sin entregar: sin caja abierta y sin movimiento.
  perform pg_temp.como(cc56);
  p2 := (cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e611', null, 200, 'cash', null, null))->>'payment_id';
  perform pg_temp.como(yo);
  r := close_caja_session(s2, 0, null);
  perform pg_temp.igual((select (breakdown->>'movementsIn')::numeric from caja_sessions where id = s2), 450::numeric, 'el cierre cuenta la entrega');
  perform pg_temp.igual((select (breakdown->>'loanCashPayments')::numeric from caja_sessions where id = s2), 0::numeric, 'y no los abonos de la calle');
  r := void_loan_payment(p2, 'prueba');
  perform pg_temp.igual((r->>'cash_returned')::boolean, false, 'sin caja: no sale nada');

  -- Sin caja en la sucursal, la entrega se registra sin movimiento.
  update branches set caja_enabled = false where id = b1;
  perform pg_temp.como(cc56);
  p3 := (cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e611', null, 100, 'cash', null, null))->>'payment_id';
  perform pg_temp.como(yo);
  -- El cajero contó con un esperado que ya no es: la base lo rechaza.
  perform pg_temp.debe_fallar($q$select cobranza_recibir_entrega('00000000-0000-0000-0000-00000000e6c1', 100, null, 300)$q$, '%cambió%');
  ent := cobranza_recibir_entrega('00000000-0000-0000-0000-00000000e6c1', 100, null, 100);
  perform pg_temp.igual((ent->>'expected')::numeric, 100::numeric, 'el anulado no se espera');
  perform pg_temp.igual((select caja_movement_id from collector_settlements where id = (ent->>'settlement_id')::uuid), null::uuid, 'entrega sin caja');
  perform pg_temp.igual((select settlement_id from loan_payments where id = p3), (ent->>'settlement_id')::uuid, 'liquidado sin caja');

  -- Sin señal, el cobrador repite el cobro: con el mismo identificador no se cobra dos veces.
  perform pg_temp.como(cc56);
  r := cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e611', null, 75, 'cash', null, null, '00000000-0000-0000-0000-00000000e6f1');
  ent := cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e611', null, 75, 'cash', null, null, '00000000-0000-0000-0000-00000000e6f1');
  perform pg_temp.igual((ent->>'repetido')::boolean, true, 'cobro repetido');
  perform pg_temp.igual((ent->>'payment_id')::uuid, (r->>'payment_id')::uuid, 'el mismo abono');
  perform pg_temp.igual((select count(*)::int from loan_payments where loan_id = '00000000-0000-0000-0000-00000000e611' and amount = 75), 1, 'un solo abono');
  perform pg_temp.como(yo);

  -- Un cobrador con abonos o entregas no se puede borrar (ni su usuario, que arrastra la fila).
  perform pg_temp.debe_fallar($q$delete from collectors where id = '00000000-0000-0000-0000-00000000e6c1'$q$, '%violates foreign key%');
end $$;

-- Abono general del cliente: reparte entre sus ventas a crédito, queda en la calle.
insert into products (id, company_id, branch_id, name, price, cost, stock) values
  ('00000000-0000-0000-0000-00000000e620', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba casco cobranza', 1000, 500, 5);
do $$
declare v_venta uuid; r jsonb;
begin
  select x.id into v_venta from create_sale_with_items(
    jsonb_build_object('branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', '00000000-0000-0000-0000-00000000e601',
      'subtotal', 1000, 'itbis_amount', 0, 'total', 1000, 'payment_method', 'credit', 'payment_status', 'credit', 'amount_paid', 0),
    jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-00000000e620', 'product_name', 'Casco',
      'quantity', 1, 'price', 1000, 'itbis', false, 'unit', 'und'))) x;
  perform pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
  r := cobranza_registrar_abono('cliente', '00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-0000000000b1', 400, 'cash', null, null);
  perform pg_temp.igual((select en_calle from credit_payments where id = (r->>'payment_id')::uuid), true, 'abono general en la calle');
  perform pg_temp.igual((select amount_paid from sales where id = v_venta), 400::numeric, 'abono general aplicado');
  perform pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
end $$;

-- ---------------------------------------------------------------------------
-- 3. El cobrador ve las motos de su sucursal (la placa en la ruta)
-- ---------------------------------------------------------------------------
insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
  ('00000000-0000-0000-0000-00000000e630', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba moto cobranza', 95000, 70000, 0, true);
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis, cost) values
  ('00000000-0000-0000-0000-00000000e631', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'inventario', '00000000-0000-0000-0000-00000000e630', 'Yamaha', 'YBR', 'COB-1', 70000);
set local role authenticated;
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
select pg_temp.igual((select count(*)::int from vehicles where id = '00000000-0000-0000-0000-00000000e631'), 1, 'el cobrador ve la moto');
with u as (update vehicles set plate = 'X' where id = '00000000-0000-0000-0000-00000000e631' returning id)
select pg_temp.igual((select count(*)::int from u), 0, 'el cobrador no edita la moto');
reset role;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

-- ---------------------------------------------------------------------------
-- 4. Enlaces de recibos de abono, plantillas y reporte de cobranza (3B, Task 1)
-- ---------------------------------------------------------------------------
-- En la otra sucursal de la demo («Sucursal Prueba», bP): el súper admin es el
-- cobrador e7c1 (los cobradores son únicos por sucursal y usuario, y en b1 ya
-- están los dos usuarios de prueba). Fechas relativas a company_today.

insert into collectors (id, company_id, branch_id, profile_id) values
  ('00000000-0000-0000-0000-00000000e7c1', '00000000-0000-0000-0000-0000000000aa', '169fe6bb-91fa-4633-8e43-5a45e410e2b0', '92381752-13b2-4f43-8b09-612647754599');
insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-0000000000aa', 'Prueba reporte asignado'),
  ('00000000-0000-0000-0000-00000000e702', '00000000-0000-0000-0000-0000000000aa', 'Prueba reporte sin asignar');
insert into collection_assignments (company_id, branch_id, customer_id, collector_id, visit_order) values
  ('00000000-0000-0000-0000-0000000000aa', '169fe6bb-91fa-4633-8e43-5a45e410e2b0', '00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-00000000e7c1', 1);
select pg_temp.prestamo('00000000-0000-0000-0000-00000000e711', '00000000-0000-0000-0000-00000000e701', '169fe6bb-91fa-4633-8e43-5a45e410e2b0');
select pg_temp.prestamo('00000000-0000-0000-0000-00000000e712', '00000000-0000-0000-0000-00000000e702', '169fe6bb-91fa-4633-8e43-5a45e410e2b0');
-- La primera cuota de cada uno vence dentro del período y queda atrasada.
update loan_installments set due_date = company_today('00000000-0000-0000-0000-0000000000aa') - 5
 where loan_id = '00000000-0000-0000-0000-00000000e711' and installment_number = 1;
update loan_installments set due_date = company_today('00000000-0000-0000-0000-0000000000aa') - 2
 where loan_id = '00000000-0000-0000-0000-00000000e712' and installment_number = 1;

do $$
declare
  bP  constant uuid := '169fe6bb-91fa-4633-8e43-5a45e410e2b0';
  e701 constant uuid := '00000000-0000-0000-0000-00000000e701';
  e7c1 constant uuid := '00000000-0000-0000-0000-00000000e7c1';
  tz  constant text := 'America/Santo_Domingo';
  hoy date := company_today('00000000-0000-0000-0000-0000000000aa');
  pa uuid; pb uuid; pc uuid; r jsonb; fila jsonb; cuota numeric;
begin
  perform pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
  -- Abonos del cobrador: 300 en efectivo hace 3 días (en la mano), 100 por
  -- transferencia ayer que se anula, y 50 hoy a las 9 p. m. de RD (01:00 UTC de mañana).
  pa := (cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e711', null, 300, 'cash', null, null))->>'payment_id';
  pb := (cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e711', null, 100, 'transfer', 'T-1', null))->>'payment_id';
  pc := (cobranza_registrar_abono('prestamo', '00000000-0000-0000-0000-00000000e711', null, 50, 'transfer', 'T-2', null))->>'payment_id';
  update loan_payments set date = ((hoy - 3) + time '15:00') at time zone tz where id = pa;
  update loan_payments set date = ((hoy - 1) + time '15:00') at time zone tz where id = pb;
  update loan_payments set date = ((hoy + 1) + time '01:00') at time zone 'UTC' where id = pc;
  perform void_loan_payment(pb, 'prueba');

  -- Promesas: cumplida (abono el día 3 entre la visita y la promesa), incumplida con
  -- solo un abono anulado, incumplida sin abono, y una de mañana que no cuenta.
  insert into collection_visits (company_id, branch_id, customer_id, collector_id, outcome, promise_date, created_at) values
    ('00000000-0000-0000-0000-0000000000aa', bP, e701, e7c1, 'promesa', hoy - 1, ((hoy - 4) + time '10:00') at time zone tz),
    ('00000000-0000-0000-0000-0000000000aa', bP, e701, e7c1, 'promesa', hoy - 1, ((hoy - 2) + time '10:00') at time zone tz),
    ('00000000-0000-0000-0000-0000000000aa', bP, e701, e7c1, 'promesa', hoy - 5, ((hoy - 6) + time '10:00') at time zone tz),
    ('00000000-0000-0000-0000-0000000000aa', bP, e701, e7c1, 'promesa', hoy + 1, (hoy + time '10:00') at time zone tz);

  r := cobranza_reporte(bP, hoy - 7, hoy);
  select x into fila from jsonb_array_elements(r->'cobradores') x where x->>'collector_id' = e7c1::text;
  select amount into cuota from loan_installments where loan_id = '00000000-0000-0000-0000-00000000e711' and installment_number = 1;
  perform pg_temp.igual((fila->>'por_cobrar')::numeric, cuota, 'por cobrar del período');
  perform pg_temp.igual((fila->>'cobrado')::numeric, 350::numeric, 'cobrado (sin el anulado, con el de las 9 p. m.)');
  perform pg_temp.igual((fila->>'visitas')::int, 7, 'visitas (3 pagos + 4 promesas)');
  perform pg_temp.igual((fila->>'promesas_cumplidas')::int, 1, 'promesas cumplidas');
  perform pg_temp.igual((fila->>'promesas_incumplidas')::int, 2, 'promesas incumplidas');
  perform pg_temp.igual((fila->>'atrasados')::int, 1, 'atrasados en su cartera');
  perform pg_temp.igual((fila->>'en_mano')::numeric, 300::numeric, 'en mano');
  perform pg_temp.igual(fila->>'en_mano_desde', (hoy - 3)::text, 'en mano desde');
  perform pg_temp.igual(fila->>'nombre' is not null, true, 'nombre del cobrador');
  select amount into cuota from loan_installments where loan_id = '00000000-0000-0000-0000-00000000e712' and installment_number = 1;
  perform pg_temp.igual((r->'sin_asignar'->>'por_cobrar')::numeric, cuota, 'por cobrar sin asignar');
  perform pg_temp.igual((r->'sin_asignar'->>'atrasados')::int, 1, 'atrasados sin asignar');

  -- Un Cobrador sin reportes ni «ver todas las rutas» no lo ve.
  perform pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
  perform pg_temp.debe_fallar(format('select cobranza_reporte(%L, %L, %L)', '00000000-0000-0000-0000-0000000000b1', hoy - 7, hoy),
                              '%No tienes permiso para ver los reportes de cobranza%');
  perform pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

  -- Enlaces: un recibo de abono sin venta; nada o dos documentos a la vez, no.
  insert into receipt_links (code, loan_payment_id, company_id, company_slug, storage_path, download_name, expires_at)
  values ('PRUEBAe7a', pa, '00000000-0000-0000-0000-0000000000aa', 'demo', 'x/abonos/a.pdf', 'recibo-de-abono.pdf', now() + interval '15 days');
  perform pg_temp.debe_fallar($q$insert into receipt_links (code, company_id, company_slug, storage_path, download_name, expires_at)
    values ('PRUEBAe7b', '00000000-0000-0000-0000-0000000000aa', 'demo', 'x/b.pdf', 'b.pdf', now())$q$, '%receipt_links_un_documento%');
  perform pg_temp.debe_fallar(format($q$insert into receipt_links (code, sale_id, loan_payment_id, company_id, company_slug, storage_path, download_name, expires_at)
    values ('PRUEBAe7c', (select id from sales limit 1), %L, '00000000-0000-0000-0000-0000000000aa', 'demo', 'x/c.pdf', 'c.pdf', now())$q$, pa),
    '%receipt_links_un_documento%');
end $$;
select pg_temp.igual((select count(*)::int from receipt_links where num_nonnulls(sale_id, loan_payment_id, credit_payment_id) <> 1), 0, 'enlaces existentes válidos');

-- Plantillas: sin fila de ajustes, vacías (el texto base lo pone el front).
select pg_temp.igual((public.motos_ajuste(gen_random_uuid())).whatsapp_reminder, null::text, 'plantilla de aviso por defecto');
select pg_temp.igual((public.motos_ajuste(gen_random_uuid())).whatsapp_receipt, null::text, 'plantilla de recibo por defecto');

select 'ok';
