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
create function pg_temp.preparar_cajero() returns void language sql as $$
  insert into profile_companies (profile_id, company_id, role)
  values ('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa', 'cashier')
  on conflict do nothing;
  update profiles set company_id = '00000000-0000-0000-0000-0000000000aa'
   where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
  insert into profile_branches (profile_id, company_id, branch_id, role_id)
  values ('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-0000000000b1', 'd7bb7626-3aa0-4f4b-9b1b-eb61264a4b04')
  on conflict do nothing;
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

select 'ok' as resultado;
