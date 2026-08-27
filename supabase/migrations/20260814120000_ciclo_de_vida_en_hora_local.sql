-- Dos empresas creadas la noche del 1 de agosto recibieron el correo de "tu
-- prueba terminó" a la mañana siguiente. El barrido hizo lo que le tocaba con
-- la fecha que tenía, pero la contaba mal por dos razones que se arreglan aquí.
--
--   1. La base corre en UTC. El panel guarda la prueba como las 23:59:59 hora
--      de RD, que en UTC es el día SIGUIENTE a las 03:59:59. Entonces
--      trial_ends_at::date daba un día de más y toda la cuenta de días quedaba
--      corrida para cualquier fecha puesta desde /admin/empresas.
--
--   2. Con dias = 0 —el día en que vence, cuando el usuario todavía puede
--      trabajar hasta las 11:59 p.m.— salía 'prueba-vencida'. El aviso de que
--      ya terminó llegaba mientras la cuenta seguía abierta.
--
-- Ahora todo se cuenta contra el calendario dominicano: dias >= 0 es "te queda
-- tiempo" y solo dias < 0 (o sea, al día siguiente) manda el de terminada.
--
-- RD no cambia de hora en todo el año, asi que no hay que preocuparse por el
-- horario de verano al convertir.

create or replace function public.notificar_ciclo_de_vida()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key           text;
  v_url           text := 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/send-lifecycle-email';
  v_tz            text := 'America/Santo_Domingo';
  v_hoy           date;
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

  -- El "hoy" del cliente, no el del servidor. El cron corre 13:00 UTC (9:00 en
  -- RD) y a esa hora coinciden, pero si el job se corre a mano de noche no.
  v_hoy := (now() at time zone v_tz)::date;

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
           (c.trial_ends_at at time zone v_tz)::date as fin_local,
           ((c.trial_ends_at at time zone v_tz)::date - v_hoy) as dias,
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
       and ( ((c.trial_ends_at at time zone v_tz)::date - v_hoy) = any(v_avisos_prueba)
          or ((c.trial_ends_at at time zone v_tz)::date - v_hoy) between -1 and 0 )
     order by c.id, p.created_at
  loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body := jsonb_build_object(
        -- El dia que vence todavia es "por vencer": el corte es a medianoche.
        'template',  case when r.dias >= 0 then 'prueba-por-vencer' else 'prueba-vencida' end,
        'to',        r.email,
        'companyId', r.id,
        'dedupeKey', r.id::text || ':prueba:' || r.fin_local::text || ':' ||
                     case when r.dias >= 0 then r.dias::text || 'd' else 'vencida' end,
        'vars', jsonb_build_object(
          'companyName', r.name, 'userName', r.user_name,
          'trialEndsAt', r.trial_ends_at, 'daysLeft', r.dias
        )
      )
    );
    n := n + 1;
  end loop;

  -- ── Cobros proximos ──────────────────────────────────────────────────────
  -- paid_until ya es date (sin hora), pero se compara contra el mismo v_hoy
  -- local para que no dependa de a que hora se corra el barrido.
  for r in
    select distinct on (c.id)
           c.id, c.name, c.paid_until,
           (c.paid_until - v_hoy) as dias,
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
       and (c.paid_until - v_hoy) = any(v_avisos_cobro)
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

comment on function public.notificar_ciclo_de_vida() is
  'Barrido diario de pruebas y cobros, contado sobre el calendario de RD. Idempotente: send-lifecycle-email descarta lo ya enviado via platform_email_log.';

revoke all on function public.notificar_ciclo_de_vida() from public, anon, authenticated;
