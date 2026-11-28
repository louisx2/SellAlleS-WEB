-- Pruebas de Servicios, entrega 1 (personal, fichas del cliente y camino de la orden).
-- NO es una migración: se corre contra producción dentro de una transacción que se
-- revierte, después del SQL de la migración (o sola, si ya está aplicada):
--
--   begin; <20261128120000_servicios_base.sql> <este archivo> rollback;
--
-- Usa dos empresas de prueba propias (…e7XX y …e8XX) y tres usuarios de prueba que
-- nacen aquí mismo (auth.users → profiles), no la demo ni usuarios reales:
--   …e7f1 Ana Admin: administradora de la empresa …e7a0.
--   …e7f2 María Pérez: personal con usuario en la sucursal …e7b1, con un rol que
--         tiene Servicios ver/crear/editar y no «ver todas».
--   …e7f3 Carlos Caja: cajero de …e7b1 con un rol sin Servicios; no es personal.
--   …e7f4 Celia Crea: en …e7b1 con un rol que tiene Servicios ver/crear, sin editar.
-- La orden «cobrada» del caso C apunta a una venta que ya existe en la demo (la FK lo
-- exige); esa venta no se toca.
--
-- Cada caso corre en su propio bloque y anota si pasó; al final, si alguno falló, se
-- detiene con la lista. Si pasan todos, la última consulta los muestra en «ok».

-- Sin usuario mientras se arma: los triggers de empresas y perfiles dejan hacer.
select set_config('request.jwt.claims', '', true);

create function pg_temp.igual(p_real anyelement, p_esperado anyelement, p_que text) returns void
language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception '%: dio %, esperaba %', p_que, p_real, p_esperado;
  end if;
end $$;

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

create function pg_temp.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

create temp table srv_resultado (caso text, error text);

-- Empresas, sucursales y usuarios de prueba (todo con tablas que ya existen).
insert into companies (id, name, max_users, loyalty_enabled, loyalty_purchases_required) values
  ('00000000-0000-0000-0000-00000000e7a0', 'Prueba servicios', null, true, 5),
  ('00000000-0000-0000-0000-00000000e8a0', 'Prueba servicios otra empresa', null, false, null);
