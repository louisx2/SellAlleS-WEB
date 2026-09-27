-- Dueños del negocio.
--
-- Hasta ahora en una empresa solo había administradores y cajeros, y el aviso
-- de cuotas (y los correos de cobro) le llegaba a cualquier admin. Lo que se
-- debe y cómo pagarlo es asunto del dueño: un encargado con permisos de admin
-- no tiene por qué verlo en cada pantalla.
--
-- - profile_companies.es_dueno marca a los dueños (puede haber más de uno:
--   socios). Solo un administrador de la empresa puede serlo.
-- - Quien crea la empresa queda como dueño: el primer admin de una empresa sin
--   dueño lo es solo.
-- - Solo el super admin lo cambia (o un proceso del sistema).
-- - Las empresas que ya existen: el primer admin de cada una (si entraron
--   varios en el mismo instante, todos).
-- - Los correos de cobro y de prueba van al dueño; sin dueño, al primer admin.

alter table public.profile_companies
  add column es_dueno boolean not null default false;

comment on column public.profile_companies.es_dueno is
  'Dueño del negocio: ve el aviso de cuotas y le llegan los correos de cobro. Solo lo cambia el super admin.';

update public.profile_companies pc
   set es_dueno = true
 where pc.role::text = 'admin'
   and pc.created_at = (
     select min(x.created_at) from public.profile_companies x
      where x.company_id = pc.company_id and x.role::text = 'admin'
   );

create or replace function public.proteger_es_dueno()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_puede boolean := auth.uid() is null or public.is_platform_super_admin();
begin
  if tg_op = 'INSERT' then
    if new.es_dueno and not v_puede then
      new.es_dueno := false;
    end if;
    -- El que crea la empresa es su primer admin: queda como dueño.
    if not new.es_dueno and new.role::text = 'admin' and not exists (
      select 1 from public.profile_companies
       where company_id = new.company_id and es_dueno
    ) then
      new.es_dueno := true;
    end if;
  elsif new.es_dueno is distinct from old.es_dueno and not v_puede then
    new.es_dueno := old.es_dueno;
  end if;

  -- Un cajero no puede ser dueño: si le bajan el rol, deja de serlo.
  if new.role::text <> 'admin' then
    new.es_dueno := false;
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_es_dueno() from public, anon, authenticated;

create trigger trg_proteger_es_dueno
  before insert or update on public.profile_companies
  for each row execute function public.proteger_es_dueno();

