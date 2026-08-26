-- Ultima pieza que faltaba: Pujols Group tenia company_modules.caja = false
-- (se apago para poder importar las facturas en efectivo del sistema viejo) y
-- nunca se volvio a encender. Con el modulo apagado:
--   - NADIE veia el menu de Caja, ni el admin;
--   - la fila "Caja" no salia en el editor de roles, asi que no habia forma de
--     dar ni quitar ese permiso;
--   - las banderas caja_enabled de Delmas Principal y R.A no hacian nada.
-- Delmas Principal lleva 20 sesiones de caja y tenia una abierta, asi que la
-- empresa si usa caja: lo raro era el interruptor, no el uso.
--
-- Aplicar DESPUES de desplegar la web (el checkout viejo bloqueaba el efectivo
-- mirando solo el modulo, sin la bandera de sucursal).

insert into public.company_modules (company_id, module_key, enabled)
values ('4b3b00e8-ef6b-4fe2-8d32-3489c73ac099', 'caja', true)
on conflict (company_id, module_key) do update set enabled = true;

-- El rol "Gerente" se creo antes de que Caja fuera un recurso de permisos, asi
-- que no tiene la clave. Como el rol de sucursal SUSTITUYE al de sistema (no
-- suma), el gerente de Delmas se quedaba sin Caja mientras sus propios cajeros
-- si la tienen: el rango superior podia menos que el cajero.
update public.roles
   set permissions = permissions || '{"caja": ["view","create","edit","delete"]}'::jsonb
 where id = '9d37aa50-4499-4c7f-be29-be71eef9c850'
   and not (permissions ? 'caja');
