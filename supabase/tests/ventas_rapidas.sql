-- Pruebas de Ventas Rápidas. NO es una migración: se corre contra producción
-- dentro de una transacción que se revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261016200000_ventas_rapidas.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`; si una aserción falla, la llamada
-- devuelve el error con su mensaje. Antes de que exista la migración se corre
-- solo `begin; <este archivo> rollback;` para ver las pruebas en rojo. Cada
-- sección deja explícito el estado que necesita (rol, claims), usa UUID fijos
-- (…d1XX) en la empresa demo y no depende de las demás.
--
-- OJO: las comprobaciones "no hay líneas is_quick" y "ningún rol que vende sin
-- quick-sales" (Task 1) dependen del estado de producción y solo valen ANTES de
-- salir en vivo: fallarán cuando existan ventas rápidas reales o cuando un admin
-- vacíe ese permiso en un rol.

select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);

-- Comprueba que una sentencia falla con el mensaje esperado (sus efectos se
-- revierten con el subbloque).
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

-- Cambia el usuario de las llamadas siguientes.
create function pg_temp.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- cc56c633… pasa a ser Cajero de la demo en la sucursal b1 (idempotente).
-- Se llama con los claims del super admin; si un trigger lo impide, ajustar según
-- la memoria `sellalles-verificacion-y-datos-demo` ("Usuarios para probar permisos").
-- Los `insert` llevan `where not exists` y no `on conflict do nothing`: el trigger
-- BEFORE INSERT del límite de usuarios de la empresa corre antes de que se
-- evalúe el conflicto, así que la segunda llamada fallaba con "Límite de
-- usuarios alcanzado" (la demo tiene max_users = 2).
create function pg_temp.preparar_cajero() returns void language sql as $$
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
$$;

-- == Task 1: esquema y permisos ==
do $$
begin
  assert (select is_nullable = 'NO' and column_default = 'false'
            from information_schema.columns
           where table_schema = 'public' and table_name = 'sale_items' and column_name = 'is_quick'),
         'sale_items.is_quick falta o admite nulo';
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'quote_items' and column_name = 'is_quick'),
         'quote_items.is_quick falta';
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'quote_items' and column_name = 'cost'),
         'quote_items.cost falta';
  assert not exists (select 1 from sale_items where is_quick), 'el backfill marcó líneas viejas como rápidas';

  assert not exists (select 1 from roles
                      where coalesce(permissions -> 'pos', '[]') ? 'create'
                        and not coalesce(permissions -> 'quick-sales', '[]') ? 'create'),
         'hay roles que venden sin quick-sales';

  assert pg_get_functiondef('public.seed_system_roles'::regproc) like '%"quick-sales": ["create"]%'
      or pg_get_functiondef('public.seed_system_roles'::regproc) like '%"quick-sales":["create"]%',
         'seed_system_roles no siembra quick-sales';

  assert not has_function_privilege('anon', 'public.puede_vender_rapido(uuid)', 'execute'), 'anon puede ejecutar puede_vender_rapido';
  assert puede_vender_rapido('00000000-0000-0000-0000-0000000000b1'), 'el admin de la demo no puede vender rápido';
end $$;

-- Cajero de la demo: con el rol sembrado, puede; sin quick-sales en el rol, no.
select pg_temp.preparar_cajero();
update roles set permissions = permissions || '{"quick-sales": ["create"]}'
 where id = 'd7bb7626-3aa0-4f4b-9b1b-eb61264a4b04';
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
do $$ begin
  assert puede_vender_rapido('00000000-0000-0000-0000-0000000000b1'), 'el cajero con el rol sembrado no puede';
end $$;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
update roles set permissions = permissions - 'quick-sales' where id = 'd7bb7626-3aa0-4f4b-9b1b-eb61264a4b04';
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
do $$ begin
  assert not puede_vender_rapido('00000000-0000-0000-0000-0000000000b1'), 'el cajero sin quick-sales sí puede';
end $$;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

-- == Task 2: create_sale_with_items y artículos rápidos recientes ==
-- Estado explícito de la sección: super admin de la demo, sin filas de
-- company_modules para quick-sales (el módulo cuenta como activo por omisión).
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
delete from company_modules
 where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'quick-sales';

-- Venta pagada por transferencia (el efectivo lo bloquea la caja de la demo).
create function pg_temp.vender(p_items jsonb) returns uuid language sql as $$
  select (create_sale_with_items(jsonb_build_object(
    'branch_id', '00000000-0000-0000-0000-0000000000b1', 'subtotal', 100, 'itbis_amount', 0,
    'total', 100, 'payment_method', 'transfer', 'payment_status', 'paid',
    'amount_paid', 100, 'ncf_type', 'consumer'), p_items)).id
$$;

insert into products (id, company_id, branch_id, name, price, cost, stock, tracks_stock)
values ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-0000000000aa',
        '00000000-0000-0000-0000-0000000000b1', 'Prueba rápida producto', 100, 40, 5, true);

-- Caso 0: la función sigue siendo SECURITY INVOKER (la RLS de sales/sale_items la protege).
do $t$ begin
  assert not (select prosecdef from pg_proc where oid = 'public.create_sale_with_items(jsonb,jsonb)'::regprocedure),
         'caso 0: create_sale_with_items dejó de ser security invoker';
end $t$;

-- Caso 1: línea rápida con costo; no toca stock ni producto.
do $t$
declare v_sale uuid;
begin
  v_sale := pg_temp.vender('[{"product_name":"Cable USB","quantity":2,"price":150,"itbis":true,"is_quick":true,"cost":60}]');
  assert (select is_quick from sale_items where sale_id = v_sale), 'caso 1: la línea no quedó marcada is_quick';
  assert (select product_id is null from sale_items where sale_id = v_sale), 'caso 1: la línea rápida trae product_id';
  assert (select cost = 60 from sale_items where sale_id = v_sale), 'caso 1: el costo no es el del cajero';
  assert (select stock = 5 from products where id = '00000000-0000-0000-0000-00000000d101'), 'caso 1: se movió el stock';
end $t$;

-- Caso 2: línea rápida sin costo → costo nulo.
do $t$
declare v_sale uuid;
begin
  v_sale := pg_temp.vender('[{"product_name":"Cable USB","quantity":2,"price":150,"itbis":true,"is_quick":true}]');
  assert (select is_quick from sale_items where sale_id = v_sale), 'caso 2: la línea no quedó marcada is_quick';
  assert (select cost is null from sale_items where sale_id = v_sale), 'caso 2: el costo debía quedar nulo';
end $t$;

-- Casos 3 y 9: venta mixta (producto + rápido) y su anulación.
do $t$
declare v_sale uuid;
begin
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000d101","product_name":"Prueba rápida producto","quantity":1,"price":100,"itbis":false,"cost":1},{"product_name":"Varios","quantity":1,"price":100,"itbis":false,"is_quick":true}]');
  assert (select stock = 4 from products where id = '00000000-0000-0000-0000-00000000d101'),
         'caso 3: el stock del producto debía bajar a 4';
  assert (select cost = 40 from sale_items
           where sale_id = v_sale and product_id = '00000000-0000-0000-0000-00000000d101'),
         'caso 3: el costo del producto debía ser el del catálogo (40), no el del payload';
  assert (select not is_quick from sale_items
           where sale_id = v_sale and product_id = '00000000-0000-0000-0000-00000000d101'),
         'caso 3: la línea del producto quedó marcada is_quick';
  assert (select is_quick and product_id is null from sale_items
           where sale_id = v_sale and product_name = 'Varios'),
         'caso 3: la línea rápida debía quedar is_quick y sin producto';

  perform annul_sale(v_sale, 'prueba', 'transfer');
  assert (select stock = 5 from products where id = '00000000-0000-0000-0000-00000000d101'),
         'caso 9: anular la venta mixta debía devolver el stock a 5';
end $t$;

-- Caso 4: módulo apagado en la empresa → rechaza los rápidos, deja pasar el resto.
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'quick-sales', false);
do $t$
declare v_sale uuid;
begin
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_name":"Cable USB","quantity":2,"price":150,"itbis":true,"is_quick":true,"cost":60}]')$j$,
    '%desactivadas para esta empresa%');
  v_sale := pg_temp.vender('[{"product_name":"Cable USB","quantity":2,"price":150,"itbis":true,"cost":60}]');
  assert v_sale is not null, 'caso 4: la venta sin rápidos debía pasar con el módulo apagado';
  assert (select not is_quick from sale_items where sale_id = v_sale), 'caso 4: la línea sin marca quedó is_quick';
end $t$;
delete from company_modules
 where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'quick-sales';

-- Caso 5: el permiso del rol en la sucursal (con y sin quick-sales).
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
select pg_temp.preparar_cajero();
update roles set permissions = permissions || '{"quick-sales": ["create"]}'
 where id = 'd7bb7626-3aa0-4f4b-9b1b-eb61264a4b04';
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
do $t$ begin
  assert pg_temp.vender('[{"product_name":"Cable USB","quantity":1,"price":150,"is_quick":true}]') is not null,
         'caso 5: el cajero con quick-sales debía poder vender rápido';
end $t$;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
update roles set permissions = permissions - 'quick-sales'
 where id = 'd7bb7626-3aa0-4f4b-9b1b-eb61264a4b04';
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
do $t$ begin
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_name":"Cable USB","quantity":1,"price":150,"is_quick":true}]')$j$,
    '%Tu rol no permite ventas rápidas%');
end $t$;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

-- Casos 6, 7 y 8: validación de la línea rápida (en el orden en que la función la hace).
do $t$ begin
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000d101","product_name":"Cable USB","quantity":1,"price":150,"is_quick":true}]')$j$,
    '%no puede llevar producto%');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000d101","product_name":"   ","quantity":0,"price":-1,"is_quick":true}]')$j$,
    '%no puede llevar producto%');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_name":"   ","quantity":1,"price":150,"is_quick":true}]')$j$,
    '%Escribe la descripción%');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_name":"Cable USB","quantity":1,"price":-1,"is_quick":true}]')$j$,
    '%precio del artículo rápido no puede ser negativo%');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_name":"Cable USB","quantity":0,"price":150,"is_quick":true}]')$j$,
    '%mayor que cero%');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_name":"Cable USB","quantity":1,"price":150,"is_quick":true,"cost":-1}]')$j$,
    '%costo del artículo rápido%');
  assert (select stock = 5 from products where id = '00000000-0000-0000-0000-00000000d101'),
         'casos 6-8: los rechazos movieron el stock';
end $t$;

-- Caso 10: recientes por nombre normalizado, sin anuladas ni fuera de ventana.
-- Todas las ventas de la prueba comparten created_at (now() de la transacción):
-- se retrasan las anteriores y se fija a mano el orden de las de este caso.
update sales set created_at = now() - interval '3 days'
 where branch_id = '00000000-0000-0000-0000-0000000000b1' and created_at = now();
do $t$
declare
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_row record;
begin
  v_a := pg_temp.vender('[{"product_name":"Cable USB","quantity":1,"price":150,"itbis":true,"is_quick":true,"cost":60}]');
  update sales set created_at = now() - interval '2 hours' where id = v_a;
  v_b := pg_temp.vender('[{"product_name":" cable  usb ","quantity":1,"price":175,"itbis":true,"is_quick":true}]');
  update sales set created_at = now() - interval '1 hour' where id = v_b;
  v_c := pg_temp.vender('[{"product_name":"Mouse","quantity":1,"price":90,"is_quick":true}]');
  perform annul_sale(v_c, 'prueba', 'transfer');
  v_d := pg_temp.vender('[{"product_name":"Antiguo","quantity":1,"price":10,"is_quick":true}]');
  update sales set created_at = now() - interval '100 days' where id = v_d;
  v_e := pg_temp.vender('[{"product_name":"Varios","quantity":1,"price":40,"is_quick":true}]');

  assert (select product_name = 'cable  usb' from sale_items where sale_id = v_b),
         'caso 10: la descripción de la línea rápida debía guardarse sin espacios de borde';

  assert (select count(*) from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1') r
           where lower(regexp_replace(r.name, '\s+', ' ', 'g')) = 'cable usb') = 1,
         'caso 10: cable usb debía salir una sola vez';
  select * into v_row from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1') r
   where lower(regexp_replace(r.name, '\s+', ' ', 'g')) = 'cable usb';
  assert v_row.price = 175, 'caso 10: debía quedar el precio de la venta más reciente (175)';
  assert v_row.cost is null, 'caso 10: el costo debía ser el de la venta más reciente (nulo)';
  assert v_row.itbis, 'caso 10: itbis debía venir de la venta más reciente';
  assert v_row.name = btrim(v_row.name), 'caso 10: el nombre trae espacios de borde';
  assert v_row.last_sold_at = (select created_at from sales where id = v_b),
         'caso 10: last_sold_at debía ser el de la venta más reciente';

  assert not exists (select 1 from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1') r
                      where lower(r.name) = 'mouse'),
         'caso 10: una venta anulada salió en los recientes';
  assert not exists (select 1 from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1') r
                      where lower(r.name) = 'antiguo'),
         'caso 10: una venta de hace más de 90 días salió en los recientes';
  assert (select name from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1') limit 1) = 'Varios',
         'caso 10: debían venir ordenados por last_sold_at desc (Varios primero)';

  assert (select count(*) from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1')) = 2,
         'caso 10: por omisión debían salir los 2 artículos distintos (cable usb y Varios)';
  assert (select count(*) from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1', 1)) = 1,
         'caso 10: p_limit = 1 debía devolver una fila';
  assert (select count(*) from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1', 0)) = 1,
         'caso 10: p_limit = 0 debía subir a 1';
  assert (select count(*) from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1', null)) = 2,
         'caso 10: p_limit nulo debía usar 20';
  assert not exists (select 1 from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000c9')),
         'caso 10: otra sucursal no debía ver estos artículos';
end $t$;

-- Caso 11: la función nueva no es ejecutable por anon, y es invoker/stable.
do $t$ begin
  assert not has_function_privilege('anon', 'public.articulos_rapidos_recientes(uuid,integer)', 'execute'),
         'caso 11: anon puede ejecutar articulos_rapidos_recientes';
  assert has_function_privilege('authenticated', 'public.articulos_rapidos_recientes(uuid,integer)', 'execute'),
         'caso 11: authenticated no puede ejecutar articulos_rapidos_recientes';
  assert (select not prosecdef and provolatile = 's' from pg_proc
           where oid = 'public.articulos_rapidos_recientes(uuid,integer)'::regprocedure),
         'caso 11: articulos_rapidos_recientes debía ser security invoker y stable';
end $t$;

-- Caso 12: desempate de los recientes. Cambiar el precio de una línea rápida con
-- cantidad > 1 la parte en dos líneas con la misma descripción y el mismo
-- created_at (el de la venta). Debe ganar siempre la que NO tiene custom_price,
-- sea cual sea el orden en que se guardaron: se prueba con las dos órdenes.
-- Los id de las ventas y de sus líneas los genera la base; los nombres propios del
-- caso ("Combo desempate A/B") lo aíslan de los demás.
do $t$
declare
  v_a uuid; v_b uuid; v_row record;
begin
  -- A: primero la línea con custom_price, después la normal.
  v_a := pg_temp.vender('[{"product_name":"Combo desempate A","quantity":1,"price":100,"custom_price":130,"is_quick":true,"cost":70},{"product_name":" combo  desempate a ","quantity":1,"price":100,"is_quick":true,"cost":50}]');
  -- B: primero la línea normal, después la que lleva custom_price.
  v_b := pg_temp.vender('[{"product_name":"Combo desempate B","quantity":1,"price":100,"is_quick":true,"cost":50},{"product_name":" combo  desempate b ","quantity":1,"price":100,"custom_price":130,"is_quick":true,"cost":70}]');

  assert (select count(*) from sale_items where sale_id in (v_a, v_b) and is_quick) = 4,
         'caso 12: las dos ventas debían tener dos líneas rápidas cada una';
  assert (select count(distinct s.created_at) from sales s where s.id in (v_a, v_b)) = 1
     and (select count(*) from sale_items where sale_id = v_a and custom_price is not null) = 1
     and (select count(*) from sale_items where sale_id = v_b and custom_price is not null) = 1,
         'caso 12: el escenario debía tener un empate en created_at y una sola línea con custom_price por venta';

  select * into v_row from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1') r
   where lower(regexp_replace(r.name, '\s+', ' ', 'g')) = 'combo desempate a';
  assert v_row.price = 100 and v_row.cost = 50,
         'caso 12 (A): debía ganar la línea sin custom_price (precio 100, costo 50); salió '
         || coalesce(v_row.price::text, 'nada') || ' / ' || coalesce(v_row.cost::text, 'nulo');

  select * into v_row from articulos_rapidos_recientes('00000000-0000-0000-0000-0000000000b1') r
   where lower(regexp_replace(r.name, '\s+', ' ', 'g')) = 'combo desempate b';
  assert v_row.price = 100 and v_row.cost = 50,
         'caso 12 (B): debía ganar la línea sin custom_price (precio 100, costo 50); salió '
         || coalesce(v_row.price::text, 'nada') || ' / ' || coalesce(v_row.cost::text, 'nulo');
end $t$;

select 'ok' as resultado;
