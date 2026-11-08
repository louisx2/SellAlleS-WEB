-- e-CF: vender no vuelve a probar una contraseña que MSeller rechazó.
--
-- Cuando MSeller rechaza el inicio de sesión de una empresa, el lote del cron
-- pospone 30 minutos lo que espera de ella (ecf_posponer_por_credenciales).
-- Pero cada venta nueva nace lista para salir y el punto de venta la manda en
-- el acto: con la contraseña mala, cada venta era otro inicio de sesión
-- fallido, y a fuerza de intentos la cuenta se puede bloquear.
--
-- Ahora el rechazo queda marcado en la cuenta (ecf_credenciales.rechazadas_hasta)
-- y lo que nace mientras dura la marca nace pospuesto hasta entonces: la
-- reserva del punto de venta no lo toma y la venta sale "en proceso". La marca
-- se va sola a los 30 minutos, al cambiar las credenciales o al iniciar sesión
-- bien. Va con el cambio de ecf-emitir que también pospone desde el punto de
-- venta (antes solo lo hacía el lote).

-- ---------------------------------------------------------------------------
-- 1. La marca
-- ---------------------------------------------------------------------------
alter table public.ecf_credenciales
  add column if not exists rechazadas_hasta timestamptz;

comment on column public.ecf_credenciales.rechazadas_hasta is
  'MSeller rechazó estas credenciales: hasta esta hora no se vuelve a probar el inicio de sesión. La pone ecf_posponer_por_credenciales; se borra al cambiar las credenciales o al iniciar sesión bien.';

-- ---------------------------------------------------------------------------
-- 2. Posponer también marca la cuenta
-- ---------------------------------------------------------------------------
-- Parte de su versión de 20261030180000_ecf_ajustes_revision_final.sql. Lo nuevo
-- es el primer update.
create or replace function public.ecf_posponer_por_credenciales(p_company uuid, p_ambiente text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ecf_credenciales
     set rechazadas_hasta = now() + interval '30 minutes'
   where company_id = p_company
     and ambiente = p_ambiente;

  update public.ecf_documentos
     set proximo_intento_at = now() + interval '30 minutes',
         ultimo_error       = 'MSeller rechazó las credenciales de la empresa.',
         updated_at         = now()
   where company_id = p_company
     and ambiente = p_ambiente
     and estado = 'por_enviar';
$$;

comment on function public.ecf_posponer_por_credenciales(uuid, text) is
  'Servidor: MSeller rechazó las credenciales de la empresa en ese ambiente. Marca la cuenta y pospone 30 minutos lo que espera.';

revoke execute on function public.ecf_posponer_por_credenciales(uuid, text) from public, anon, authenticated;
grant execute on function public.ecf_posponer_por_credenciales(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. La marca se borra al cambiar las credenciales o al iniciar sesión bien
-- ---------------------------------------------------------------------------
-- Credenciales nuevas: ecf_guardar_credenciales cambia el correo o los secretos
-- (y ya suelta lo que esperaba). Sesión nueva: ecf_guardar_sesion guarda otro
-- idToken, señal de que MSeller volvió a aceptar la cuenta.
create or replace function public.ecf_credenciales_limpiar_rechazo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.email is distinct from old.email
     or new.password_secret_id is distinct from old.password_secret_id
     or new.api_key_secret_id is distinct from old.api_key_secret_id
     or (new.id_token is not null and new.id_token is distinct from old.id_token) then
    new.rechazadas_hasta := null;
  end if;
  return new;
end $$;

revoke all on function public.ecf_credenciales_limpiar_rechazo() from public, anon, authenticated;

drop trigger if exists ecf_credenciales_limpiar_rechazo on public.ecf_credenciales;
create trigger ecf_credenciales_limpiar_rechazo
  before update on public.ecf_credenciales
  for each row execute function public.ecf_credenciales_limpiar_rechazo();

-- ---------------------------------------------------------------------------
-- 4. Lo que nace mientras dura la marca nace pospuesto
-- ---------------------------------------------------------------------------
-- security definer: los documentos los insertan las funciones de la venta y de
-- la anulación, y ecf_credenciales no se deja leer más que por el servidor.
create or replace function public.ecf_documentos_esperar_credenciales()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hasta timestamptz;
begin
  if new.estado is distinct from 'por_enviar' then
    return new;
  end if;

  select c.rechazadas_hasta into v_hasta
    from public.ecf_credenciales c
   where c.company_id = new.company_id
     and c.ambiente = new.ambiente
     and c.rechazadas_hasta > now();

  if v_hasta is not null then
    new.proximo_intento_at := greatest(coalesce(new.proximo_intento_at, now()), v_hasta);
    new.ultimo_error := coalesce(new.ultimo_error, 'MSeller rechazó las credenciales de la empresa.');
  end if;
  return new;
end $$;

revoke all on function public.ecf_documentos_esperar_credenciales() from public, anon, authenticated;

drop trigger if exists ecf_documentos_esperar_credenciales on public.ecf_documentos;
create trigger ecf_documentos_esperar_credenciales
  before insert on public.ecf_documentos
  for each row execute function public.ecf_documentos_esperar_credenciales();
