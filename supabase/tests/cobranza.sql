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

select 'ok';