insert into branches (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e7b1', '00000000-0000-0000-0000-00000000e7a0', 'Principal'),
  ('00000000-0000-0000-0000-00000000e7b2', '00000000-0000-0000-0000-00000000e7a0', 'Segunda'),
  ('00000000-0000-0000-0000-00000000e8b1', '00000000-0000-0000-0000-00000000e8a0', 'Principal otra');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000e7f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'servicios-admin@prueba.invalid', '{"name":"Ana Admin"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000e7f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'servicios-personal@prueba.invalid', '{"name":"María Pérez"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000e7f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'servicios-cajero@prueba.invalid', '{"name":"Carlos Caja"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-00000000e7f4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'servicios-crea@prueba.invalid', '{"name":"Celia Crea"}', '{}', now(), now());
update profiles set company_id = '00000000-0000-0000-0000-00000000e7a0', role = 'admin'
 where id = '00000000-0000-0000-0000-00000000e7f1';
update profiles set company_id = '00000000-0000-0000-0000-00000000e7a0', role = 'cashier'
 where id in ('00000000-0000-0000-0000-00000000e7f2', '00000000-0000-0000-0000-00000000e7f3', '00000000-0000-0000-0000-00000000e7f4');

-- Los permisos salen del rol de la persona EN la sucursal (lo que lee taller_tiene_permiso).
insert into roles (id, company_id, name, is_system, permissions) values
  ('00000000-0000-0000-0000-00000000e7d1', '00000000-0000-0000-0000-00000000e7a0', 'Personal de prueba', false,
   '{"services":["view","create","edit"],"customers":["view","create"]}'),
  ('00000000-0000-0000-0000-00000000e7d2', '00000000-0000-0000-0000-00000000e7a0', 'Caja de prueba', false,
   '{"pos":["view","create"],"customers":["view","create"]}'),
  ('00000000-0000-0000-0000-00000000e7d3', '00000000-0000-0000-0000-00000000e7a0', 'Solo crea de prueba', false,
   '{"services":["view","create"]}');
insert into profile_branches (profile_id, branch_id, role_id) values
  ('00000000-0000-0000-0000-00000000e7f2', '00000000-0000-0000-0000-00000000e7b1', '00000000-0000-0000-0000-00000000e7d1'),
  ('00000000-0000-0000-0000-00000000e7f3', '00000000-0000-0000-0000-00000000e7b1', '00000000-0000-0000-0000-00000000e7d2'),
  ('00000000-0000-0000-0000-00000000e7f4', '00000000-0000-0000-0000-00000000e7b1', '00000000-0000-0000-0000-00000000e7d3');

insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e7e1', '00000000-0000-0000-0000-00000000e7a0', 'Cliente de prueba'),
  ('00000000-0000-0000-0000-00000000e8e1', '00000000-0000-0000-0000-00000000e8a0', 'Cliente de la otra empresa');

insert into products (id, company_id, branch_id, name, price, cost, stock, tracks_stock, es_servicio) values
  ('00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Baño de prueba', 500, 0, 0, false, true),
  ('00000000-0000-0000-0000-00000000e702', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Champú de prueba', 100, 50, 10, true, false),
  ('00000000-0000-0000-0000-00000000e703', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Vacuna con existencias', 800, 400, 5, true, false),
  ('00000000-0000-0000-0000-00000000e704', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b2', 'Corte de la otra sucursal', 300, 0, 0, true, false),
  ('00000000-0000-0000-0000-00000000e705', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Artículo ya enlazado', 300, 0, 0, false, true),
  ('00000000-0000-0000-0000-00000000e706', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Corte de uñas en inventario', 250, 0, 0, true, false),
  ('00000000-0000-0000-0000-00000000e801', '00000000-0000-0000-0000-00000000e8a0', '00000000-0000-0000-0000-00000000e8b1', 'Servicio de la otra empresa', 100, 0, 0, false, true);

insert into service_types (id, company_id, branch_id, product_id, name, base_price) values
  ('00000000-0000-0000-0000-00000000e751', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1',
   '00000000-0000-0000-0000-00000000e705', 'Servicio ya enlazado', 300);

-- 0. El personal que usan los casos (tabla nueva, por eso va en su bloque).
do $$
begin
  begin
    insert into service_staff (id, company_id, branch_id, name, profile_id, is_active) values
      ('00000000-0000-0000-0000-00000000e7c1', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'María Pérez', '00000000-0000-0000-0000-00000000e7f2', true),
      ('00000000-0000-0000-0000-00000000e7c3', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Persona inactiva', null, false),
      ('00000000-0000-0000-0000-00000000e7c4', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b2', 'Persona de la Segunda', null, true),
      ('00000000-0000-0000-0000-00000000e7c5', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Rosa Díaz', null, true),
      ('00000000-0000-0000-0000-00000000e8c1', '00000000-0000-0000-0000-00000000e8a0', '00000000-0000-0000-0000-00000000e8b1', 'Persona de la otra empresa', null, true);
    insert into srv_resultado values ('0 preparación', null);
  exception when others then
    insert into srv_resultado values ('0 preparación', sqlerrm);
  end;
end $$;

-- A. La demo tiene Servicios; una empresa sin fila no. La fidelidad de una orden
--    cerrada solo cuenta con el módulo encendido.
do $$
begin
  begin
    perform pg_temp.igual(is_module_enabled('00000000-0000-0000-0000-0000000000aa', 'services', false), true, 'la demo tiene Servicios');
    perform pg_temp.igual(is_module_enabled('00000000-0000-0000-0000-00000000e7a0', 'services', false), false, 'empresa sin fila');

    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    insert into services (id, company_id, branch_id, customer_id, description, status) values
      ('00000000-0000-0000-0000-00000000e780', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1',
       '00000000-0000-0000-0000-00000000e7e1', 'Fidelidad sin el módulo', 'ready'),
      ('00000000-0000-0000-0000-00000000e781', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1',
       '00000000-0000-0000-0000-00000000e7e1', 'Fidelidad con el módulo', 'ready');
    perform taller_entregar('00000000-0000-0000-0000-00000000e780');
    perform pg_temp.igual((select loyalty_purchase_count from customers where id = '00000000-0000-0000-0000-00000000e7e1'), 0, 'fidelidad sin el módulo');

    insert into company_modules (company_id, module_key, enabled) values ('00000000-0000-0000-0000-00000000e7a0', 'services', true);
    perform taller_entregar('00000000-0000-0000-0000-00000000e781');
    perform pg_temp.igual((select loyalty_purchase_count from customers where id = '00000000-0000-0000-0000-00000000e7e1'), 1, 'fidelidad con el módulo');
    delete from company_modules where company_id = '00000000-0000-0000-0000-00000000e7a0' and module_key = 'services';

    insert into srv_resultado values ('A módulo', null);
  exception when others then
    insert into srv_resultado values ('A módulo', sqlerrm);
  end;
end $$;

-- B. Personal sin usuario y una orden asignada a él. No se le pasa la orden a una
--    persona inactiva ni a una de otra sucursal.
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    insert into service_staff (id, branch_id, name, phone, color, commission_rate) values
      ('00000000-0000-0000-0000-00000000e7c2', '00000000-0000-0000-0000-00000000e7b1', 'Pedro Gómez', '8095550000', '#1a2b3c', 10);
    perform pg_temp.igual((select company_id from service_staff where id = '00000000-0000-0000-0000-00000000e7c2'),
                          '00000000-0000-0000-0000-00000000e7a0'::uuid, 'empresa del personal');
    perform pg_temp.igual((select profile_id from service_staff where id = '00000000-0000-0000-0000-00000000e7c2'), null::uuid, 'personal sin usuario');

    insert into services (id, branch_id, description, staff_id) values
      ('00000000-0000-0000-0000-00000000e791', '00000000-0000-0000-0000-00000000e7b1', 'Orden de Pedro', '00000000-0000-0000-0000-00000000e7c2');
    perform pg_temp.igual((select staff_id from services where id = '00000000-0000-0000-0000-00000000e791'),
                          '00000000-0000-0000-0000-00000000e7c2'::uuid, 'orden asignada a Pedro');

    perform pg_temp.debe_fallar($q$select servicios_asignar('00000000-0000-0000-0000-00000000e791', '00000000-0000-0000-0000-00000000e7c3')$q$,
                                '%Esa persona no está en el personal de esta sucursal.%');
    perform pg_temp.debe_fallar($q$select servicios_asignar('00000000-0000-0000-0000-00000000e791', '00000000-0000-0000-0000-00000000e7c4')$q$,
                                '%Esa persona no está en el personal de esta sucursal.%');
    perform pg_temp.igual((select staff_id from services where id = '00000000-0000-0000-0000-00000000e791'),
                          '00000000-0000-0000-0000-00000000e7c2'::uuid, 'sigue con Pedro');
    reset role;
    insert into srv_resultado values ('B personal sin usuario', null);
  exception when others then
    insert into srv_resultado values ('B personal sin usuario', sqlerrm);
  end;
end $$;

-- C. Una línea de servicio con dos personas. Una pieza no lleva persona. Quien solo
--    puede crear órdenes dice quién hace la línea que agrega. Cobrada la orden, ya no
--    se cambian las personas.
do $$
declare
  v_venta uuid := (select id from sales where company_id = '00000000-0000-0000-0000-0000000000aa' order by created_at limit 1);
begin
  begin
    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    insert into services (id, branch_id, description, staff_id) values
      ('00000000-0000-0000-0000-00000000e792', '00000000-0000-0000-0000-00000000e7b1', 'Orden con líneas', '00000000-0000-0000-0000-00000000e7c2');
    insert into service_items (id, service_id, product_id, quantity, price, kind) values
      ('00000000-0000-0000-0000-00000000e771', '00000000-0000-0000-0000-00000000e792', '00000000-0000-0000-0000-00000000e701', 1, 500, 'labor'),
      ('00000000-0000-0000-0000-00000000e772', '00000000-0000-0000-0000-00000000e792', '00000000-0000-0000-0000-00000000e702', 1, 100, 'part');
    insert into service_item_staff (service_item_id, staff_id) values
      ('00000000-0000-0000-0000-00000000e771', '00000000-0000-0000-0000-00000000e7c1'),
      ('00000000-0000-0000-0000-00000000e771', '00000000-0000-0000-0000-00000000e7c2');
    perform pg_temp.igual((select count(*)::int from service_item_staff where service_item_id = '00000000-0000-0000-0000-00000000e771'), 2, 'dos personas en la línea');
    perform pg_temp.igual((select count(*)::int from service_item_staff
                            where service_item_id = '00000000-0000-0000-0000-00000000e771'
                              and company_id = '00000000-0000-0000-0000-00000000e7a0'), 2, 'empresa de las personas de la línea');

    perform pg_temp.debe_fallar($q$insert into service_item_staff (service_item_id, staff_id)
      values ('00000000-0000-0000-0000-00000000e772', '00000000-0000-0000-0000-00000000e7c1')$q$, '%Solo los servicios llevan quién los hace.%');
    perform pg_temp.debe_fallar($q$insert into service_item_staff (service_item_id, staff_id)
      values ('00000000-0000-0000-0000-00000000e771', '00000000-0000-0000-0000-00000000e7c3')$q$, '%Esa persona no está en el personal de esta sucursal.%');
    perform pg_temp.debe_fallar($q$insert into service_item_staff (service_item_id, staff_id)
      values ('00000000-0000-0000-0000-00000000e771', '00000000-0000-0000-0000-00000000e7c4')$q$, '%Esa persona no está en el personal de esta sucursal.%');

    -- Quien solo crea (sin editar): su orden nueva, su línea y quién la hace.
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f4');
    insert into services (id, branch_id, description) values
      ('00000000-0000-0000-0000-00000000e783', '00000000-0000-0000-0000-00000000e7b1', 'Orden de quien solo crea');
    insert into service_items (id, service_id, product_id, quantity, price, kind) values
      ('00000000-0000-0000-0000-00000000e774', '00000000-0000-0000-0000-00000000e783', '00000000-0000-0000-0000-00000000e701', 1, 500, 'labor');
    insert into service_item_staff (service_item_id, staff_id) values
      ('00000000-0000-0000-0000-00000000e774', '00000000-0000-0000-0000-00000000e7c2');
    perform pg_temp.igual((select count(*)::int from service_item_staff where service_item_id = '00000000-0000-0000-0000-00000000e774'), 1,
                          'quien solo crea dice quién hace la línea');
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');

    -- Cobrada: el sale_id solo se pone con taller.cobro (lo hace create_sale_with_items).
    reset role;
    perform pg_temp.igual(v_venta is not null, true, 'hay una venta de la demo para la FK');
    perform set_config('taller.cobro', 'si', true);
    update services set sale_id = v_venta where id = '00000000-0000-0000-0000-00000000e792';
    perform set_config('taller.cobro', '', true);

    set local role authenticated;
    perform pg_temp.debe_fallar($q$insert into service_item_staff (service_item_id, staff_id)
      values ('00000000-0000-0000-0000-00000000e771', '00000000-0000-0000-0000-00000000e7c5')$q$, '%ya fue cobrada%');
    perform pg_temp.debe_fallar($q$delete from service_item_staff
      where service_item_id = '00000000-0000-0000-0000-00000000e771' and staff_id = '00000000-0000-0000-0000-00000000e7c2'$q$, '%ya fue cobrada%');
    perform pg_temp.igual((select count(*)::int from service_item_staff where service_item_id = '00000000-0000-0000-0000-00000000e771'), 2, 'siguen las dos personas');
    reset role;
    insert into srv_resultado values ('C personas por línea', null);
  exception when others then
    insert into srv_resultado values ('C personas por línea', sqlerrm);
  end;
end $$;

-- D. Una orden que no se queda no pasa a Listo y se cierra desde En proceso sin
--    pedir quién retira. Una que se queda y está Lista no cambia «El cliente espera».
--    Si es de reparación no cambia después de crearla.
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    insert into services (id, branch_id, description, stays_in_shop, is_repair) values
      ('00000000-0000-0000-0000-00000000e793', '00000000-0000-0000-0000-00000000e7b1', 'Atiende y se va', false, false);
    perform pg_temp.debe_fallar($q$select taller_cambiar_estado('00000000-0000-0000-0000-00000000e793', 'ready')$q$,
                                '%Esta orden no se queda en el negocio: termínala cuando acabes.%');
    perform pg_temp.debe_fallar($q$update services set status = 'ready' where id = '00000000-0000-0000-0000-00000000e793'$q$,
                                '%Esta orden no se queda en el negocio: termínala cuando acabes.%');
    perform taller_cambiar_estado('00000000-0000-0000-0000-00000000e793', 'in_repair');
    perform taller_entregar('00000000-0000-0000-0000-00000000e793', 'Alguien que retira');
    perform pg_temp.igual((select status from services where id = '00000000-0000-0000-0000-00000000e793'), 'delivered', 'terminada desde En proceso');
    perform pg_temp.igual((select picked_up_by_name from services where id = '00000000-0000-0000-0000-00000000e793'), null::text, 'sin quién retira');
    perform pg_temp.debe_fallar($q$update services set stays_in_shop = true where id = '00000000-0000-0000-0000-00000000e793'$q$,
                                '%Pasa la orden a otro estado antes de cambiar si el cliente espera.%');

    insert into services (id, branch_id, description) values
      ('00000000-0000-0000-0000-00000000e794', '00000000-0000-0000-0000-00000000e7b1', 'Se queda');
    perform taller_cambiar_estado('00000000-0000-0000-0000-00000000e794', 'ready');
    perform pg_temp.debe_fallar($q$update services set stays_in_shop = false where id = '00000000-0000-0000-0000-00000000e794'$q$,
                                '%Pasa la orden a otro estado antes de cambiar si el cliente espera.%');
    perform pg_temp.debe_fallar($q$update services set is_repair = false where id = '00000000-0000-0000-0000-00000000e794'$q$,
                                '%Esto se decide al crear la orden.%');
    perform pg_temp.igual((select is_repair from services where id = '00000000-0000-0000-0000-00000000e794'), true, 'sigue de reparación');
    -- En otro estado sí se puede cambiar.
    perform taller_cambiar_estado('00000000-0000-0000-0000-00000000e794', 'in_repair');
    update services set stays_in_shop = false where id = '00000000-0000-0000-0000-00000000e794';
    perform pg_temp.igual((select stays_in_shop from services where id = '00000000-0000-0000-0000-00000000e794'), false, 'el cliente espera');
    reset role;
    insert into srv_resultado values ('D camino de la orden', null);
  exception when others then
    insert into srv_resultado values ('D camino de la orden', sqlerrm);
  end;
end $$;

-- E. El historial anota la reasignación con from_staff y to_staff. Borrar a la
--    persona responsable deja la orden sin responsable, sin error y sin anotarlo.
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    insert into services (id, branch_id, description, staff_id) values
      ('00000000-0000-0000-0000-00000000e795', '00000000-0000-0000-0000-00000000e7b1', 'Para reasignar', '00000000-0000-0000-0000-00000000e7c2');
    perform pg_temp.igual((select to_staff from service_events
                            where service_id = '00000000-0000-0000-0000-00000000e795' and kind = 'created'),
                          '00000000-0000-0000-0000-00000000e7c2'::uuid, 'al crear');
    perform servicios_asignar('00000000-0000-0000-0000-00000000e795', '00000000-0000-0000-0000-00000000e7c1', 'Se la paso a María');
    perform pg_temp.igual((select count(*)::int from service_events
                            where service_id = '00000000-0000-0000-0000-00000000e795' and kind = 'assigned'
                              and from_staff = '00000000-0000-0000-0000-00000000e7c2'
                              and to_staff = '00000000-0000-0000-0000-00000000e7c1'
                              and note = 'Se la paso a María'), 1, 'reasignación en el historial');

    insert into service_staff (id, branch_id, name) values
      ('00000000-0000-0000-0000-00000000e7c6', '00000000-0000-0000-0000-00000000e7b1', 'Temporal');
    perform servicios_asignar('00000000-0000-0000-0000-00000000e795', '00000000-0000-0000-0000-00000000e7c6');
    delete from service_staff where id = '00000000-0000-0000-0000-00000000e7c6';
    perform pg_temp.igual((select staff_id from services where id = '00000000-0000-0000-0000-00000000e795'), null::uuid, 'sin responsable');
    perform pg_temp.igual((select count(*)::int from service_events
                            where service_id = '00000000-0000-0000-0000-00000000e795' and kind = 'assigned'), 2, 'borrar no es reasignar');
    reset role;
    insert into srv_resultado values ('E historial', null);
  exception when others then
    insert into srv_resultado values ('E historial', sqlerrm);
  end;
end $$;

-- F. La persona con usuario (sin «ver todas») ve su orden, la que tiene en una línea
--    y la sin asignar, no la de otra persona. Al pasarle la suya a otra, deja de verla.
do $$
begin
  begin
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    insert into services (id, company_id, branch_id, description, staff_id) values
      ('00000000-0000-0000-0000-00000000e796', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'De María', '00000000-0000-0000-0000-00000000e7c1'),
      ('00000000-0000-0000-0000-00000000e797', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Con María en una línea', '00000000-0000-0000-0000-00000000e7c2'),
      ('00000000-0000-0000-0000-00000000e798', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Sin asignar', null),
      ('00000000-0000-0000-0000-00000000e799', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'De Pedro', '00000000-0000-0000-0000-00000000e7c2');
    insert into service_items (id, service_id, product_id, quantity, price, kind) values
      ('00000000-0000-0000-0000-00000000e773', '00000000-0000-0000-0000-00000000e797', '00000000-0000-0000-0000-00000000e701', 1, 500, 'labor');
    insert into service_item_staff (service_item_id, staff_id) values
      ('00000000-0000-0000-0000-00000000e773', '00000000-0000-0000-0000-00000000e7c1');

    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f2');
    perform pg_temp.igual((select string_agg(description, ',' order by description) from services
                            where id in ('00000000-0000-0000-0000-00000000e796', '00000000-0000-0000-0000-00000000e797',
                                         '00000000-0000-0000-0000-00000000e798', '00000000-0000-0000-0000-00000000e799')),
                          'Con María en una línea,De María,Sin asignar', 'lo que ve María');
    perform pg_temp.igual((select count(*)::int from service_item_staff where service_item_id = '00000000-0000-0000-0000-00000000e773'), 1, 've su línea');
    perform pg_temp.igual((select count(*)::int from service_staff where id = '00000000-0000-0000-0000-00000000e7c2'), 1, 've el personal de su sucursal');
    perform pg_temp.igual((select count(*)::int from service_staff where id = '00000000-0000-0000-0000-00000000e7c4'), 0, 'no ve el personal de otra sucursal');

    perform servicios_asignar('00000000-0000-0000-0000-00000000e796', '00000000-0000-0000-0000-00000000e7c2');
    perform pg_temp.igual((select count(*)::int from services where id = '00000000-0000-0000-0000-00000000e796'), 0, 'ya no ve la que pasó');
    reset role;
    perform pg_temp.igual((select staff_id from services where id = '00000000-0000-0000-0000-00000000e796'),
                          '00000000-0000-0000-0000-00000000e7c2'::uuid, 'quedó con Pedro');
    insert into srv_resultado values ('F lo que ve el personal', null);
  exception when others then
    insert into srv_resultado values ('F lo que ve el personal', sqlerrm);
  end;
end $$;

-- G. «Usar un artículo que ya existe» en el catálogo.
do $$
declare
  v_st service_types;
begin
  begin
    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    perform pg_temp.debe_fallar($q$select taller_guardar_servicio('{"branch_id":"00000000-0000-0000-0000-00000000e7b1","name":"Vacuna","price":800,
      "link_product_id":"00000000-0000-0000-0000-00000000e703"}')$q$, '%tiene existencias%');
    perform pg_temp.debe_fallar($q$select taller_guardar_servicio('{"branch_id":"00000000-0000-0000-0000-00000000e7b1","name":"Corte","price":300,
      "link_product_id":"00000000-0000-0000-0000-00000000e704"}')$q$, '%no es de esta sucursal%');
    perform pg_temp.debe_fallar($q$select taller_guardar_servicio('{"branch_id":"00000000-0000-0000-0000-00000000e7b1","name":"Otro","price":300,
      "link_product_id":"00000000-0000-0000-0000-00000000e705"}')$q$, '%ya es otro servicio del catálogo%');
    perform pg_temp.debe_fallar($q$select taller_guardar_servicio('{"branch_id":"00000000-0000-0000-0000-00000000e7b1","name":"Doble","price":300,
      "commission_rate":10,"commission_amount":50}')$q$, '%no los dos%');

    v_st := taller_guardar_servicio(jsonb_build_object(
      'branch_id', '00000000-0000-0000-0000-00000000e7b1', 'name', 'Corte de uñas', 'price', 250, 'itbis', false,
      'link_product_id', '00000000-0000-0000-0000-00000000e706',
      'duration_min', 30, 'commission_rate', 10, 'repeat_every_days', 21, 'at_customer_default', true));
    perform pg_temp.igual(v_st.product_id, '00000000-0000-0000-0000-00000000e706'::uuid, 'servicio enlazado al artículo');
    perform pg_temp.igual((select tracks_stock from products where id = '00000000-0000-0000-0000-00000000e706'), false, 'sin existencias');
    perform pg_temp.igual((select es_servicio from products where id = '00000000-0000-0000-0000-00000000e706'), true, 'es servicio');
    perform pg_temp.igual((select name from products where id = '00000000-0000-0000-0000-00000000e706'), 'Corte de uñas', 'nombre del artículo');
    perform pg_temp.igual((select count(*)::int from products
                            where branch_id = '00000000-0000-0000-0000-00000000e7b1' and name = 'Corte de uñas'), 1, 'no creó otro artículo');
    perform pg_temp.igual(v_st.duration_min, 30, 'duración');
    perform pg_temp.igual(v_st.commission_rate, 10::numeric, 'comisión');
    perform pg_temp.igual(v_st.commission_amount, null::numeric, 'sin monto fijo');
    perform pg_temp.igual(v_st.repeat_every_days, 21, 'volver cada');
    perform pg_temp.igual(v_st.at_customer_default, true, 'a domicilio por defecto');

    -- Con su artículo ya puesto: el mismo pasa; otro no.
    v_st := taller_guardar_servicio(jsonb_build_object(
      'id', v_st.id, 'branch_id', '00000000-0000-0000-0000-00000000e7b1', 'name', 'Corte de uñas', 'price', 300, 'itbis', false,
      'link_product_id', '00000000-0000-0000-0000-00000000e706'));
    perform pg_temp.igual((select price from products where id = '00000000-0000-0000-0000-00000000e706'), 300::numeric, 'precio al guardar otra vez');
    perform pg_temp.debe_fallar(format($q$select taller_guardar_servicio('{"id":"%s","branch_id":"00000000-0000-0000-0000-00000000e7b1",
      "name":"Corte de uñas","price":300,"link_product_id":"00000000-0000-0000-0000-00000000e701"}')$q$, v_st.id), '%ya tiene su artículo%');
    reset role;
    insert into srv_resultado values ('G usar un artículo', null);
  exception when others then
    insert into srv_resultado values ('G usar un artículo', sqlerrm);
  end;
end $$;

-- H. Fichas del cliente: el cajero sin Servicios no las crea; la persona con usuario sí.
--    Se ven si se ve el cliente; no se borran, se desactivan.
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f3');
    perform pg_temp.igual((select count(*)::int from customers where id = '00000000-0000-0000-0000-00000000e7e1'), 1, 'el cajero ve al cliente');
    perform pg_temp.debe_fallar($q$insert into customer_subjects (customer_id, brand, model)
      values ('00000000-0000-0000-0000-00000000e7e1', 'Max', 'Poodle')$q$, '%row-level security%');

    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f2');
    insert into customer_subjects (id, customer_id, brand, model, details, notes) values
      ('00000000-0000-0000-0000-00000000e761', '00000000-0000-0000-0000-00000000e7e1', 'Max', 'Poodle', '{"Tamaño":"Mediano"}', 'Muerde');
    perform pg_temp.igual((select company_id from customer_subjects where id = '00000000-0000-0000-0000-00000000e761'),
                          '00000000-0000-0000-0000-00000000e7a0'::uuid, 'empresa de la ficha');
    update customer_subjects set is_active = false where id = '00000000-0000-0000-0000-00000000e761';
    perform pg_temp.igual((select is_active from customer_subjects where id = '00000000-0000-0000-0000-00000000e761'), false, 'ficha desactivada');
    perform pg_temp.debe_fallar($q$delete from customer_subjects where id = '00000000-0000-0000-0000-00000000e761'$q$, '%permission denied%');

    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f3');
    perform pg_temp.igual((select count(*)::int from customer_subjects where id = '00000000-0000-0000-0000-00000000e761'), 1, 'el cajero ve la ficha');
    update customer_subjects set notes = 'Cambiada por el cajero' where id = '00000000-0000-0000-0000-00000000e761';
    perform pg_temp.igual((select notes from customer_subjects where id = '00000000-0000-0000-0000-00000000e761'), 'Muerde', 'el cajero no la cambia');
    reset role;
    insert into srv_resultado values ('H fichas del cliente', null);
  exception when others then
    insert into srv_resultado values ('H fichas del cliente', sqlerrm);
  end;
end $$;

-- I. El seguimiento público dice el camino de la orden y el primer nombre de quien atiende.
do $$
declare
  v_res jsonb;
  v_codigo text;
  v_codigo_sin text := (select tracking_code from services where id = '00000000-0000-0000-0000-00000000e798');
begin
  begin
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    insert into services (id, company_id, branch_id, description, staff_id, stays_in_shop, is_repair, at_customer,
                          service_address, equipment_brand, equipment_model) values
      ('00000000-0000-0000-0000-00000000e79a', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1',
       'Baño a domicilio', '00000000-0000-0000-0000-00000000e7c1', false, false, true, 'Calle 1', 'Max', 'Poodle');
    v_codigo := (select tracking_code from services where id = '00000000-0000-0000-0000-00000000e79a');

    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    v_res := taller_seguimiento_publico(v_codigo);
    perform pg_temp.igual(v_res -> 'caso' -> 'se_queda', 'false'::jsonb, 'se queda');
    perform pg_temp.igual(v_res -> 'caso' -> 'reparacion', 'false'::jsonb, 'de reparación');
    perform pg_temp.igual(v_res -> 'caso' -> 'a_domicilio', 'true'::jsonb, 'a domicilio');
    perform pg_temp.igual(v_res -> 'caso' ->> 'atiende', 'María', 'quién atiende');
    perform pg_temp.igual(v_res -> 'caso' ->> 'ficha', 'Max Poodle', 'la ficha');
    v_res := taller_seguimiento_publico(v_codigo_sin);
    perform pg_temp.igual(jsonb_typeof(v_res -> 'caso' -> 'atiende'), 'null', 'sin responsable');
    reset role;
    insert into srv_resultado values ('I seguimiento', null);
  exception when others then
    insert into srv_resultado values ('I seguimiento', sqlerrm);
  end;
end $$;

-- J. anon no tiene nada de lo nuevo; la persona con usuario no ve lo de otra empresa.
do $$
begin
  begin
    perform pg_temp.igual(has_function_privilege('anon', 'public.servicios_ve_orden(uuid,uuid,uuid,uuid)', 'EXECUTE'), false, 'anon y servicios_ve_orden');
    perform pg_temp.igual(has_function_privilege('anon', 'public.servicios_asignar(uuid,uuid,text)', 'EXECUTE'), false, 'anon y servicios_asignar');
    perform pg_temp.igual(has_function_privilege('anon', 'public.servicios_permiso_en_alguna(text)', 'EXECUTE'), false, 'anon y servicios_permiso_en_alguna');
    perform pg_temp.igual(has_table_privilege('anon', 'public.service_staff', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), false, 'anon y el personal');
    perform pg_temp.igual(has_table_privilege('anon', 'public.service_item_staff', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), false, 'anon y las personas de las líneas');
    perform pg_temp.igual(has_table_privilege('anon', 'public.customer_subjects', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), false, 'anon y las fichas');
    perform pg_temp.igual(has_function_privilege('authenticated', 'public.servicios_ve_orden(uuid,uuid,uuid,uuid)', 'EXECUTE'), true, 'las políticas pueden usar servicios_ve_orden');
    perform pg_temp.igual(has_function_privilege('authenticated', 'public.servicios_item_staff_guard()', 'EXECUTE'), false, 'el trigger no se llama por la API');

    -- Lo de la otra empresa, sin usuario (como lo crearía otra sesión).
    perform set_config('request.jwt.claims', '', true);
    insert into customer_subjects (id, company_id, customer_id, brand) values
      ('00000000-0000-0000-0000-00000000e861', '00000000-0000-0000-0000-00000000e8a0', '00000000-0000-0000-0000-00000000e8e1', 'Ficha ajena');
    insert into services (id, company_id, branch_id, description) values
      ('00000000-0000-0000-0000-00000000e891', '00000000-0000-0000-0000-00000000e8a0', '00000000-0000-0000-0000-00000000e8b1', 'Orden ajena sin asignar');
    insert into service_items (id, service_id, product_id, quantity, price, kind) values
      ('00000000-0000-0000-0000-00000000e871', '00000000-0000-0000-0000-00000000e891', '00000000-0000-0000-0000-00000000e801', 1, 100, 'labor');
    insert into service_item_staff (service_item_id, staff_id) values
      ('00000000-0000-0000-0000-00000000e871', '00000000-0000-0000-0000-00000000e8c1');

    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f2');
    perform pg_temp.igual((select count(*)::int from service_staff where company_id = '00000000-0000-0000-0000-00000000e8a0'), 0, 'personal ajeno');
    perform pg_temp.igual((select count(*)::int from customer_subjects where company_id = '00000000-0000-0000-0000-00000000e8a0'), 0, 'fichas ajenas');
    perform pg_temp.igual((select count(*)::int from services where company_id = '00000000-0000-0000-0000-00000000e8a0'), 0, 'órdenes ajenas');
    perform pg_temp.igual((select count(*)::int from service_item_staff where company_id = '00000000-0000-0000-0000-00000000e8a0'), 0, 'personas de líneas ajenas');
    reset role;
    insert into srv_resultado values ('J grants y otra empresa', null);
  exception when others then
    insert into srv_resultado values ('J grants y otra empresa', sqlerrm);
  end;
end $$;

-- K. Al actualizar un servicio del catálogo, lo que no viene se queda (el front
--    viejo no manda las claves nuevas). Una de las dos comisiones escribe las dos;
--    un null explícito borra.
do $$
declare
  v_st service_types;
begin
  begin
    set local role authenticated;
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    v_st := taller_guardar_servicio(jsonb_build_object(
      'branch_id', '00000000-0000-0000-0000-00000000e7b1', 'name', 'Baño completo', 'price', 900, 'itbis', false,
      'duration_min', 60, 'commission_amount', 150, 'repeat_every_days', 30, 'at_customer_default', true,
      'es_servicio', false));
    perform pg_temp.igual((select es_servicio from products where id = v_st.product_id), false, 'creado sin facturar como servicio');

    -- Lo que manda el front viejo.
    v_st := taller_guardar_servicio(jsonb_build_object(
      'id', v_st.id, 'branch_id', '00000000-0000-0000-0000-00000000e7b1', 'name', 'Baño completo', 'price', 950,
      'itbis', false, 'description', null, 'equipment_type_id', null, 'part_category_id', null,
      'warranty_days', null, 'is_active', true));
    perform pg_temp.igual(v_st.duration_min, 60, 'conserva la duración');
    perform pg_temp.igual(v_st.commission_amount, 150::numeric, 'conserva el monto fijo');
    perform pg_temp.igual(v_st.commission_rate, null::numeric, 'sigue sin porcentaje');
    perform pg_temp.igual(v_st.repeat_every_days, 30, 'conserva volver cada');
    perform pg_temp.igual(v_st.at_customer_default, true, 'conserva a domicilio');
    perform pg_temp.igual((select es_servicio from products where id = v_st.product_id), false, 'conserva que no factura como servicio');
    perform pg_temp.igual((select price from products where id = v_st.product_id), 950::numeric, 'el precio sí cambia');

    v_st := taller_guardar_servicio(jsonb_build_object(
      'id', v_st.id, 'branch_id', '00000000-0000-0000-0000-00000000e7b1', 'name', 'Baño completo', 'price', 950,
      'commission_rate', 10, 'duration_min', null, 'es_servicio', true));
    perform pg_temp.igual(v_st.commission_rate, 10::numeric, 'pasa a porcentaje');
    perform pg_temp.igual(v_st.commission_amount, null::numeric, 'sin el monto fijo');
    perform pg_temp.igual(v_st.duration_min, null::integer, 'null borra la duración');
    perform pg_temp.igual(v_st.repeat_every_days, 30, 'volver cada sigue');
    perform pg_temp.igual((select es_servicio from products where id = v_st.product_id), true, 'ahora factura como servicio');
    reset role;
    insert into srv_resultado values ('K catálogo sin claves nuevas', null);
  exception when others then
    insert into srv_resultado values ('K catálogo sin claves nuevas', sqlerrm);
  end;
end $$;

-- L. Borrar una orden ENTREGADA (sin cobrar) con personas en sus líneas: el borrado
--    en cascada pasa por service_item_staff sin que el guard lo rechace. Quitar a la
--    persona a mano sigue sin poderse. (Borrar la empresa entera no se prueba aquí:
--    hoy falla antes, por service_items.product_id → products, que es anterior a
--    esta migración.)
do $$
begin
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into services (id, company_id, branch_id, description) values
      ('00000000-0000-0000-0000-00000000e79e', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Entregada para borrar');
    insert into service_items (id, service_id, product_id, quantity, price, kind) values
      ('00000000-0000-0000-0000-00000000e777', '00000000-0000-0000-0000-00000000e79e', '00000000-0000-0000-0000-00000000e701', 1, 0, 'labor');
    insert into service_item_staff (service_item_id, staff_id) values
      ('00000000-0000-0000-0000-00000000e777', '00000000-0000-0000-0000-00000000e7c5'),
      ('00000000-0000-0000-0000-00000000e777', '00000000-0000-0000-0000-00000000e7c1');
    perform taller_cambiar_estado('00000000-0000-0000-0000-00000000e79e', 'ready');
    perform taller_entregar('00000000-0000-0000-0000-00000000e79e');
    perform pg_temp.igual((select status from services where id = '00000000-0000-0000-0000-00000000e79e'), 'delivered', 'entregada');

    perform pg_temp.debe_fallar($q$delete from service_item_staff where service_item_id = '00000000-0000-0000-0000-00000000e777'$q$,
                                '%está cerrada%');
    perform pg_temp.igual((select count(*)::int from service_item_staff where service_item_id = '00000000-0000-0000-0000-00000000e777'), 2,
                          'siguen las dos personas');

    delete from services where id = '00000000-0000-0000-0000-00000000e79e';
    perform pg_temp.igual((select count(*)::int from services where id = '00000000-0000-0000-0000-00000000e79e'), 0, 'se borró la orden');
    perform pg_temp.igual((select count(*)::int from service_items where id = '00000000-0000-0000-0000-00000000e777'), 0, 'y su línea');
    perform pg_temp.igual((select count(*)::int from service_item_staff where service_item_id = '00000000-0000-0000-0000-00000000e777'), 0,
                          'y las personas de su línea');
    insert into srv_resultado values ('L borrado en cascada', null);
  exception when others then
    insert into srv_resultado values ('L borrado en cascada', sqlerrm);
  end;
end $$;

-- M. La garantía es solo de las órdenes de reparación. Una persona no se mueve a
--    otra línea con un UPDATE (se saltaría las reglas de la línea nueva).
do $$
begin
  begin
    perform pg_temp.como('00000000-0000-0000-0000-00000000e7f1');
    insert into taller_settings (company_id, branch_id, default_warranty_days) values
      ('00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 30)
      on conflict (branch_id) do update set default_warranty_days = 30;
    insert into services (id, company_id, branch_id, description, stays_in_shop, is_repair) values
      ('00000000-0000-0000-0000-00000000e79b', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Reparación con garantía', true, true),
      ('00000000-0000-0000-0000-00000000e79c', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Baño que se queda', true, false),
      ('00000000-0000-0000-0000-00000000e79d', '00000000-0000-0000-0000-00000000e7a0', '00000000-0000-0000-0000-00000000e7b1', 'Baño que no se queda', false, false);
    perform taller_cambiar_estado('00000000-0000-0000-0000-00000000e79b', 'ready');
    perform taller_entregar('00000000-0000-0000-0000-00000000e79b');
    perform taller_cambiar_estado('00000000-0000-0000-0000-00000000e79c', 'ready');
    perform taller_entregar('00000000-0000-0000-0000-00000000e79c');
    perform taller_entregar('00000000-0000-0000-0000-00000000e79d');
    perform pg_temp.igual((select warranty_until is not null from services where id = '00000000-0000-0000-0000-00000000e79b'), true, 'garantía de la reparación');
    perform pg_temp.igual((select warranty_until is null from services where id = '00000000-0000-0000-0000-00000000e79c'), true, 'sin garantía: se queda y no es de reparación');
    perform pg_temp.igual((select warranty_until is null from services where id = '00000000-0000-0000-0000-00000000e79d'), true, 'sin garantía: no se queda');

    set local role authenticated;
    insert into services (id, branch_id, description) values
      ('00000000-0000-0000-0000-00000000e79f', '00000000-0000-0000-0000-00000000e7b1', 'Dos líneas');
    insert into service_items (id, service_id, product_id, quantity, price, kind) values
      ('00000000-0000-0000-0000-00000000e775', '00000000-0000-0000-0000-00000000e79f', '00000000-0000-0000-0000-00000000e701', 1, 500, 'labor'),
      ('00000000-0000-0000-0000-00000000e776', '00000000-0000-0000-0000-00000000e79f', '00000000-0000-0000-0000-00000000e701', 1, 500, 'labor');
    insert into service_item_staff (id, service_item_id, staff_id) values
      ('00000000-0000-0000-0000-00000000e7a7', '00000000-0000-0000-0000-00000000e775', '00000000-0000-0000-0000-00000000e7c5');
    perform pg_temp.debe_fallar($q$update service_item_staff set service_item_id = '00000000-0000-0000-0000-00000000e776'
      where id = '00000000-0000-0000-0000-00000000e7a7'$q$, '%Para cambiar la línea, quita a la persona y agrégala en la otra.%');
    perform pg_temp.igual((select service_item_id from service_item_staff where id = '00000000-0000-0000-0000-00000000e7a7'),
                          '00000000-0000-0000-0000-00000000e775'::uuid, 'sigue en su línea');
    reset role;
    insert into srv_resultado values ('M garantía y mover de línea', null);
  exception when others then
    insert into srv_resultado values ('M garantía y mover de línea', sqlerrm);
  end;
end $$;

do $$
declare f text;
begin
  select string_agg(caso || ': ' || error, ' | ' order by caso) into f from srv_resultado where error is not null;
  if f is not null then raise exception 'FALLAN: %', f; end if;
  if (select count(*) from srv_resultado) <> 14 then
    raise exception 'corrieron % casos de 14', (select count(*) from srv_resultado);
  end if;
end $$;

select caso, 'ok' as resultado from srv_resultado order by caso;
