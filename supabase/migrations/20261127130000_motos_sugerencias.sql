-- Motopréstamos: sugerencias de tipos de vehículo y categorías al encender el módulo.
-- Diseño: docs/superpowers/specs/2026-11-26-motoprestamos-sugerencias-design.md
-- Plan:   docs/superpowers/plans/2026-11-26-motoprestamos-sugerencias.md (Task 1)
--
-- No cambia ninguna función viva. Solo carga lo que falta (sin importar mayúsculas):
-- apagar y volver a encender no duplica. Pruebas: supabase/tests/motos_sugerencias.sql

-- 1. Categorías sugeridas de una sucursal ------------------------------------------------------
-- No repite una categoría que ya esté en la sucursal ni, si comparte categorías en un
-- pool, en otra sucursal del pool (ahí se ven juntas).

create or replace function public.motos_sembrar_categorias(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_pool    uuid[];
  v_nombre  text;
begin
  select company_id into v_company from public.branches where id = p_branch_id;
  if v_company is null then
    return;
  end if;

  -- Sucursales donde la categoría se vería: la propia y, con el pool encendido, las del pool.
  v_pool := array[p_branch_id];
  if exists (select 1 from public.company_branch_sharing
              where company_id = v_company and scope = 'categorias' and enabled)
     and exists (select 1 from public.branch_sharing
                  where company_id = v_company and scope = 'categorias' and branch_id = p_branch_id) then
    v_pool := v_pool || array(select branch_id from public.branch_sharing
                               where company_id = v_company and scope = 'categorias' and branch_id <> p_branch_id);
  end if;

  foreach v_nombre in array array['Motores', 'Pasolas', 'Repuestos', 'Accesorios'] loop
    if not exists (select 1 from public.product_categories
                    where branch_id = any (v_pool) and lower(btrim(name)) = lower(v_nombre)) then
      insert into public.product_categories (company_id, branch_id, name)
      values (v_company, p_branch_id, v_nombre);
    end if;
  end loop;
end;
$$;

-- 2. Tipos de vehículo y categorías de toda la empresa -----------------------------------------

create or replace function public.motos_sembrar_sugerencias(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre   text;
  v_posicion int;
  v_branch   uuid;
begin
  select coalesce(max(position), -1) into v_posicion from public.vehicle_types where company_id = p_company_id;
  foreach v_nombre in array array['Motor', 'Pasola', 'Carro', 'Jeepeta', 'Camioneta'] loop
    if not exists (select 1 from public.vehicle_types
                    where company_id = p_company_id and lower(btrim(name)) = lower(v_nombre)) then
      v_posicion := v_posicion + 1;
      insert into public.vehicle_types (company_id, name, position)
      values (p_company_id, v_nombre, v_posicion);
    end if;
  end loop;

  for v_branch in select id from public.branches where company_id = p_company_id order by created_at, id loop
    perform public.motos_sembrar_categorias(v_branch);
  end loop;
end;
$$;

-- 3. Triggers ------------------------------------------------------------------------------------
-- Al quedar encendido el módulo (venga del panel o del alta con el rubro) y en cada sucursal
-- nueva de una empresa que ya lo tiene encendido.

create or replace function public.motos_sugerencias_al_encender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.module_key = 'motoprestamos' and new.enabled
     and (tg_op = 'INSERT' or old.enabled is distinct from true) then
    perform public.motos_sembrar_sugerencias(new.company_id);
  end if;
  return null;
end;
$$;

create trigger trg_motos_sugerencias
  after insert or update of enabled on public.company_modules
  for each row execute function public.motos_sugerencias_al_encender();

create or replace function public.motos_sugerencias_sucursal_nueva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_module_enabled(new.company_id, 'motoprestamos', false) then
    perform public.motos_sembrar_categorias(new.id);
  end if;
  return null;
end;
$$;

create trigger trg_motos_sugerencias_sucursal
  after insert on public.branches
  for each row execute function public.motos_sugerencias_sucursal_nueva();

-- 4. Grants: solo los triggers las llaman --------------------------------------------------------

revoke execute on function public.motos_sembrar_categorias(uuid) from public, anon, authenticated;
revoke execute on function public.motos_sembrar_sugerencias(uuid) from public, anon, authenticated;
revoke execute on function public.motos_sugerencias_al_encender() from public, anon, authenticated;
revoke execute on function public.motos_sugerencias_sucursal_nueva() from public, anon, authenticated;
grant execute on function public.motos_sembrar_categorias(uuid) to service_role;
grant execute on function public.motos_sembrar_sugerencias(uuid) to service_role;
grant execute on function public.motos_sugerencias_al_encender() to service_role;
grant execute on function public.motos_sugerencias_sucursal_nueva() to service_role;
