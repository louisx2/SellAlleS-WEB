-- Registro de los correos transaccionales que manda la plataforma (no los de
-- las empresas a sus clientes). Existe por dos razones concretas:
--
--   1. Deduplicación. Un aviso de "tu prueba vence en 3 días" no puede salir
--      dos veces porque el job corrió dos veces o alguien lo disparó a mano.
--      La clave única (template, dedupe_key) es lo que lo garantiza, y es más
--      confiable que consultar "¿ya mandé algo parecido hoy?".
--
--   2. Vigilar el tope del plan Free de Resend: 100 correos por día y 3.000 al
--      mes. Sin registro no hay forma de saber cuánto falta para chocar.

create type public.platform_email_template as enum (
  'bienvenida',
  'prueba-por-vencer',
  'prueba-vencida',
  'cuenta-activada',
  'recibo-suscripcion'
);

create table public.platform_email_log (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete set null,
  template        public.platform_email_template not null,
  to_email        text not null,
  -- Identifica el envío concreto dentro de la plantilla. Incluye el id de la
  -- empresa porque company_id puede quedar en null si la empresa se borra, y
  -- un null no sirve para deduplicar (en un índice único los null no chocan).
  -- Ej: '<uuid-empresa>:3d' para el aviso de 3 días antes del vencimiento.
  dedupe_key      text not null,
  resend_email_id text,
  status          text not null default 'sent'
                    check (status in ('sent', 'failed', 'bounced', 'complained')),
  error           text,
  created_at      timestamptz not null default now()
);

-- El corazón de la idempotencia: reintentar un envío ya hecho choca aquí.
create unique index platform_email_log_dedupe_idx
  on public.platform_email_log (template, dedupe_key);

-- Para contar los envíos del día contra el tope del plan.
create index platform_email_log_fecha_idx on public.platform_email_log (created_at desc);

create index platform_email_log_company_idx
  on public.platform_email_log (company_id, created_at desc);

comment on table public.platform_email_log is
  'Correos transaccionales de la plataforma. La clave unica (template, dedupe_key) impide reenviar el mismo aviso; created_at permite vigilar el tope diario de Resend.';

-- ── Rebotes ────────────────────────────────────────────────────────────────
-- Seguir mandando a una dirección que rebota quema la reputación del dominio y
-- termina afectando la entrega de TODOS los correos, incluidos los de auth.
alter table public.profiles add column email_bounced_at timestamptz;

comment on column public.profiles.email_bounced_at is
  'Fecha del ultimo rebote duro o queja de spam. Si no es null, la plataforma deja de enviarle correos de ciclo de vida.';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Solo lectura y solo para el super admin: es un registro operativo de la
-- plataforma, no del tenant. Escribe únicamente la Edge Function con service
-- role, que salta RLS.

alter table public.platform_email_log enable row level security;

create policy platform_email_log_select on public.platform_email_log for select
  to authenticated
  using (is_super_admin());

revoke insert, update, delete on public.platform_email_log from anon, authenticated;
revoke select on public.platform_email_log from anon;
