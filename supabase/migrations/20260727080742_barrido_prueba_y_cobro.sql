-- Reescribe el barrido diario. Dos cambios de fondo sobre la version anterior:
--
--   1. Los tramos de aviso ya no estan escritos a mano (eran 3 y 1): salen de
--      platform_settings, que ahora los tiene configurables.
--   2. Ademas de las pruebas por vencer, barre los cobros proximos usando
--      companies.paid_until — la fecha que ya mantiene record_subscription_payment.
--
-- Las claves de deduplicacion incluyen la FECHA objetivo, no solo el tramo. Es
-- lo que permite que al renovar un pago (paid_until se corre un mes) vuelvan a
-- salir los avisos del ciclo nuevo; con una clave fija se habrian bloqueado
-- para siempre despues del primer cobro.

create or replace function public.notificar_ciclo_de_vida()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key           text;
  v_url           text := 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/send-lifecycle-email';
  v_avisos_prueba integer[];
  v_avisos_cobro  integer[];
  r               record;
  n               integer := 0;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then
    raise warning 'notificar_ciclo_de_vida: falta el secreto service_role_key en Vault; no se envio nada.';
    return 0;
  end if;

  select coalesce(trial_reminder_days, '{7,3,1}'),
         coalesce(payment_reminder_days, '{3}')
    into v_avisos_prueba, v_avisos_cobro
    from public.platform_settings limit 1;
  v_avisos_prueba := coalesce(v_avisos_prueba, '{7,3,1}');
  v_avisos_cobro  := coalesce(v_avisos_cobro,  '{3}');

  -- ── Pruebas por vencer / vencidas ────────────────────────────────────────
  for r in
    select distinct on (c.id)
           c.id, c.name, c.trial_ends_at,
           (c.trial_ends_at::date - current_date) as dias,
           p.email, p.name as user_name
      from public.companies c
      join public.profiles  p on p.company_id = c.id
     where c.status::text = 'trial'
       and c.is_demo = false
       and c.trial_ends_at is not null
       and p.role::text = 'admin'
       and p.email is not null
       and p.email_bounced_at is null
       and p.is_active
       and ( (c.trial_ends_at::date - current_date) = any(v_avisos_prueba)
          or (c.trial_ends_at::date - current_date) between -1 and 0 )
     order by c.id, p.created_at
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

  -- ── Cobros proximos ──────────────────────────────────────────────────────
  -- Solo empresas activas con fecha de pago. Las que tienen paid_until en null
  -- (hoy, casi todas) simplemente no entran: no se inventa una fecha.
  for r in
    select distinct on (c.id)
           c.id, c.name, c.paid_until,
           (c.paid_until - current_date) as dias,
           p.email, p.name as user_name
      from public.companies c
      join public.profiles  p on p.company_id = c.id
     where c.status::text = 'active'
       and c.is_demo = false
       and c.paid_until is not null
       and p.role::text = 'admin'
       and p.email is not null
       and p.email_bounced_at is null
       and p.is_active
       and (c.paid_until - current_date) = any(v_avisos_cobro)
     order by c.id, p.created_at
  loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body := jsonb_build_object(
        'template',  'cobro-por-vencer',
        'to',        r.email,
        'companyId', r.id,
        'dedupeKey', r.id::text || ':cobro:' || r.paid_until::text || ':' || r.dias::text || 'd',
        'vars', jsonb_build_object(
          'companyName', r.name, 'userName', r.user_name,
          'paidUntil',   r.paid_until, 'daysLeft', r.dias
        )
      )
    );
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.notificar_ciclo_de_vida() from public, anon, authenticated;
