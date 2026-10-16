-- Barrido diario que avisa a las empresas cuya prueba está por vencer o ya
-- venció. Llama a la Edge Function send-lifecycle-email, que es la que decide
-- si el correo realmente sale (deduplicación, rebotes, tope diario). Por eso
-- esta función puede correr de más sin causar daño: repetirla no reenvía nada.
--
-- La service role key sale de Vault y NO se escribe en el comando del cron.
-- El job 'send-due-installment-reminders' que ya existía la lleva incrustada en
-- cron.job; conviene migrarlo a este mismo esquema mas adelante.
-- Requisito, una sola vez:
--   select vault.create_secret('<service_role_key>', 'service_role_key');
-- Sin ese secreto la función no envía nada y lo deja dicho en los logs, en vez
-- de fallar a medias.

create or replace function public.notificar_ciclo_de_vida()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key   text;
  v_url   text := 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/send-lifecycle-email';
  r       record;
  n       integer := 0;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  if v_key is null then
    raise warning 'notificar_ciclo_de_vida: falta el secreto service_role_key en Vault; no se envio nada.';
    return 0;
  end if;

  -- Un solo destinatario por empresa: el administrador. Con varios admins, la
  -- clave de deduplicacion evitaria los duplicados igual, pero se gastarian
  -- llamadas de mas contra el tope diario.
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
       -- 3 dias antes, 1 dia antes, y el dia que vence o el siguiente
       and (c.trial_ends_at::date - current_date) between -1 and 3
     order by c.id, p.created_at
  loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'template',  case when r.dias > 0 then 'prueba-por-vencer' else 'prueba-vencida' end,
        'to',        r.email,
        'companyId', r.id,
        -- La clave incluye el tramo (3d, 1d, vencida) para que se pueda mandar
        -- el aviso de 3 dias y despues el de 1 dia, pero ninguno dos veces.
        'dedupeKey', r.id::text || ':' ||
                     case when r.dias > 0 then r.dias::text || 'd' else 'vencida' end,
        'vars', jsonb_build_object(
          'companyName',  r.name,
          'userName',     r.user_name,
          'trialEndsAt',  r.trial_ends_at,
          'daysLeft',     r.dias
        )
      )
    );
    n := n + 1;
  end loop;

  return n;
end;
$$;

comment on function public.notificar_ciclo_de_vida() is
  'Barrido diario de pruebas por vencer/vencidas. Idempotente: send-lifecycle-email descarta lo ya enviado via platform_email_log.';

-- Nadie la ejecuta desde el cliente: solo pg_cron (que corre como postgres).
revoke all on function public.notificar_ciclo_de_vida() from public, anon, authenticated;

-- 13:00 UTC = 9:00 a.m. en RD, misma hora que el job de recordatorios de cuotas.
select cron.schedule(
  'notificar-ciclo-de-vida',
  '0 13 * * *',
  $cron$ select public.notificar_ciclo_de_vida(); $cron$
);
