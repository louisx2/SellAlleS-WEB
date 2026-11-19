-- Tickets de soporte de la plataforma. Dos orígenes:
--   'email' → un correo a soporte@sellalles.com que entra por el webhook de
--             Resend (Edge Function support-inbound).
--   'app'   → el usuario abre la solicitud desde el botón de Soporte.
-- Ambos terminan en la misma bandeja de /admin/soporte, con un hilo de mensajes
-- por ticket, y se responden por correo.

create type public.support_ticket_status    as enum ('open', 'pending', 'closed');
create type public.support_ticket_priority  as enum ('low', 'normal', 'high');
create type public.support_ticket_source    as enum ('app', 'email');
create type public.support_message_direction as enum ('inbound', 'outbound');

-- El código va en el asunto del correo como [SA-00001]. Es lo que permite
-- enhebrar la respuesta del cliente con el ticket existente, así que debe ser
-- corto, estable y único. Una secuencia lo garantiza sin colisiones.
create sequence public.support_ticket_code_seq;

create table public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique
                    default 'SA-' || lpad(nextval('public.support_ticket_code_seq')::text, 5, '0'),
  -- null = escribió alguien que no reconocemos como usuario de ninguna empresa
  -- (un prospecto, o un correo desde otra dirección). No se descarta: se
  -- atiende igual desde el panel.
  company_id      uuid references public.companies(id) on delete set null,
  created_by      uuid references public.profiles(id)  on delete set null,
  contact_email   text not null,
  contact_name    text,
  subject         text not null,
  status          public.support_ticket_status   not null default 'open',
  priority        public.support_ticket_priority not null default 'normal',
  source          public.support_ticket_source   not null,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create index support_tickets_bandeja_idx  on public.support_tickets (status, last_message_at desc);
create index support_tickets_company_idx  on public.support_tickets (company_id, created_at desc);

create table public.support_messages (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references public.support_tickets(id) on delete cascade,
  direction         public.support_message_direction not null,
  -- Quién respondió desde la plataforma (null en los mensajes entrantes).
  author_profile_id uuid references public.profiles(id) on delete set null,
  from_email        text,
  body_text         text,
  body_html         text,
  -- Id del correo en Resend (recibido o enviado). Es la llave de idempotencia:
  -- los webhooks se reintentan y no debe duplicarse el mensaje. Null en los
  -- mensajes creados desde la app, y en Postgres los null no chocan entre sí.
  resend_email_id   text unique,
  created_at        timestamptz not null default now()
);

create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- Mantiene ordenada la bandeja: el ticket sube al recibir cualquier mensaje.
create or replace function public.support_touch_ticket()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.support_tickets
     set last_message_at = new.created_at
   where id = new.ticket_id;
  return new;
end;
$$;

create trigger support_messages_touch_ticket
  after insert on public.support_messages
  for each row execute function public.support_touch_ticket();

revoke all on function public.support_touch_ticket() from public, anon, authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Lectura: el usuario ve los tickets de sus empresas; el super admin ve todo,
-- incluidos los huérfanos (company_id null). Mismo criterio que branches_select,
-- para que impersonar siga funcionando igual que en el resto de la app.
-- Escritura: NINGUNA policy. Los tickets se crean y responden solo por las Edge
-- Functions (service role, que salta RLS), nunca directo desde el cliente.

alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

create policy support_tickets_select on public.support_tickets for select
  to authenticated
  using (
    company_id = current_company_id()
    or company_id in (select public.user_company_ids())
    or is_super_admin()
  );

create policy support_messages_select on public.support_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
       where t.id = support_messages.ticket_id
         and (
           t.company_id = current_company_id()
           or t.company_id in (select public.user_company_ids())
           or is_super_admin()
         )
    )
  );

-- Supabase concede insert/update/delete por defecto a anon y authenticated en
-- public: sin quitarlos, la única barrera sería la ausencia de policy. Se
-- revocan para no depender de eso.
revoke insert, update, delete on public.support_tickets  from anon, authenticated;
revoke insert, update, delete on public.support_messages from anon, authenticated;
revoke select on public.support_tickets  from anon;
revoke select on public.support_messages from anon;
revoke all on sequence public.support_ticket_code_seq from anon, authenticated;
