-- Los roles ya no son decorativos: desde que `permissions` gobierna acceso real
-- (menu y paginas), escribir en `roles` es escribir permisos. La politica
-- roles_all dejaba ESCRIBIR a cualquier miembro de la empresa, asi que un
-- cajero podia darse a si mismo Reportes, Inventario o Usuarios con una
-- llamada a la API - la UI se lo escondia, nada mas.
--
-- Se separa en dos: leer lo puede hacer cualquier miembro (la app necesita los
-- permisos del rol para pintar el menu), escribir solo el admin de la empresa
-- o el super admin. Coincide con quien puede llegar a la pantalla de Roles.

drop policy if exists roles_all on public.roles;

create policy roles_select on public.roles
  for select
  using (company_id = current_company_id() or is_super_admin());

create policy roles_insert on public.roles
  for insert
  with check (((company_id = current_company_id()) and is_company_admin()) or is_super_admin());

create policy roles_update on public.roles
  for update
  using (((company_id = current_company_id()) and is_company_admin()) or is_super_admin())
  with check (((company_id = current_company_id()) and is_company_admin()) or is_super_admin());

-- Borrar un rol de sistema (Administrador/Cajero) dejaria a toda su gente sin
-- permisos y sin forma de recuperarlos desde la app, asi que no se borra ni
-- siendo admin. Los personalizados si.
create policy roles_delete on public.roles
  for delete
  using (
    is_system is not true
    and (((company_id = current_company_id()) and is_company_admin()) or is_super_admin())
  );
