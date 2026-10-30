-- Pruebas de Presentaciones de producto. NO es una migración: se corre contra
-- producción dentro de una transacción que se revierte, después del SQL de la
-- migración:
--
--   begin; <supabase/migrations/20261029120000_presentaciones.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`; si una aserción falla, la llamada
-- devuelve el error con su mensaje. Antes de que exista la parte de la
-- migración que se prueba se corre solo `begin; <este archivo> rollback;` para
-- ver las pruebas en rojo. Cada sección deja explícito el estado que necesita
-- (rol, claims), usa UUID fijos (…e1XX) en la empresa demo y no depende de las
-- demás. Cada tarea de base amplía este archivo con su propia sección.
--
-- Las pruebas corren como `postgres` (que se salta la RLS); la sección de RLS
-- cambia a `authenticated` con `set local role` para probar la política.

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
-- Se llama con los claims del super admin. Los `insert` llevan `where not
-- exists` y no `on conflict do nothing`: el trigger BEFORE INSERT del límite de
-- usuarios de la empresa corre antes de que se evalúe el conflicto.
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

-- UUID del producto de prueba 00000000-0000-0000-0000-00000000e<n> (n = 101…).
create function pg_temp.prod(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000000e' || n)::uuid
$$;

-- Envoltorios (plpgsql: el cuerpo no se valida hasta que se ejecuta, así que
-- se pueden crear antes de que exista la migración).
create function pg_temp.guardar(p_product uuid, p_suelto boolean, p_items text) returns integer
language plpgsql as $$
begin
  return (select count(*)::integer from save_product_presentations(p_product, p_suelto, p_items::jsonb));
end $$;

create function pg_temp.importar(p_rows text) returns integer
language plpgsql as $$
begin
  return import_product_presentations(p_rows::jsonb);
end $$;

-- == Task 1: esquema, validación y guardado ==
-- Estado explícito de la sección: super admin de la demo (arriba). Fixtures en
-- la sucursal Principal (b1): e101 "Galletas Prueba" (und, código E101),
-- e102 "Arroz Prueba" (lb), e103 "Otro Prueba" (código E103), e105 sin
-- presentaciones; en la sucursal Prueba: e104 "Galletas Prueba" sin código.
insert into products (id, company_id, branch_id, name, code, unit, stock, cost, price, tracks_stock) values
  (pg_temp.prod(101), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Galletas Prueba', 'E101', 'und', 1250, 10, 15, true),
  (pg_temp.prod(102), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Arroz Prueba', null, 'lb', 500, 20, 30, true),
  (pg_temp.prod(103), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Otro Prueba', 'E103', 'und', 10, 5, 8, true),
  (pg_temp.prod(104), '00000000-0000-0000-0000-0000000000aa', '169fe6bb-91fa-4633-8e43-5a45e410e2b0',
   'Galletas Prueba', null, 'und', 0, 10, 15, true),
  (pg_temp.prod(105), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Sin Presentaciones Prueba', null, 'und', 5, 5, 8, true);

-- Esquema: tabla, RLS, índices, columnas, claves foráneas y permisos.
do $t$
begin
  assert to_regclass('public.product_presentations') is not null,
         'esquema: falta la tabla product_presentations';
  assert (select relrowsecurity from pg_class where oid = 'public.product_presentations'::regclass),
         'esquema: product_presentations sin RLS';

  -- La política dice lo mismo que products_all (qual y with_check), con cada llamada
  -- a función envuelta en (select …) como sale_items_all, para que Postgres la evalúe
  -- una vez por consulta y no una vez por fila. Se comparan quitando los envoltorios
  -- `( SELECT f() AS f)` de los dos lados (misma expresión) y después se comprueba
  -- que no quede ninguna llamada sin envolver.
  assert exists (select 1 from pg_policies pr, pg_policies p
                  where pr.schemaname = 'public' and pr.tablename = 'product_presentations'
                    and pr.policyname = 'product_presentations_all' and pr.cmd = 'ALL'
                    and p.schemaname = 'public' and p.tablename = 'products' and p.policyname = 'products_all'
                    and regexp_replace(pr.qual, '\( SELECT (\w+\(\)) AS \w+\)', '\1', 'g')
                        = regexp_replace(p.qual, '\( SELECT (\w+\(\)) AS \w+\)', '\1', 'g')
                    and regexp_replace(pr.with_check, '\( SELECT (\w+\(\)) AS \w+\)', '\1', 'g')
                        = regexp_replace(p.with_check, '\( SELECT (\w+\(\)) AS \w+\)', '\1', 'g')
                    and pr.roles = p.roles),
         'esquema: product_presentations_all no dice lo mismo que products_all';
  assert (select regexp_replace(qual || ' ' || with_check, '\( SELECT \w+\(\) AS \w+\)', '', 'g')
                 !~ '(current_company_id|is_company_admin|is_super_admin|user_branch_ids)\(\)'
            from pg_policies
           where schemaname = 'public' and tablename = 'product_presentations'
             and policyname = 'product_presentations_all'),
         'esquema: product_presentations_all llama una función sin envolverla en (select …)';

  -- Única clave foránea: a products (cascade). Ninguna a companies ni branches.
  assert (select count(*) from pg_constraint
           where conrelid = 'public.product_presentations'::regclass and contype = 'f') = 1,
         'esquema: product_presentations debe tener una sola clave foránea';
  assert (select confdeltype from pg_constraint
           where conrelid = 'public.product_presentations'::regclass and contype = 'f'
             and confrelid = 'public.products'::regclass) = 'c',
         'esquema: la FK a products debe ser on delete cascade';

  assert exists (select 1 from pg_indexes
                  where schemaname = 'public' and tablename = 'product_presentations'
                    and indexdef like 'CREATE UNIQUE INDEX%(product_id, lower(btrim(name)))%'),
         'esquema: falta el índice único (product_id, lower(btrim(name)))';
  assert exists (select 1 from pg_indexes
                  where schemaname = 'public' and tablename = 'product_presentations'
                    and indexdef like '%(branch_id, lower(btrim(code)))%'),
         'esquema: falta el índice (branch_id, lower(btrim(code)))';

  assert (select data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'
            from information_schema.columns
           where table_schema = 'public' and table_name = 'products' and column_name = 'sold_loose'),
         'esquema: products.sold_loose falta o no es boolean not null default true';

  assert (select count(*) from information_schema.columns
           where table_schema = 'public'
             and table_name in ('sale_items', 'quote_items', 'supplier_invoice_items')
             and ((column_name = 'presentation_id' and data_type = 'uuid' and is_nullable = 'YES')
               or (column_name = 'presentation_name' and data_type = 'text' and is_nullable = 'YES')
               or (column_name = 'units_per' and data_type = 'numeric' and numeric_precision = 12
                   and numeric_scale = 3 and is_nullable = 'NO' and column_default = '1'))) = 9,
         'esquema: faltan columnas de presentación en sale_items / quote_items / supplier_invoice_items';
  assert (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'product_transfers'
             and ((column_name = 'presentation_name' and data_type = 'text' and is_nullable = 'YES')
               or (column_name = 'units_per' and data_type = 'numeric' and numeric_precision = 12
                   and numeric_scale = 3 and is_nullable = 'NO' and column_default = '1'))) = 2,
         'esquema: faltan columnas de presentación en product_transfers';
  assert (select count(*) from pg_constraint
           where contype = 'c'
             and conrelid in ('public.sale_items'::regclass, 'public.quote_items'::regclass,
                              'public.supplier_invoice_items'::regclass, 'public.product_transfers'::regclass)
             and pg_get_constraintdef(oid) ~ 'units_per > \(?0') = 4,
         'esquema: falta el check units_per > 0 en alguna de las cuatro tablas';
  assert (select count(*) from pg_constraint
           where contype = 'f' and confrelid = 'public.product_presentations'::regclass
             and confdeltype = 'n'
             and conrelid in ('public.sale_items'::regclass, 'public.quote_items'::regclass,
                              'public.supplier_invoice_items'::regclass)) = 3,
         'esquema: presentation_id debe ser FK on delete set null en las tres tablas de líneas';

  assert exists (select 1 from pg_trigger
                  where tgrelid = 'public.product_presentations'::regclass
                    and tgname = 'product_presentations_before_write' and not tgisinternal),
         'esquema: falta el trigger product_presentations_before_write';

  -- Las RPCs son security invoker (la RLS las protege) y fijan el search_path.
  assert not (select prosecdef from pg_proc
               where oid = 'public.save_product_presentations(uuid,boolean,jsonb)'::regprocedure),
         'esquema: save_product_presentations dejó de ser security invoker';
  assert not (select prosecdef from pg_proc
               where oid = 'public.import_product_presentations(jsonb)'::regprocedure),
         'esquema: import_product_presentations dejó de ser security invoker';
  assert (select 'search_path=public' = any (coalesce(proconfig, '{}'))
            from pg_proc where oid = 'public.save_product_presentations(uuid,boolean,jsonb)'::regprocedure),
         'esquema: save_product_presentations sin search_path';
  assert (select 'search_path=public' = any (coalesce(proconfig, '{}'))
            from pg_proc where oid = 'public.import_product_presentations(jsonb)'::regprocedure),
         'esquema: import_product_presentations sin search_path';

  -- Permisos.
  assert not has_table_privilege('anon', 'public.product_presentations', 'select'),
         'permisos: anon puede leer product_presentations';
  assert not has_table_privilege('anon', 'public.product_presentations', 'insert'),
         'permisos: anon puede insertar en product_presentations';
  assert not has_function_privilege('anon', 'public.save_product_presentations(uuid,boolean,jsonb)', 'execute'),
         'permisos: anon puede ejecutar save_product_presentations';
  assert not has_function_privilege('anon', 'public.import_product_presentations(jsonb)', 'execute'),
         'permisos: anon puede ejecutar import_product_presentations';
  assert has_function_privilege('authenticated', 'public.save_product_presentations(uuid,boolean,jsonb)', 'execute'),
         'permisos: authenticated no puede ejecutar save_product_presentations';
  assert has_function_privilege('authenticated', 'public.import_product_presentations(jsonb)', 'execute'),
         'permisos: authenticated no puede ejecutar import_product_presentations';
end $t$;

-- Guardar dos presentaciones; la sucursal y la empresa las copia el trigger.
do $t$
declare v_n integer;
begin
  select count(*) into v_n from save_product_presentations(pg_temp.prod(101), true,
    '[{"name":"Paquete","units":12,"price":160,"code":"E101-12"},
      {"name":"Caja","units":288,"price":3600,"code":"E101-288"}]');
  assert v_n = 2, 'guardar: debía devolver las dos presentaciones; devolvió ' || v_n;
  assert (select branch_id from product_presentations where code = 'E101-12') = '00000000-0000-0000-0000-0000000000b1',
         'guardar: branch_id debía copiarse del producto';
  assert (select company_id from product_presentations where code = 'E101-288') = '00000000-0000-0000-0000-0000000000aa',
         'guardar: company_id debía copiarse del producto';
  assert (select units = 288 and price = 3600 and name = 'Caja' from product_presentations where code = 'E101-288'),
         'guardar: la Caja no quedó con sus datos';
  assert (select sold_loose from products where id = pg_temp.prod(101)), 'guardar: sold_loose debía seguir en true';
end $t$;

-- Editar conserva el id; lo que falta del envío se borra.
do $t$
declare v_paq uuid;
begin
  select id into v_paq from product_presentations where product_id = pg_temp.prod(101) and code = 'E101-12';
  assert v_paq is not null, 'editar: no se encontró el Paquete';
  perform pg_temp.guardar(pg_temp.prod(101), true,
    jsonb_build_array(jsonb_build_object('id', v_paq, 'name', 'Paquete', 'units', 12, 'price', 150, 'code', 'E101-12'))::text);
  assert (select price from product_presentations where id = v_paq) = 150, 'editar: el precio no cambió a 150';
  assert (select count(*) from product_presentations where product_id = pg_temp.prod(101)) = 1,
         'editar: la Caja debía borrarse por no venir en el envío';
  assert not exists (select 1 from product_presentations where code = 'E101-288'), 'editar: la Caja sigue ahí';
end $t$;

-- Reusar el nombre de una presentación que se está quitando no choca consigo
-- misma: se borra primero lo que falta y luego se actualiza e inserta.
do $t$
declare v_vieja uuid; v_nueva uuid;
begin
  select id into v_vieja from product_presentations where product_id = pg_temp.prod(101) and code = 'E101-12';
  perform pg_temp.guardar(pg_temp.prod(101), true,
    '[{"name":"Paquete","units":12,"price":150,"code":"E101-12"}]');
  select id into v_nueva from product_presentations where product_id = pg_temp.prod(101) and code = 'E101-12';
  assert v_nueva is not null and v_nueva <> v_vieja,
         'reuso: el Paquete sin id debía reemplazar al anterior (borrar primero, insertar después)';
  assert (select count(*) from product_presentations where product_id = pg_temp.prod(101)) = 1,
         'reuso: debía quedar una sola presentación';
end $t$;

-- Rechazos (cada uno revierte lo que hiciera antes de fallar).
do $t$
begin
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Uno","units":1,"price":10}]')$j$,
    'Una presentación tiene que traer más de una unidad.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Medio","units":0.5,"price":10}]')$j$,
    'Una presentación tiene que traer más de una unidad.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Sin unidades","price":10}]')$j$,
    'Una presentación tiene que traer más de una unidad.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Rara","units":12.5,"price":10}]')$j$,
    '«Galletas Prueba» se cuenta por piezas: la presentación tiene que traer una cantidad entera.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Barata","units":6,"price":-1}]')$j$,
    'El precio de la presentación no puede ser negativo.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"  ","units":6,"price":10}]')$j$,
    'La presentación necesita un nombre.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true,
         '[{"name":"Paquete","units":12,"price":160},{"name":"paquete ","units":24,"price":300}]')$j$,
    'Ya hay una presentación llamada «paquete» en este producto.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Paquete","units":12,"price":160,"code":"E103"}]')$j$,
    'El código «E103» ya lo usa «Otro Prueba» en esta sucursal.');
  -- Sin distinguir mayúsculas ni espacios.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Paquete","units":12,"price":160,"code":" e103 "}]')$j$,
    'El código «e103» ya lo usa «Otro Prueba» en esta sucursal.');
  -- Código del propio producto repetido en dos de sus presentaciones.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true,
         '[{"name":"Paquete","units":12,"price":160,"code":"X-1"},{"name":"Caja","units":288,"price":3600,"code":"x-1"}]')$j$,
    'El código «x-1» ya lo usa «Galletas Prueba» en esta sucursal.');
  -- Ni siquiera el código del propio producto (e101 tiene "E101"): el escaneo no
  -- sabría si es la unidad suelta o la presentación.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Paquete","units":12,"price":160,"code":"e101"}]')$j$,
    'El código «e101» ya lo usa «Galletas Prueba» en esta sucursal.');
  -- Si no se vende suelto, hace falta al menos una presentación.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), false, '[]')$j$,
    'Si «Galletas Prueba» no se vende suelto, necesita al menos una presentación.');
  -- Una presentación de otro producto no se puede reclamar por id.
  perform pg_temp.debe_fallar(
    format($j$select pg_temp.guardar(pg_temp.prod(103), true,
              jsonb_build_array(jsonb_build_object('id', %L, 'name', 'Robada', 'units', 6, 'price', 10))::text)$j$,
           (select id from product_presentations where product_id = pg_temp.prod(101) limit 1)),
    'La presentación no corresponde a este producto.');
  -- El producto tiene que existir.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar('00000000-0000-0000-0000-00000000e1ff', true, '[]')$j$,
    'El producto no existe o no tienes acceso a él.');
  -- Un fallo no deja nada a medias: las presentaciones de e101 siguen como estaban.
  assert (select count(*) from product_presentations where product_id = pg_temp.prod(101)) = 1
     and exists (select 1 from product_presentations where product_id = pg_temp.prod(101) and code = 'E101-12'),
         'rechazos: un envío fallido modificó las presentaciones';
end $t$;

-- El código de una presentación ajena (de otro producto) también choca.
do $t$
begin
  perform pg_temp.guardar(pg_temp.prod(103), true, '[{"name":"Bolsa","units":6,"price":40,"code":"E103-6"}]');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Paquete","units":12,"price":150,"code":"e103-6"}]')$j$,
    'El código «e103-6» ya lo usa «Otro Prueba» en esta sucursal.');
end $t$;

-- El código de un producto archivado no cuenta; el de uno activo sí.
do $t$
begin
  update products set is_active = false where id = pg_temp.prod(103);
  perform pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Paquete","units":12,"price":160,"code":"E103"}]');
  assert exists (select 1 from product_presentations where product_id = pg_temp.prod(101) and code = 'E103'),
         'archivado: el código de un producto archivado debía quedar libre';
  update products set is_active = true where id = pg_temp.prod(103);
  perform pg_temp.guardar(pg_temp.prod(101), true, '[{"name":"Paquete","units":12,"price":150,"code":"E101-12"}]');
end $t$;

-- Aceptados: unidad medible con fracción, otra sucursal con el mismo código.
do $t$
begin
  perform pg_temp.guardar(pg_temp.prod(102), true, '[{"name":"Saco","units":125.5,"price":3500}]');
  assert (select units from product_presentations where product_id = pg_temp.prod(102)) = 125.5,
         'medible: e102 (lb) debía admitir 125.5';

  perform pg_temp.guardar(pg_temp.prod(104), true, '[{"name":"Paquete","units":12,"price":160,"code":"E101-12"}]');
  assert (select branch_id from product_presentations where product_id = pg_temp.prod(104))
         = '169fe6bb-91fa-4633-8e43-5a45e410e2b0',
         'otra sucursal: la presentación de e104 debía quedar en la sucursal Prueba';
  assert (select count(*) from product_presentations where code = 'E101-12') = 2,
         'otra sucursal: el mismo código debía poder existir en dos sucursales';
end $t$;

-- Nombre y código se recortan; un código en blanco queda nulo.
do $t$
begin
  perform pg_temp.guardar(pg_temp.prod(103), true, '[{"name":"  Docena ","units":12,"price":100,"code":"   "}]');
  assert (select name = 'Docena' and code is null from product_presentations
           where product_id = pg_temp.prod(103)),
         'recorte: el nombre debía quedar sin espacios y el código en blanco, nulo';
end $t$;

-- Se puede dejar de vender suelto cuando hay presentaciones.
do $t$
begin
  perform pg_temp.guardar(pg_temp.prod(101), false, '[{"name":"Paquete","units":12,"price":150,"code":"E101-12"}]');
  assert not (select sold_loose from products where id = pg_temp.prod(101)),
         'suelto: save(e101, false, [Paquete]) debía apagar sold_loose';
end $t$;

-- Importar: empareja sin mayúsculas, inserta lo nuevo, no borra nada.
do $t$
declare v_paq uuid; v_n integer;
begin
  select id into v_paq from product_presentations where product_id = pg_temp.prod(101) and code = 'E101-12';
  v_n := pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e101","sold_loose":true,
      "presentations":[{"name":"PAQUETE","units":12,"price":155},{"name":"Fardo","units":144,"price":1800}]}]');
  assert v_n = 2, 'importar: debía devolver 2; devolvió ' || v_n;
  assert (select price from product_presentations where id = v_paq) = 155, 'importar: el Paquete debía quedar en 155 (mismo id)';
  assert (select name from product_presentations where id = v_paq) = 'PAQUETE', 'importar: el nombre debía tomar el del archivo';
  assert (select code from product_presentations where id = v_paq) = 'E101-12',
         'importar: sin clave "code" el código existente debía quedarse';
  assert (select count(*) from product_presentations where product_id = pg_temp.prod(101)) = 2,
         'importar: debían quedar dos presentaciones';
  assert (select sold_loose from products where id = pg_temp.prod(101)), 'importar: debía volver a vender suelto';

  -- No borra lo que no viene en el archivo.
  v_n := pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e101",
      "presentations":[{"name":"Caja","units":288,"price":3600,"code":"E101-288"}]}]');
  assert v_n = 1, 'importar (sin borrar): debía devolver 1; devolvió ' || v_n;
  assert (select count(*) from product_presentations where product_id = pg_temp.prod(101)) = 3,
         'importar (sin borrar): debían quedar tres presentaciones';
  assert (select sold_loose from products where id = pg_temp.prod(101)),
         'importar: sin "sold_loose" el valor actual debía quedarse';

  -- Con la clave "code" presente, vacía o nula limpia el código.
  v_n := pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e101",
      "presentations":[{"name":"caja","units":288,"price":3600,"code":""}]}]');
  assert (select code is null from product_presentations
           where product_id = pg_temp.prod(101) and lower(name) = 'caja'),
         'importar: "code": "" debía dejar el código nulo';
end $t$;

-- Importar: rechazos con los mismos mensajes que guardar.
do $t$
begin
  perform pg_temp.debe_fallar(
    $j$select pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e1ff","presentations":[]}]')$j$,
    'El producto no existe o no tienes acceso a él.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e101",
         "presentations":[{"name":"Uno","units":1,"price":5}]}]')$j$,
    'Una presentación tiene que traer más de una unidad.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e101",
         "presentations":[{"name":"Paquete","units":12,"price":5,"code":"E103"}]}]')$j$,
    'El código «E103» ya lo usa «Otro Prueba» en esta sucursal.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e105","sold_loose":false,
         "presentations":[]}]')$j$,
    'Si «Sin Presentaciones Prueba» no se vende suelto, necesita al menos una presentación.');
  -- Una fila mala deshace todo el lote.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e105",
         "presentations":[{"name":"Bolsa","units":6,"price":5}]},
        {"product_id":"00000000-0000-0000-0000-00000000e101",
         "presentations":[{"name":"Uno","units":1,"price":5}]}]')$j$,
    'Una presentación tiene que traer más de una unidad.');
  assert not exists (select 1 from product_presentations where product_id = pg_temp.prod(105)),
         'importar: una fila mala debía deshacer todo el lote';
end $t$;

-- Escrituras directas (PostgREST): la validación vive en el trigger y los
-- datos de empresa y sucursal salen del producto, no de lo que mande el cliente.
do $t$
begin
  perform pg_temp.debe_fallar(
    $j$insert into product_presentations (product_id, name, units, price)
       values ('00000000-0000-0000-0000-00000000e101', 'Directa', 1, 10)$j$,
    'Una presentación tiene que traer más de una unidad.');
  perform pg_temp.debe_fallar(
    $j$update product_presentations set price = -5 where product_id = '00000000-0000-0000-0000-00000000e101'$j$,
    'El precio de la presentación no puede ser negativo.');
  perform pg_temp.debe_fallar(
    $j$insert into product_presentations (product_id, name, units, price)
       values ('00000000-0000-0000-0000-00000000e1ff', 'Huérfana', 6, 10)$j$,
    'El producto no existe o no tienes acceso a él.');

  insert into product_presentations (product_id, company_id, branch_id, name, units, price, code)
  values (pg_temp.prod(105), 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
          ' Directa ', 6, 10, ' ');
  assert (select company_id = '00000000-0000-0000-0000-0000000000aa'
              and branch_id = '00000000-0000-0000-0000-0000000000b1'
              and name = 'Directa' and code is null
            from product_presentations where product_id = pg_temp.prod(105)),
         'directa: el trigger debía copiar empresa y sucursal del producto y recortar nombre y código';
  delete from product_presentations where product_id = pg_temp.prod(105);
end $t$;

-- RLS: un cajero de la sucursal b1 trabaja con las presentaciones de b1 y no ve
-- ni toca las de la sucursal Prueba. También prueba que el trigger funciona sin
-- que `authenticated` pueda ejecutarlo a mano.
select pg_temp.preparar_cajero();
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
set local role authenticated;
do $t$
begin
  assert (select count(*) from product_presentations where product_id = pg_temp.prod(101)) > 0,
         'RLS: el cajero debía ver las presentaciones de su sucursal';
  assert (select count(*) from product_presentations where product_id = pg_temp.prod(104)) = 0,
         'RLS: el cajero no debía ver las de otra sucursal';
  assert pg_temp.guardar(pg_temp.prod(105), true, '[{"name":"Bolsa","units":6,"price":40}]') = 1,
         'RLS: el cajero debía poder guardar en su sucursal';
  perform pg_temp.debe_fallar(
    $j$select pg_temp.guardar(pg_temp.prod(104), true, '[{"name":"Caja","units":24,"price":300}]')$j$,
    'El producto no existe o no tienes acceso a él.');
  perform pg_temp.debe_fallar(
    $j$select pg_temp.importar('[{"product_id":"00000000-0000-0000-0000-00000000e104","presentations":[{"name":"Caja","units":24,"price":300}]}]')$j$,
    'El producto no existe o no tienes acceso a él.');
  assert not has_function_privilege('authenticated', 'public.product_presentations_before_write()', 'execute'),
         'RLS: authenticated no debía poder ejecutar la función del trigger';
end $t$;
reset role;
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

-- Borrar el producto borra sus presentaciones.
do $t$
begin
  assert exists (select 1 from product_presentations where product_id = pg_temp.prod(104)),
         'cascada: e104 debía tener presentaciones antes de borrarlo';
  delete from products where id = pg_temp.prod(104);
  assert not exists (select 1 from product_presentations where product_id = pg_temp.prod(104)),
         'cascada: borrar el producto debía borrar sus presentaciones';
end $t$;

-- == Task 2: venta y anulación por presentación ==
-- Estado explícito de la sección: super admin de la demo; sin filas de
-- company_modules para quick-sales (el módulo cuenta como activo por omisión).
-- Fixtures en la sucursal Principal (b1): e111 "Galletas Venta" (und, stock 30,
-- costo 10) con el Paquete e112 (12 u, RD$160); e113 sin presentaciones (stock
-- 10, costo 7); e114 sin control de existencias (stock 50, costo 4) con una
-- Bolsa de 6 u; e115 "Otro Venta" con la Caja e116 (presentación ajena a e111).
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
delete from company_modules
 where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'quick-sales';

-- Venta pagada con tarjeta (así la caja no interviene).
create function pg_temp.vender(p_items text) returns uuid
language plpgsql as $$
begin
  return (create_sale_with_items(jsonb_build_object(
    'branch_id', '00000000-0000-0000-0000-0000000000b1', 'subtotal', 100, 'itbis_amount', 0,
    'total', 100, 'payment_method', 'card', 'payment_status', 'paid',
    'amount_paid', 100, 'ncf_type', 'consumer'), p_items::jsonb)).id;
end $$;

insert into products (id, company_id, branch_id, name, code, unit, stock, cost, price, tracks_stock) values
  (pg_temp.prod(111), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Galletas Venta', null, 'und', 30, 10, 15, true),
  (pg_temp.prod(113), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Sin Presentaciones Venta', null, 'und', 10, 7, 8, true),
  (pg_temp.prod(114), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Bolsas Sin Control Venta', null, 'und', 50, 4, 6, false),
  (pg_temp.prod(115), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Otro Venta', null, 'und', 5, 3, 5, true);
insert into product_presentations (id, product_id, name, units, price) values
  (pg_temp.prod(112), pg_temp.prod(111), 'Paquete', 12, 160),
  (pg_temp.prod(116), pg_temp.prod(115), 'Caja', 6, 90);
insert into product_presentations (product_id, name, units, price) values
  (pg_temp.prod(114), 'Bolsa', 6, 30);

-- 2 paquetes + 3 sueltas = 27 unidades base; anular las devuelve. Lo que el
-- navegador mande en `presentation_name` / `cost` se ignora: los pone el servidor
-- desde la presentación. `units_per` solo se compara con el de la presentación
-- (ver «la venta rechaza una presentación que cambió», al final).
do $t$
declare v_sale uuid;
begin
  v_sale := pg_temp.vender('[
    {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e112",
     "quantity":2,"price":160,"units_per":12,"presentation_name":"X","cost":0},
    {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","quantity":3,"price":15}]');
  assert (select stock from products where id = pg_temp.prod(111)) = 3,
         'venta: 2 paquetes + 3 sueltas debían dejar el stock en 3 (30 − 27); quedó en '
         || (select stock from products where id = pg_temp.prod(111));
  assert (select count(*) from sale_items where sale_id = v_sale) = 2, 'venta: debían guardarse dos líneas';
  assert (select units_per = 12 and presentation_name = 'Paquete' and cost = 120 and quantity = 2
            from sale_items where sale_id = v_sale and presentation_id = pg_temp.prod(112)),
         'venta: la línea del paquete debía quedar con units_per 12, nombre Paquete y costo 120 (10 × 12), sin hacer caso al payload';
  assert (select units_per = 1 and cost = 10 and presentation_name is null and quantity = 3
            from sale_items where sale_id = v_sale and presentation_id is null),
         'venta: la línea suelta debía quedar con units_per 1, sin nombre de presentación y costo 10';

  perform annul_sale(v_sale, 'prueba', 'card');
  assert (select cancelled_at is not null from sales where id = v_sale), 'anular: la venta no quedó anulada';
  assert (select stock from products where id = pg_temp.prod(111)) = 30,
         'anular: debía reponer 27 unidades base (quantity × units_per); el stock quedó en '
         || (select stock from products where id = pg_temp.prod(111));
end $t$;

-- Justo en el límite: 2 paquetes + 6 sueltas = 30 deja el stock en 0.
do $t$
declare v_sale uuid;
begin
  v_sale := pg_temp.vender('[
    {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e112","quantity":2,"price":160},
    {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","quantity":6,"price":15}]');
  assert (select stock from products where id = pg_temp.prod(111)) = 0,
         'límite: 24 + 6 = 30 debía dejar el stock en 0';
  perform annul_sale(v_sale, 'prueba', 'card');
  assert (select stock from products where id = pg_temp.prod(111)) = 30, 'límite: anular debía devolver las 30';
end $t$;

-- Rechazos. Cada uno revierte lo que hiciera antes de fallar.
do $t$
begin
  -- El stock se compara contra la suma de las líneas en unidades base:
  -- 24 + 7 = 31 > 30 aunque cada línea por separado alcance.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[
        {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e112","quantity":2,"price":160},
        {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","quantity":7,"price":15}]')$j$,
    'Stock insuficiente para completar la venta.');
  -- Una sola línea: 3 paquetes son 36 unidades base, no 3.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e112","quantity":3,"price":160}]')$j$,
    'Stock insuficiente para completar la venta.');
  -- La presentación de otro producto no vale.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e116","quantity":1,"price":90}]')$j$,
    'La presentación no corresponde a este producto.');
  -- Ni una que no existe.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e1ff","quantity":1,"price":160}]')$j$,
    'La presentación no corresponde a este producto.');
  -- Ni una línea sin producto.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_name":"Paquete suelto","presentation_id":"00000000-0000-0000-0000-00000000e112","quantity":1,"price":160}]')$j$,
    'La presentación no corresponde a este producto.');
  -- Las presentaciones van enteras.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e112","quantity":1.5,"price":160}]')$j$,
    'Las presentaciones van enteras: la cantidad tiene que ser un número entero.');
  -- Un artículo rápido no lleva presentación.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_name":"Cable USB","quantity":1,"price":150,"is_quick":true,"presentation_id":"00000000-0000-0000-0000-00000000e112"}]')$j$,
    'Un artículo rápido no puede llevar presentación.');

  assert (select stock from products where id = pg_temp.prod(111)) = 30, 'rechazos: una venta fallida movió el stock';
end $t$;

-- Sin vender suelto: la línea suelta se rechaza con el nombre del producto y la
-- que trae presentación sigue pasando.
do $t$
declare v_sale uuid; v_keep text;
begin
  v_keep := jsonb_build_array(jsonb_build_object('id', pg_temp.prod(112), 'name', 'Paquete', 'units', 12, 'price', 160))::text;
  perform pg_temp.guardar(pg_temp.prod(111), false, v_keep);
  assert not (select sold_loose from products where id = pg_temp.prod(111)),
         'suelto: save(e111, false, [Paquete]) debía apagar sold_loose';
  assert exists (select 1 from product_presentations where id = pg_temp.prod(112)),
         'suelto: el Paquete debía conservarse por su id';

  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","quantity":1,"price":15}]')$j$,
    '«Galletas Venta» no se vende suelto.');
  -- Basta una línea suelta para rechazar toda la venta.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[
        {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e112","quantity":1,"price":160},
        {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","quantity":1,"price":15}]')$j$,
    '«Galletas Venta» no se vende suelto.');
  assert (select stock from products where id = pg_temp.prod(111)) = 30,
         'suelto: una venta rechazada movió el stock';

  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e112","quantity":1,"price":160}]');
  assert (select stock from products where id = pg_temp.prod(111)) = 18, 'suelto: 1 paquete debía dejar el stock en 18';
  perform annul_sale(v_sale, 'prueba', 'card');
  assert (select stock from products where id = pg_temp.prod(111)) = 30, 'suelto: anular debía devolver las 12';

  -- Se vuelve a vender suelto.
  perform pg_temp.guardar(pg_temp.prod(111), true, v_keep);
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","quantity":1,"price":15}]');
  assert (select stock from products where id = pg_temp.prod(111)) = 29, 'suelto: con sold_loose otra vez en true la suelta debía pasar';
  perform annul_sale(v_sale, 'prueba', 'card');
end $t$;

-- Presentación borrada después de vender: la línea conserva nombre y unidades
-- (presentation_id queda nulo) y anular repone con esas unidades guardadas, no
-- con las de la presentación, que ya no existe.
do $t$
declare v_sale uuid;
begin
  v_sale := pg_temp.vender('[
    {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","presentation_id":"00000000-0000-0000-0000-00000000e112","quantity":2,"price":160},
    {"product_id":"00000000-0000-0000-0000-00000000e111","product_name":"Galletas Venta","quantity":3,"price":15}]');
  assert (select stock from products where id = pg_temp.prod(111)) = 3, 'borrada: la venta debía dejar el stock en 3';

  delete from product_presentations where id = pg_temp.prod(112);
  assert (select presentation_id is null and presentation_name = 'Paquete' and units_per = 12
            from sale_items where sale_id = v_sale and units_per = 12),
         'borrada: la línea debía conservar nombre y unidades con presentation_id nulo';
  assert (select count(*) from sale_items where sale_id = v_sale) = 2, 'borrada: la venta perdió líneas';

  perform annul_sale(v_sale, 'prueba', 'card');
  assert (select stock from products where id = pg_temp.prod(111)) = 30,
         'borrada: anular debía reponer 27 con las unidades guardadas en la línea';
end $t$;

-- Sin presentaciones: igual que hoy (units_per 1, stock y costo del producto).
do $t$
declare v_sale uuid;
begin
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e113","product_name":"Sin Presentaciones Venta","quantity":2,"price":8,"itbis":false,"unit":"und"}]');
  assert (select stock from products where id = pg_temp.prod(113)) = 8, 'sin presentaciones: vender 2 debía dejar 8';
  assert (select units_per = 1 and presentation_id is null and presentation_name is null and cost = 7
            from sale_items where sale_id = v_sale),
         'sin presentaciones: la línea debía quedar con units_per 1, sin presentación y costo 7';
  perform annul_sale(v_sale, 'prueba', 'card');
  assert (select stock from products where id = pg_temp.prod(113)) = 10, 'sin presentaciones: anular debía devolver 2';

  -- Sin presentation_id, units_per y presentation_name del navegador no cuentan:
  -- si contaran, esto pediría 24 unidades de un producto que tiene 10.
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e113","product_name":"Sin Presentaciones Venta","quantity":2,"price":8,"units_per":12,"presentation_name":"Caja"}]');
  assert (select stock from products where id = pg_temp.prod(113)) = 8, 'falsa: el units_per del navegador debía ignorarse (stock 8)';
  assert (select units_per = 1 and presentation_name is null from sale_items where sale_id = v_sale),
         'falsa: la línea suelta debía quedar con units_per 1 y sin nombre de presentación';
  perform annul_sale(v_sale, 'prueba', 'card');
  assert (select stock from products where id = pg_temp.prod(113)) = 10, 'falsa: anular debía dejar el stock en 10';
end $t$;

-- Producto que no maneja existencias: la presentación se vende y el stock no
-- se toca, ni al vender ni al anular (aunque lo pedido supere el stock anotado).
do $t$
declare v_sale uuid; v_bolsa text;
begin
  v_bolsa := (select id::text from product_presentations where product_id = pg_temp.prod(114));
  v_sale := pg_temp.vender(format('[{"product_id":"00000000-0000-0000-0000-00000000e114","product_name":"Bolsas Sin Control Venta","presentation_id":"%s","quantity":20,"price":30}]', v_bolsa));
  assert (select stock from products where id = pg_temp.prod(114)) = 50, 'sin control: el stock no debía cambiar al vender';
  assert (select units_per = 6 and presentation_name = 'Bolsa' and cost = 24 and quantity = 20
            from sale_items where sale_id = v_sale),
         'sin control: la línea debía guardar units_per 6, nombre Bolsa y costo 24 (4 × 6)';
  perform annul_sale(v_sale, 'prueba', 'card');
  assert (select stock from products where id = pg_temp.prod(114)) = 50, 'sin control: el stock no debía cambiar al anular';
end $t$;

-- == Task 3: compras y transferencias por presentación ==
-- Estado explícito de la sección: super admin de la demo; el módulo de compras
-- se enciende dentro de la transacción (company_modules: clave primaria
-- (company_id, module_key)). Fixtures: suplidor e1f0; en la sucursal Principal
-- (b1) e121 "Galletas Envio" (und, código E121, stock 0, costo 12.5) con la Caja
-- e122 (288 u, RD$3,600, código E121-288) y el Paquete e123 (12 u, RD$180,
-- código E121-12); en la sucursal Prueba e124 "Otro Envio" con código E121-288
-- (otro nombre a propósito: transfer_products busca el destino por código y
-- luego por NOMBRE, y uno llamado igual recibiría el stock en vez de crearse el
-- producto). La presentación e1f1 (de e124) se crea en el escenario que la usa.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'purchases', true)
on conflict (company_id, module_key) do update set enabled = true;

-- Compra a nombre del suplidor de prueba.
create function pg_temp.comprar(p_items text) returns jsonb
language plpgsql as $$
begin
  return create_supplier_invoice(
    p_supplier_id => '00000000-0000-0000-0000-00000000e1f0',
    p_issue_date => current_date,
    p_branch_id => '00000000-0000-0000-0000-0000000000b1',
    p_subtotal_goods => 6000,
    p_items => p_items::jsonb);
end $$;

-- Envío de la sucursal Principal a la sucursal Prueba.
create function pg_temp.enviar(p_items text) returns jsonb
language plpgsql as $$
begin
  return transfer_products('00000000-0000-0000-0000-0000000000b1',
                           '169fe6bb-91fa-4633-8e43-5a45e410e2b0', p_items::jsonb);
end $$;

insert into suppliers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e1f0', '00000000-0000-0000-0000-0000000000aa', 'Suplidor Envio');
insert into products (id, company_id, branch_id, name, code, unit, stock, cost, price, tracks_stock) values
  (pg_temp.prod(121), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Galletas Envio', 'E121', 'und', 0, 12.5, 15, true),
  (pg_temp.prod(124), '00000000-0000-0000-0000-0000000000aa', '169fe6bb-91fa-4633-8e43-5a45e410e2b0',
   'Otro Envio', 'E121-288', 'und', 0, 5, 8, true);
insert into product_presentations (id, product_id, name, units, price, code) values
  (pg_temp.prod(122), pg_temp.prod(121), 'Caja', 288, 3600, 'E121-288'),
  (pg_temp.prod(123), pg_temp.prod(121), 'Paquete', 12, 180, 'E121-12');

-- Las dos funciones conservan su modo de seguridad y su search_path (se
-- reescriben con CREATE OR REPLACE y no pueden cambiar de dueño de privilegios).
do $t$
begin
  assert (select prosecdef from pg_proc where oid = 'public.transfer_products'::regproc),
         'seguridad: transfer_products dejó de ser security definer';
  assert not (select prosecdef from pg_proc where oid = 'public.create_supplier_invoice'::regproc),
         'seguridad: create_supplier_invoice dejó de ser security invoker';
  assert (select 'search_path=public' = any (coalesce(proconfig, '{}'))
            from pg_proc where oid = 'public.transfer_products'::regproc),
         'seguridad: transfer_products sin search_path';
  assert (select 'search_path=public' = any (coalesce(proconfig, '{}'))
            from pg_proc where oid = 'public.create_supplier_invoice'::regproc),
         'seguridad: create_supplier_invoice sin search_path';
  assert not has_function_privilege('anon', 'public.transfer_products'::regproc, 'execute'),
         'permisos: anon puede ejecutar transfer_products';
end $t$;

-- Compra de 2 cajas → +576 unidades base. Lo que el navegador mande en
-- `units_per` / `presentation_name` se ignora: los pone el servidor.
do $t$
declare v jsonb;
begin
  v := pg_temp.comprar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122",
      "description":"Caja","quantity":2,"unit_cost":3000,"units_per":1,"presentation_name":"X"}]');
  assert (select stock from products where id = pg_temp.prod(121)) = 576,
         'compra: 2 cajas de 288 debían dejar el stock en 576; quedó en '
         || (select stock from products where id = pg_temp.prod(121));
  assert (select units_per = 288 and presentation_name = 'Caja' and presentation_id = pg_temp.prod(122)
              and quantity = 2 and unit_cost = 3000
            from supplier_invoice_items where invoice_id = (v->>'invoice_id')::uuid),
         'compra: la línea debía guardar units_per 288, nombre Caja, la presentación, cantidad 2 y costo 3000 por caja';
end $t$;

-- Rechazos de la compra (cada uno revierte lo que hiciera antes de fallar).
do $t$
begin
  -- La presentación de otro producto no vale (e123 es de e121, no de e124).
  perform pg_temp.debe_fallar(
    $j$select pg_temp.comprar('[{"product_id":"00000000-0000-0000-0000-00000000e124","presentation_id":"00000000-0000-0000-0000-00000000e123","description":"Paquete","quantity":1,"unit_cost":150}]')$j$,
    'La presentación no corresponde a este producto.');
  -- Ni una que no existe.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.comprar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e1ff","description":"Caja","quantity":1,"unit_cost":3000}]')$j$,
    'La presentación no corresponde a este producto.');
  -- Ni una línea sin producto.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.comprar('[{"presentation_id":"00000000-0000-0000-0000-00000000e122","description":"Caja","quantity":1,"unit_cost":3000}]')$j$,
    'La presentación no corresponde a este producto.');
  -- Las presentaciones van enteras.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.comprar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122","description":"Caja","quantity":1.5,"unit_cost":3000}]')$j$,
    'Las presentaciones van enteras: la cantidad tiene que ser un número entero.');

  assert (select stock from products where id = pg_temp.prod(121)) = 576, 'compra rechazada: movió el stock';
  assert (select count(*) from supplier_invoices where supplier_id = '00000000-0000-0000-0000-00000000e1f0') = 1,
         'compra rechazada: dejó una factura a medias';
end $t$;

-- Transferir 1 caja a la sucursal Prueba, donde E121 no existe: se crea el
-- producto con todas las presentaciones del original. La Caja trae el código
-- E121-288, que allá ya usa e124: la copia queda sin código; el Paquete trae
-- E121-12, que allá está libre: lo conserva.
do $t$
declare v jsonb;
begin
  v := pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122","quantity":1}]');
  assert (select stock from products where id = pg_temp.prod(121)) = 288,
         'envío 1: el origen debía quedar en 288 (576 − 288); quedó en '
         || (select stock from products where id = pg_temp.prod(121));
  assert (select stock from products where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121') = 288,
         'envío 1: el producto creado en Prueba debía nacer con 288';
  assert (select stock from products where id = pg_temp.prod(124)) = 0,
         'envío 1: e124 (otro nombre y otro código) no debía recibir stock';
  assert (select count(*) from product_presentations pp join products p on p.id = pp.product_id
           where p.branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and p.code = 'E121') = 2,
         'envío 1: el producto creado debía traer sus dos presentaciones';
  assert (select pp.code is null and pp.units = 288 and pp.price = 3600
            from product_presentations pp join products p on p.id = pp.product_id
           where p.branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and p.code = 'E121' and pp.name = 'Caja'),
         'envío 1: la Caja copiada debía quedar sin código (E121-288 ya lo usa e124 allá) y con sus unidades y precio';
  assert (select pp.code = 'E121-12' and pp.units = 12 and pp.price = 180
            from product_presentations pp join products p on p.id = pp.product_id
           where p.branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and p.code = 'E121' and pp.name = 'Paquete'),
         'envío 1: el Paquete debía conservar su código E121-12 (allá está libre)';
  assert (select count(*) from product_presentations where product_id = pg_temp.prod(121)) = 2,
         'envío 1: las presentaciones del origen no debían tocarse';
  assert (select quantity = 1 and units_per = 288 and presentation_name = 'Caja' and unit_cost = 3600
              and unit = 'und' and target_created and not source_archived
            from product_transfers where batch_id = (v->>'batch_id')::uuid),
         'envío 1: product_transfers debía guardar cantidad 1, units_per 288, nombre Caja y costo 3600 (12.5 × 288)';
end $t$;

-- Segundo envío: el destino ya existe y sus presentaciones no se tocan (se
-- sube el precio de la Caja allá, se borra el Paquete allá, se envía 1 paquete:
-- el precio sigue igual y el Paquete no reaparece).
do $t$
declare v jsonb; v_dest uuid;
begin
  select id into v_dest from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  update product_presentations set price = 4000 where product_id = v_dest and name = 'Caja';
  delete from product_presentations where product_id = v_dest and name = 'Paquete';

  v := pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":1}]');
  assert (select stock from products where id = pg_temp.prod(121)) = 276,
         'envío 2: el origen debía quedar en 276 (288 − 12); quedó en '
         || (select stock from products where id = pg_temp.prod(121));
  assert (select stock from products where id = v_dest) = 300, 'envío 2: el destino existente debía subir a 300';
  assert (select count(*) from product_presentations where product_id = v_dest) = 1
     and (select price = 4000 and units = 288 from product_presentations where product_id = v_dest and name = 'Caja'),
         'envío 2: las presentaciones del destino existente no debían tocarse';
  assert (select quantity = 1 and units_per = 12 and presentation_name = 'Paquete' and unit_cost = 150
              and not target_created and target_product_id = v_dest
            from product_transfers where batch_id = (v->>'batch_id')::uuid),
         'envío 2: product_transfers debía guardar cantidad 1, units_per 12, nombre Paquete y costo 150 (12.5 × 12)';
end $t$;

-- Rechazos del envío. El origen tiene 276; el stock se compara contra el total
-- en unidades base de TODAS las líneas del mismo producto.
do $t$
begin
  -- 1 caja + 3 sueltas = 291 > 276.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122","quantity":1},
         {"product_id":"00000000-0000-0000-0000-00000000e121","quantity":3}]')$j$,
    'No hay suficiente «Galletas Envio»%');
  -- Cada línea cabe sola (240 y 37 de 276) pero juntas son 277.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","quantity":37},
         {"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":20}]')$j$,
    'No hay suficiente «Galletas Envio»%');
  -- Una sola línea: 24 paquetes son 288 unidades base, no 24.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":24}]')$j$,
    'No hay suficiente «Galletas Envio»: hay 276, se quieren enviar 288.');
  -- Las presentaciones van enteras (aunque el producto sea contable, el mensaje es el de las presentaciones).
  perform pg_temp.debe_fallar(
    $j$select pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122","quantity":1.5}]')$j$,
    'Las presentaciones van enteras%');
  -- La presentación de otro producto (la Caja del producto creado en Prueba) no vale.
  perform pg_temp.debe_fallar(
    format($j$select pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"%s","quantity":1}]')$j$,
           (select pp.id from product_presentations pp join products p on p.id = pp.product_id
             where p.branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and p.code = 'E121' and pp.name = 'Caja')),
    'La presentación no corresponde a este producto.');
  -- Ni una que no existe.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e1ff","quantity":1}]')$j$,
    'La presentación no corresponde a este producto.');
  -- La cantidad suelta sigue pidiendo enteros en una unidad contable.
  perform pg_temp.debe_fallar(
    $j$select pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","quantity":1.5}]')$j$,
    '«Galletas Envio» se cuenta por piezas: la cantidad tiene que ser entera.');

  assert (select stock from products where id = pg_temp.prod(121)) = 276, 'envío rechazado: movió el stock del origen';
  assert (select stock from products where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121') = 300,
         'envío rechazado: movió el stock del destino';
end $t$;

-- El mismo producto en varias líneas: las repetidas de una misma presentación se
-- suman en una sola línea del conduce, y la suelta va aparte. Sin presentation_id
-- (payload viejo) la línea es suelta: units_per 1 y costo del producto.
do $t$
declare v jsonb; v_dest uuid;
begin
  select id into v_dest from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  v := pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","quantity":5},
      {"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":1}]');
  assert (select stock from products where id = pg_temp.prod(121)) = 247,
         'líneas: 2 paquetes + 5 sueltas = 29 debían dejar el origen en 247; quedó en '
         || (select stock from products where id = pg_temp.prod(121));
  assert (select stock from products where id = v_dest) = 329, 'líneas: el destino debía subir a 329';
  assert (v->>'items')::integer = 2, 'líneas: debían quedar dos líneas en el conduce';
  assert (select count(*) from product_transfers where batch_id = (v->>'batch_id')::uuid) = 2,
         'líneas: product_transfers debía tener dos filas';
  assert (select quantity = 2 and units_per = 12 and unit_cost = 150
            from product_transfers where batch_id = (v->>'batch_id')::uuid and presentation_name = 'Paquete'),
         'líneas: los dos paquetes debían sumarse (cantidad 2, units_per 12, costo 150)';
  assert (select quantity = 5 and units_per = 1 and unit_cost = 12.5 and presentation_name is null
            from product_transfers where batch_id = (v->>'batch_id')::uuid and presentation_name is null),
         'líneas: la suelta debía quedar con cantidad 5, units_per 1, costo 12.5 y sin presentación';
  assert (select count(*) from product_presentations where product_id = v_dest) = 1,
         'líneas: las presentaciones del destino existente no debían tocarse';
end $t$;

-- Archivado al vaciar: el chequeo usa la misma cantidad en unidades base. 20
-- paquetes + 36 sueltas = 276 vacían el origen justo en el límite; la última
-- línea es la que lo archiva.
do $t$
declare v jsonb; v_dest uuid;
begin
  select id into v_dest from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  update products set stock = 276 where id = pg_temp.prod(121);
  v := pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":20},
      {"product_id":"00000000-0000-0000-0000-00000000e121","quantity":36}]');
  assert (select stock = 0 and not is_active from products where id = pg_temp.prod(121)),
         'archivado: 240 + 36 = 276 debían vaciar y archivar el origen';
  assert (select stock from products where id = v_dest) = 605, 'archivado: el destino debía subir a 605 (329 + 276)';
  assert (select source_archived from product_transfers
           where batch_id = (v->>'batch_id')::uuid and presentation_name is null),
         'archivado: la última línea (la que vacía el origen) debía marcar source_archived';
  assert not (select source_archived from product_transfers
               where batch_id = (v->>'batch_id')::uuid and presentation_name = 'Paquete'),
         'archivado: la línea de paquetes todavía no vaciaba el origen';
  -- Un envío que no vacía no archiva: se vuelve a activar y se manda 1 caja de 300.
  update products set is_active = true, stock = 300 where id = pg_temp.prod(121);
  v := pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122","quantity":1}]');
  assert (select stock = 12 and is_active from products where id = pg_temp.prod(121)),
         'archivado: 300 − 288 = 12 no debía archivar el origen';
  assert not (select source_archived from product_transfers where batch_id = (v->>'batch_id')::uuid),
         'archivado: source_archived debía ser falso si queda stock';
  update products set stock = 300 where id = pg_temp.prod(121);
end $t$;

-- Copia con el código ocupado por OTRA PRESENTACIÓN de la sucursal destino (sin
-- distinguir mayúsculas): se borra el producto creado allá, e124 recibe una
-- presentación con el código del Paquete y se vuelve a enviar. Ni la Caja
-- (código de e124) ni el Paquete (código de la presentación de e124) lo
-- conservan, y el trigger no llega a fallar.
do $t$
declare v jsonb; v_dest uuid;
begin
  delete from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  insert into product_presentations (id, product_id, name, units, price, code) values
    ('00000000-0000-0000-0000-00000000e1f1', pg_temp.prod(124), 'Docena', 12, 190, 'e121-12');

  v := pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":1}]');
  select id into v_dest from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  assert v_dest is not null and (select target_created from product_transfers where batch_id = (v->>'batch_id')::uuid),
         'colisión: el producto debía volver a crearse en Prueba';
  assert (select stock from products where id = v_dest) = 12, 'colisión: el producto creado debía nacer con 12 (1 paquete)';
  assert (select count(*) from product_presentations where product_id = v_dest) = 2,
         'colisión: debía copiar las dos presentaciones aunque el envío sea de una';
  assert (select count(*) from product_presentations where product_id = v_dest and code is null) = 2,
         'colisión: la Caja (código de e124) y el Paquete (código de la Docena de e124) debían quedar sin código';
  assert (select code = 'e121-12' from product_presentations where id = '00000000-0000-0000-0000-00000000e1f1'),
         'colisión: la presentación de e124 no debía tocarse';
  assert (select stock from products where id = pg_temp.prod(124)) = 0, 'colisión: e124 no debía recibir stock';
end $t$;

-- sold_loose viaja con el producto: si el original solo se vende por
-- presentaciones, el que se crea en el destino también (y trae sus
-- presentaciones); si se vende suelto, el creado también. Se borra la copia de
-- Prueba, se apaga sold_loose en el origen con save_product_presentations
-- (conservando las presentaciones por su id) y se vuelve a enviar; después se
-- vuelve a encender y se repite.
do $t$
declare v jsonb; v_dest uuid; v_keep text;
begin
  v_keep := jsonb_build_array(
    jsonb_build_object('id', pg_temp.prod(122), 'name', 'Caja', 'units', 288, 'price', 3600, 'code', 'E121-288'),
    jsonb_build_object('id', pg_temp.prod(123), 'name', 'Paquete', 'units', 12, 'price', 180, 'code', 'E121-12'))::text;

  delete from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  perform pg_temp.guardar(pg_temp.prod(121), false, v_keep);
  assert not (select sold_loose from products where id = pg_temp.prod(121)),
         'sold_loose: el origen debía quedar sin venderse suelto';

  v := pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":1}]');
  select id into v_dest from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  assert v_dest is not null and (select target_created from product_transfers where batch_id = (v->>'batch_id')::uuid),
         'sold_loose: el producto debía crearse en Prueba';
  assert (select not sold_loose from products where id = v_dest),
         'sold_loose: el producto creado en el destino debía copiar sold_loose = false del original';
  assert (select count(*) from product_presentations where product_id = v_dest) = 2,
         'sold_loose: el producto creado debía conservar sus dos presentaciones';

  -- Control: con sold_loose en true se copia true.
  delete from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  perform pg_temp.guardar(pg_temp.prod(121), true, v_keep);
  v := pg_temp.enviar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e123","quantity":1}]');
  select id into v_dest from products
   where branch_id = '169fe6bb-91fa-4633-8e43-5a45e410e2b0' and code = 'E121';
  assert v_dest is not null and (select sold_loose from products where id = v_dest),
         'sold_loose: con el original vendiéndose suelto, el creado también debía quedar en true';
end $t$;

-- Compras: suelta, mezcla y las condiciones de hoy (módulo purchases y
-- tracks_stock) siguen mandando sobre el stock.
do $t$
declare v jsonb; v_antes numeric;
begin
  -- Línea sin presentación (payload viejo): suma la cantidad tal cual.
  select stock into v_antes from products where id = pg_temp.prod(121);
  v := pg_temp.comprar('[{"product_id":"00000000-0000-0000-0000-00000000e121","description":"Suelta","quantity":5,"unit_cost":12.5}]');
  assert (select stock from products where id = pg_temp.prod(121)) = v_antes + 5,
         'compra suelta: debía sumar 5 unidades';
  assert (select units_per = 1 and presentation_id is null and presentation_name is null
            from supplier_invoice_items where invoice_id = (v->>'invoice_id')::uuid),
         'compra suelta: la línea debía quedar con units_per 1 y sin presentación';

  -- Una caja y 5 sueltas en la misma compra: 288 + 5.
  select stock into v_antes from products where id = pg_temp.prod(121);
  v := pg_temp.comprar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122","description":"Caja","quantity":1,"unit_cost":3000},
      {"product_id":"00000000-0000-0000-0000-00000000e121","description":"Suelta","quantity":5,"unit_cost":12.5}]');
  assert (select stock from products where id = pg_temp.prod(121)) = v_antes + 293,
         'compra mixta: 1 caja + 5 sueltas debían sumar 293';

  -- Sin el módulo de compras no se toca el stock, pero la línea se guarda con la presentación.
  update company_modules set enabled = false
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'purchases';
  select stock into v_antes from products where id = pg_temp.prod(121);
  v := pg_temp.comprar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122","description":"Caja","quantity":1,"unit_cost":3000}]');
  assert (select stock from products where id = pg_temp.prod(121)) = v_antes,
         'sin módulo: la compra no debía mover el stock';
  assert (select units_per = 288 and presentation_name = 'Caja'
            from supplier_invoice_items where invoice_id = (v->>'invoice_id')::uuid),
         'sin módulo: la línea debía guardarse igual con units_per 288 y nombre Caja';
  update company_modules set enabled = true
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'purchases';

  -- Producto sin control de existencias: tampoco se suma.
  update products set tracks_stock = false where id = pg_temp.prod(121);
  select stock into v_antes from products where id = pg_temp.prod(121);
  v := pg_temp.comprar('[{"product_id":"00000000-0000-0000-0000-00000000e121","presentation_id":"00000000-0000-0000-0000-00000000e122","description":"Caja","quantity":1,"unit_cost":3000}]');
  assert (select stock from products where id = pg_temp.prod(121)) = v_antes,
         'sin control: la compra no debía mover el stock';
  update products set tracks_stock = true where id = pg_temp.prod(121);
end $t$;

-- == Revisión final: el código de una presentación solo se revisa si cambia ==
-- Estado explícito de la sección: super admin de la demo. Fixtures en la sucursal
-- Principal (b1): e131 "Choque A" (código E131) con la Caja e132 (24 u, código
-- E131-24); e133 "Choque B" (código E133) y e134 "Choque C" (código E134). La base
-- solo vigila los códigos al escribir presentaciones: si después un producto toma
-- el código de una (formulario, CSV, transferencia, restaurar un archivado), el
-- dueño de la presentación tiene que poder seguir editándola mientras no le cambie
-- el código.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
insert into products (id, company_id, branch_id, name, code, unit, stock, cost, price, tracks_stock) values
  (pg_temp.prod(131), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Choque A', 'E131', 'und', 0, 10, 15, true),
  (pg_temp.prod(133), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Choque B', 'E133', 'und', 0, 10, 15, true),
  (pg_temp.prod(134), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Choque C', 'E134', 'und', 0, 10, 15, true);
insert into product_presentations (id, product_id, name, units, price, code) values
  (pg_temp.prod(132), pg_temp.prod(131), 'Caja', 24, 300, 'E131-24');

do $t$
declare v_caja text;
begin
  -- El choque nace del lado del producto: B toma el código de la Caja de A.
  update products set code = 'e131-24' where id = pg_temp.prod(133);

  -- Editar solo el precio de la Caja (mismo código, con otras mayúsculas y espacios) pasa.
  v_caja := jsonb_build_array(jsonb_build_object(
    'id', pg_temp.prod(132), 'name', 'Caja', 'units', 24, 'price', 320, 'code', ' e131-24 '))::text;
  perform pg_temp.guardar(pg_temp.prod(131), true, v_caja);
  assert (select price = 320 and code = 'e131-24' from product_presentations where id = pg_temp.prod(132)),
         'código sin cambio: editar el precio de la Caja debía pasar aunque «Choque B» tenga su código';
  -- Directo (PostgREST) también.
  update product_presentations set price = 330 where id = pg_temp.prod(132);
  assert (select price from product_presentations where id = pg_temp.prod(132)) = 330,
         'código sin cambio: el update directo del precio debía pasar';

  -- Cambiar el código sí se revisa, con los mismos mensajes: el de otro producto...
  perform pg_temp.debe_fallar(
    format($j$select pg_temp.guardar(%L, true, %L)$j$, pg_temp.prod(131),
           jsonb_build_array(jsonb_build_object(
             'id', pg_temp.prod(132), 'name', 'Caja', 'units', 24, 'price', 320, 'code', 'e134'))::text),
    'El código «e134» ya lo usa «Choque C» en esta sucursal.');
  -- ...el del propio producto...
  perform pg_temp.debe_fallar(
    format($j$update product_presentations set code = 'E131' where id = %L$j$, pg_temp.prod(132)),
    'El código «E131» ya lo usa «Choque A» en esta sucursal.');
  -- ...y una presentación nueva con el código ocupado tampoco entra.
  perform pg_temp.debe_fallar(
    format($j$select pg_temp.guardar(%L, true, '[{"name":"Fardo","units":48,"price":600,"code":"E134"}]')$j$,
           pg_temp.prod(133)),
    'El código «E134» ya lo usa «Choque C» en esta sucursal.');
  -- Pasar la Caja a otro producto es como crearla allá: se revisa (B tiene su código).
  perform pg_temp.debe_fallar(
    format($j$update product_presentations set product_id = %L where id = %L$j$,
           pg_temp.prod(133), pg_temp.prod(132)),
    'El código «e131-24» ya lo usa «Choque B» en esta sucursal.');

  assert (select product_id = pg_temp.prod(131) and code = 'e131-24' and price = 330
            from product_presentations where id = pg_temp.prod(132)),
         'código: los rechazos no debían tocar la Caja';
end $t$;

-- == Revisión final: la venta rechaza una presentación que cambió ==
-- Estado explícito de la sección: super admin de la demo. Fixtures en la sucursal
-- Principal (b1): e141 "Galletas Carrito" (und, stock 100, costo 10) con el
-- Paquete e142 (12 u, RD$160). El carrito manda en `units_per` las unidades que
-- tenía la presentación al agregarla; si ya no son las de hoy (un carrito guardado,
-- otra tableta), la línea traería el precio de la presentación vieja.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
insert into products (id, company_id, branch_id, name, code, unit, stock, cost, price, tracks_stock) values
  (pg_temp.prod(141), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
   'Galletas Carrito', null, 'und', 100, 10, 15, true);
insert into product_presentations (id, product_id, name, units, price) values
  (pg_temp.prod(142), pg_temp.prod(141), 'Paquete', 12, 160);

do $t$
declare v_sale uuid;
begin
  -- Las unidades de hoy (se comparan como número: 12 y 12.000 son lo mismo).
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e141","product_name":"Galletas Carrito","presentation_id":"00000000-0000-0000-0000-00000000e142","quantity":1,"price":160,"units_per":12}]');
  assert (select stock from products where id = pg_temp.prod(141)) = 88, 'carrito: 1 paquete con units_per 12 debía dejar 88';
  assert (select units_per = 12 from sale_items where sale_id = v_sale), 'carrito: la línea debía quedar con units_per 12';
  perform annul_sale(v_sale, 'prueba', 'card');
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e141","product_name":"Galletas Carrito","presentation_id":"00000000-0000-0000-0000-00000000e142","quantity":1,"price":160,"units_per":12.000}]');
  perform annul_sale(v_sale, 'prueba', 'card');
  -- Una app vieja (en caché) no manda units_per, o lo manda nulo: pasa como hoy.
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e141","product_name":"Galletas Carrito","presentation_id":"00000000-0000-0000-0000-00000000e142","quantity":1,"price":160}]');
  perform annul_sale(v_sale, 'prueba', 'card');
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e141","product_name":"Galletas Carrito","presentation_id":"00000000-0000-0000-0000-00000000e142","quantity":1,"price":160,"units_per":null}]');
  perform annul_sale(v_sale, 'prueba', 'card');
  assert (select stock from products where id = pg_temp.prod(141)) = 100, 'carrito: anular debía dejar el stock en 100';

  -- El Paquete pasa a traer 10: el carrito que lo agregó con 12 ya no vale.
  update product_presentations set units = 10 where id = pg_temp.prod(142);
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e141","product_name":"Galletas Carrito","presentation_id":"00000000-0000-0000-0000-00000000e142","quantity":1,"price":160,"units_per":12}]')$j$,
    'La presentación «Paquete» cambió; quítala del carrito y vuelve a agregarla.');
  -- Basta una línea vieja para rechazar toda la venta (aunque haya una suelta al lado).
  perform pg_temp.debe_fallar(
    $j$select pg_temp.vender('[
        {"product_id":"00000000-0000-0000-0000-00000000e141","product_name":"Galletas Carrito","quantity":3,"price":15,"units_per":null},
        {"product_id":"00000000-0000-0000-0000-00000000e141","product_name":"Galletas Carrito","presentation_id":"00000000-0000-0000-0000-00000000e142","quantity":2,"price":160,"units_per":12}]')$j$,
    'La presentación «Paquete» cambió; quítala del carrito y vuelve a agregarla.');
  assert (select stock from products where id = pg_temp.prod(141)) = 100, 'carrito: una venta rechazada movió el stock';

  -- Con las unidades nuevas pasa y descuenta 10.
  v_sale := pg_temp.vender('[{"product_id":"00000000-0000-0000-0000-00000000e141","product_name":"Galletas Carrito","presentation_id":"00000000-0000-0000-0000-00000000e142","quantity":1,"price":160,"units_per":10}]');
  assert (select stock from products where id = pg_temp.prod(141)) = 90, 'carrito: 1 paquete de 10 debía dejar 90';
  perform annul_sale(v_sale, 'prueba', 'card');
end $t$;

select 'ok' as resultado;