-- A quién escribirle por la cuenta de una empresa: sus dueños primero, y si
-- no tiene (o no tienen correo), el admin más antiguo. Entra quien es admin
-- por profile_companies aunque su empresa principal sea otra (Wailin está en
-- Pujols Group y en Michelle), y los perfiles viejos que solo tienen
-- profiles.company_id. Al super admin no se le escribe.
create or replace function public._contacto_de_cobro(p_company_id uuid)
returns table (email text, user_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.email, p.name
    from public.profiles p
    left join public.profile_companies pc
      on pc.profile_id = p.id and pc.company_id = p_company_id
   where p.email is not null
     and p.email_bounced_at is null
     and p.is_active
     and not coalesce(p.is_super_admin, false)
     and ( pc.role::text = 'admin'
           or (pc.profile_id is null and p.company_id = p_company_id and p.role::text = 'admin') )
   order by coalesce(pc.es_dueno, false) desc, coalesce(pc.created_at, p.created_at)
   limit 1;
$$;

revoke all on function public._contacto_de_cobro(uuid) from public, anon, authenticated;

-- Igual que en 20260926022410_cobros_comprobantes_y_avisos, cambiando solo a
-- quién se le escribe: _contacto_de_cobro en vez del admin más antiguo cuya
-- empresa principal es esta.
create or replace function public.notificar_ciclo_de_vida()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key           text;
  v_url           text := 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/send-lifecycle-email';
  v_avisos_prueba integer[];
  v_avisos_cobro  integer[];
  v_bancos        jsonb := public._cuentas_bancarias_json();
  v_cobros_activos boolean;
  r               record;
  v_cuenta        jsonb;
  v_dias          integer;
  v_monto         numeric;
  n               integer := 0;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then
    raise warning 'notificar_ciclo_de_vida: falta el secreto service_role_key en Vault; no se envio nada.';
    return 0;
  end if;

  select coalesce(trial_reminder_days, '{7,3,1}'),
         coalesce(payment_reminder_days, '{3}'),
         avisos_cobro_activos
    into v_avisos_prueba, v_avisos_cobro, v_cobros_activos
    from public.platform_settings limit 1;
  v_avisos_prueba := coalesce(v_avisos_prueba, '{7,3,1}');
  v_avisos_cobro  := coalesce(v_avisos_cobro,  '{3}');

  for r in
    select c.id, c.name, c.trial_ends_at,
           (c.trial_ends_at::date - company_today(c.id)) as dias,
           d.email, d.user_name
      from public.companies c
     cross join lateral public._contacto_de_cobro(c.id) d
     where c.status::text = 'trial'
       and c.is_demo = false
       and c.trial_ends_at is not null
       and ( (c.trial_ends_at::date - company_today(c.id)) = any(v_avisos_prueba)
          or (c.trial_ends_at::date - company_today(c.id)) between -1 and 0 )
  loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body := jsonb_build_object(
        'template',  case when r.dias > 0 then 'prueba-por-vencer' else 'prueba-vencida' end,
        'to',        r.email,
        'companyId', r.id,
        'dedupeKey', r.id::text || ':prueba:' || r.trial_ends_at::date::text || ':' ||
                     case when r.dias > 0 then r.dias::text || 'd' else 'vencida' end,
        'vars', jsonb_build_object(
          'companyName', r.name, 'userName', r.user_name,
          'trialEndsAt', r.trial_ends_at, 'daysLeft', r.dias
        )
      )
    );
    n := n + 1;
  end loop;

  -- Cuotas: N días antes (payment_reminder_days) y el día que vence una sin
  -- pagar. A quien ya subió un comprobante que está por confirmar no se le
  -- insiste. Solo si el super admin encendió los avisos de cobro.
  if not coalesce(v_cobros_activos, false) then
    return n;
  end if;

  for r in
    select c.id, c.name, d.email, d.user_name
      from public.companies c
     cross join lateral public._contacto_de_cobro(c.id) d
     where c.status::text = 'active'
       and c.is_demo = false
  loop
    v_cuenta := public._cuenta_de_suscripcion(r.id);
    continue when v_cuenta is null
               or (v_cuenta ->> 'comprobantes_por_confirmar')::integer > 0;

    if v_cuenta ->> 'estado' in ('al_dia', 'por_vencer') then
      v_dias := (v_cuenta ->> 'dias')::integer;
      continue when not (v_dias = any(v_avisos_cobro));
      select coalesce(sum((e ->> 'cuota')::numeric), 0) into v_monto
        from jsonb_array_elements(v_cuenta -> 'cuentas') e
       where (e ->> 'proxima_cuota') = (v_cuenta ->> 'proximo_cobro');
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
        body := jsonb_build_object(
          'template',  'cobro-por-vencer',
          'to',        r.email,
          'companyId', r.id,
          'dedupeKey', r.id::text || ':cuota:' || (v_cuenta ->> 'proximo_cobro') || ':' || v_dias::text || 'd',
          'vars', jsonb_build_object(
            'companyName', r.name, 'userName', r.user_name,
            'dueDate', v_cuenta ->> 'proximo_cobro', 'daysLeft', v_dias,
            'amount', nullif(v_monto, 0), 'bankAccounts', v_bancos
          )
        )
      );
      n := n + 1;
    elsif v_cuenta ->> 'estado' in ('atrasada', 'nunca_pago')
          and (v_cuenta ->> 'cargos_hoy')::integer > 0 then
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
        body := jsonb_build_object(
          'template',  'cuota-vencida',
          'to',        r.email,
          'companyId', r.id,
          'dedupeKey', r.id::text || ':cuota-vencida:' || (v_cuenta ->> 'hoy'),
          'vars', jsonb_build_object(
            'companyName', r.name, 'userName', r.user_name,
            'saldo', v_cuenta ->> 'saldo', 'cuotasPendientes', v_cuenta ->> 'cuotas_pendientes',
            'debeDesde', v_cuenta ->> 'debe_desde', 'bankAccounts', v_bancos
          )
        )
      );
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$function$;
