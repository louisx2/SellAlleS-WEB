-- Un técnico sin "ver todos" no podía pasarle su caso a otro: en un UPDATE con
-- WHERE, Postgres exige que la fila NUEVA también pase la política de SELECT, y
-- un caso asignado a otro técnico ya no lo ve ("new row violates row-level
-- security policy"). Se encontró probando con un rol de técnico en Pujols.
--
-- La función pasa a SECURITY DEFINER y comprueba ella misma, ANTES del cambio,
-- lo mismo que la RLS: que el caso sea de su empresa y sucursal, que lo vea y que
-- su rol pueda editar en el taller. Después ya no necesita verlo.
create or replace function public.taller_asignar(
  p_service_id uuid, p_profile_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_srv public.services%rowtype;
begin
  select * into v_srv from public.services where id = p_service_id;
  if not found or not (
       public.is_super_admin()
       or (v_srv.company_id = public.current_company_id()
           and (public.is_company_admin()
                or v_srv.branch_id in (select public.user_branch_ids())
                or public.branch_shares_with_me('servicios', v_srv.branch_id))
           and public.taller_ve_caso(v_srv.branch_id, v_srv.assigned_to, v_srv.received_by))
     ) then
    raise exception 'Caso no encontrado.';
  end if;

  if not public.taller_tiene_permiso(v_srv.branch_id, 'services', 'edit') then
    raise exception 'Tu rol no permite cambiar casos del taller.';
  end if;

  if p_profile_id is not null and not exists (
    select 1 from public.service_technicians
     where branch_id = v_srv.branch_id and profile_id = p_profile_id
  ) then
    raise exception 'Esa persona no está en la lista de técnicos de esta sucursal.';
  end if;

  perform set_config('taller.nota', coalesce(p_note, ''), true);
  update public.services set assigned_to = p_profile_id where id = p_service_id;
end;
$$;

revoke execute on function public.taller_asignar(uuid, uuid, text) from public, anon;
grant execute on function public.taller_asignar(uuid, uuid, text) to authenticated, service_role;
