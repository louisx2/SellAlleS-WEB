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

  -- La política copia la expresión de products_all (mismo qual y with_check).
  assert exists (select 1 from pg_policies pr, pg_policies p
                  where pr.schemaname = 'public' and pr.tablename = 'product_presentations'
                    and pr.policyname = 'product_presentations_all' and pr.cmd = 'ALL'
                    and p.schemaname = 'public' and p.tablename = 'products' and p.policyname = 'products_all'
                    and pr.qual = p.qual and pr.with_check = p.with_check and pr.roles = p.roles),
         'esquema: product_presentations_all no copia products_all';

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

select 'ok' as resultado;
