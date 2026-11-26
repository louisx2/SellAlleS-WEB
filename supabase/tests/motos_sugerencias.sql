-- Pruebas de las sugerencias al encender Motopréstamos. NO es una migración: se corre
-- contra producción dentro de una transacción que se revierte, después del SQL de la
-- migración (o sola, si ya está aplicada):
--
--   begin; <20261127130000_motos_sugerencias.sql> <este archivo> rollback;
--
-- Usa empresas de prueba propias (…e6XX), no la demo. Cada caso corre en su propio
-- bloque y anota si pasó; al final, si alguno falló, se detiene con la lista.

select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);

create function pg_temp.igual(p_real anyelement, p_esperado anyelement, p_que text) returns void
language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception '%: dio %, esperaba %', p_que, p_real, p_esperado;
  end if;
end $$;

-- Nombres de los tipos de vehículo de la empresa, en orden.
create function pg_temp.tipos(p_company uuid) returns text language sql as $$
  select coalesce(string_agg(name, ',' order by position, name), '') from vehicle_types where company_id = p_company
$$;

-- Nombres de las categorías de la sucursal, en orden alfabético.
create function pg_temp.cats(p_branch uuid) returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '') from product_categories where branch_id = p_branch
$$;

create function pg_temp.encender(p_company uuid, p_modulo text, p_on boolean) returns void language sql as $$
  insert into company_modules (company_id, module_key, enabled) values (p_company, p_modulo, p_on)
  on conflict (company_id, module_key) do update set enabled = excluded.enabled
$$;

create temp table sug_resultado (caso text, error text);

insert into companies (id, name) values
  ('00000000-0000-0000-0000-00000000e6a0', 'Prueba sugerencias A'),
  ('00000000-0000-0000-0000-00000000e6c0', 'Prueba sugerencias pool'),
  ('00000000-0000-0000-0000-00000000e6d0', 'Prueba sugerencias existentes'),
  ('00000000-0000-0000-0000-00000000e6e0', 'Prueba sugerencias otro módulo');
insert into branches (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e6b1', '00000000-0000-0000-0000-00000000e6a0', 'Principal A'),
  ('00000000-0000-0000-0000-00000000e6c1', '00000000-0000-0000-0000-00000000e6c0', 'Pool 1'),
  ('00000000-0000-0000-0000-00000000e6c2', '00000000-0000-0000-0000-00000000e6c0', 'Pool 2'),
  ('00000000-0000-0000-0000-00000000e6c3', '00000000-0000-0000-0000-00000000e6c0', 'Fuera del pool'),
  ('00000000-0000-0000-0000-00000000e6d1', '00000000-0000-0000-0000-00000000e6d0', 'Principal D'),
  ('00000000-0000-0000-0000-00000000e6e1', '00000000-0000-0000-0000-00000000e6e0', 'Principal E');

-- A. Encender el módulo carga los 5 tipos y las 4 categorías.
do $$
begin
  begin
    perform pg_temp.encender('00000000-0000-0000-0000-00000000e6a0', 'motoprestamos', true);
    perform pg_temp.igual(pg_temp.tipos('00000000-0000-0000-0000-00000000e6a0'), 'Motor,Pasola,Carro,Jeepeta,Camioneta', 'tipos sugeridos');
    perform pg_temp.igual(pg_temp.cats('00000000-0000-0000-0000-00000000e6b1'), 'Accesorios,Motores,Pasolas,Repuestos', 'categorías sugeridas');
    insert into sug_resultado values ('A encender', null);
  exception when others then
    insert into sug_resultado values ('A encender', sqlerrm);
  end;
end $$;

-- B. Lo que ya existe, con otras mayúsculas, no se repite.
do $$
begin
  begin
    insert into vehicle_types (company_id, name, position) values ('00000000-0000-0000-0000-00000000e6d0', 'motor', 0);
    insert into product_categories (company_id, branch_id, name) values
      ('00000000-0000-0000-0000-00000000e6d0', '00000000-0000-0000-0000-00000000e6d1', 'REPUESTOS');
    perform pg_temp.encender('00000000-0000-0000-0000-00000000e6d0', 'motoprestamos', true);
    perform pg_temp.igual(pg_temp.tipos('00000000-0000-0000-0000-00000000e6d0'), 'motor,Pasola,Carro,Jeepeta,Camioneta', 'tipos sin repetir');
    perform pg_temp.igual(pg_temp.cats('00000000-0000-0000-0000-00000000e6d1'), 'Accesorios,Motores,Pasolas,REPUESTOS', 'categorías sin repetir');
    insert into sug_resultado values ('B ya existentes', null);
  exception when others then
    insert into sug_resultado values ('B ya existentes', sqlerrm);
  end;
end $$;

-- C. Apagar y volver a encender no duplica.
do $$
begin
  begin
    perform pg_temp.encender('00000000-0000-0000-0000-00000000e6a0', 'motoprestamos', false);
    perform pg_temp.encender('00000000-0000-0000-0000-00000000e6a0', 'motoprestamos', true);
    perform pg_temp.igual(pg_temp.tipos('00000000-0000-0000-0000-00000000e6a0'), 'Motor,Pasola,Carro,Jeepeta,Camioneta', 'tipos tras reencender');
    perform pg_temp.igual(pg_temp.cats('00000000-0000-0000-0000-00000000e6b1'), 'Accesorios,Motores,Pasolas,Repuestos', 'categorías tras reencender');
    insert into sug_resultado values ('C reencender', null);
  exception when others then
    insert into sug_resultado values ('C reencender', sqlerrm);
  end;
end $$;

-- D. Pool de categorías: una vez entre las sucursales del pool; la de fuera recibe las
-- suyas; una sucursal nueva con el módulo encendido también.
do $$
begin
  begin
    -- El pool es solo las filas de branch_sharing (lo que leen la app y las reglas de acceso).
    insert into branch_sharing (company_id, scope, branch_id) values
      ('00000000-0000-0000-0000-00000000e6c0', 'categorias', '00000000-0000-0000-0000-00000000e6c1'),
      ('00000000-0000-0000-0000-00000000e6c0', 'categorias', '00000000-0000-0000-0000-00000000e6c2');
    perform pg_temp.encender('00000000-0000-0000-0000-00000000e6c0', 'motoprestamos', true);
    perform pg_temp.igual(
      (select count(*)::int from product_categories
        where branch_id in ('00000000-0000-0000-0000-00000000e6c1', '00000000-0000-0000-0000-00000000e6c2')),
      4, 'las 4 una sola vez en el pool');
    perform pg_temp.igual(
      (select count(distinct lower(name))::int from product_categories
        where branch_id in ('00000000-0000-0000-0000-00000000e6c1', '00000000-0000-0000-0000-00000000e6c2')),
      4, 'sin repetidas en el pool');
    perform pg_temp.igual(pg_temp.cats('00000000-0000-0000-0000-00000000e6c3'), 'Accesorios,Motores,Pasolas,Repuestos', 'la de fuera del pool');
    insert into branches (id, company_id, name) values
      ('00000000-0000-0000-0000-00000000e6c4', '00000000-0000-0000-0000-00000000e6c0', 'Nueva');
    perform pg_temp.igual(pg_temp.cats('00000000-0000-0000-0000-00000000e6c4'), 'Accesorios,Motores,Pasolas,Repuestos', 'sucursal nueva');
    insert into sug_resultado values ('D pool y sucursal nueva', null);
  exception when others then
    insert into sug_resultado values ('D pool y sucursal nueva', sqlerrm);
  end;
end $$;

-- E. Otro módulo no siembra nada; tampoco una sucursal nueva sin el módulo.
do $$
begin
  begin
    perform pg_temp.encender('00000000-0000-0000-0000-00000000e6e0', 'caja', true);
    perform pg_temp.igual(pg_temp.tipos('00000000-0000-0000-0000-00000000e6e0'), '', 'sin tipos');
    perform pg_temp.igual(pg_temp.cats('00000000-0000-0000-0000-00000000e6e1'), '', 'sin categorías');
    insert into branches (id, company_id, name) values
      ('00000000-0000-0000-0000-00000000e6e2', '00000000-0000-0000-0000-00000000e6e0', 'Nueva E');
    perform pg_temp.igual(pg_temp.cats('00000000-0000-0000-0000-00000000e6e2'), '', 'sucursal nueva sin el módulo');
    insert into sug_resultado values ('E otro módulo', null);
  exception when others then
    insert into sug_resultado values ('E otro módulo', sqlerrm);
  end;
end $$;

-- F. Las funciones de siembra solo las llaman los triggers.
do $$
begin
  begin
    perform pg_temp.igual(has_function_privilege('authenticated', 'public.motos_sembrar_sugerencias(uuid)', 'EXECUTE'), false, 'authenticated y la siembra');
    perform pg_temp.igual(has_function_privilege('authenticated', 'public.motos_sembrar_categorias(uuid)', 'EXECUTE'), false, 'authenticated y las categorías');
    perform pg_temp.igual(has_function_privilege('anon', 'public.motos_sembrar_sugerencias(uuid)', 'EXECUTE'), false, 'anon y la siembra');
    insert into sug_resultado values ('F grants', null);
  exception when others then
    insert into sug_resultado values ('F grants', sqlerrm);
  end;
end $$;

do $$
declare f text;
begin
  select string_agg(caso || ': ' || error, ' | ' order by caso) into f from sug_resultado where error is not null;
  if f is not null then raise exception 'FALLAN: %', f; end if;
  if (select count(*) from sug_resultado) <> 6 then raise exception 'corrieron % casos de 6', (select count(*) from sug_resultado); end if;
end $$;

select 'ok';
