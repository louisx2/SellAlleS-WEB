-- Ajustes globales del SaaS (no del tenant): canales de contacto de soporte.
create table public.platform_settings (
  id                       boolean primary key default true check (id),
  support_whatsapp_enabled boolean not null default true,
  support_whatsapp_number  text check (support_whatsapp_number ~ '^[0-9]{8,15}$'),
  support_whatsapp_label   text,
  support_email_enabled    boolean not null default true,
  support_email            text check (support_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  support_hours            text,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.profiles(id)
);

comment on table public.platform_settings is
  'Ajustes globales del SaaS, una sola fila. Legible por anon a proposito: la landing es un export estatico y consulta sin sesion. Solo datos de contacto publicos - NO agregar campos sensibles aqui.';

insert into public.platform_settings (
  id, support_whatsapp_enabled, support_whatsapp_number, support_whatsapp_label,
  support_email_enabled, support_email, support_hours
) values (
  true, true, '18299333226', '829-933-3226',
  true, 'soporte@sellalles.com', 'Lunes a viernes, 8:00 a.m. a 6:00 p.m.'
);

alter table public.platform_settings enable row level security;

create policy platform_settings_select on public.platform_settings for select
  to anon, authenticated
  using (true);

create policy platform_settings_update on public.platform_settings for update
  to authenticated
  using (public.is_platform_super_admin())
  with check (public.is_platform_super_admin());

revoke insert, update, delete on public.platform_settings from anon;
revoke insert, delete on public.platform_settings from authenticated;

create or replace function public.platform_settings_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.id := true;
  return new;
end;
$$;

create trigger platform_settings_touch
  before update on public.platform_settings
  for each row execute function public.platform_settings_touch();

revoke all on function public.platform_settings_touch() from public, anon, authenticated;
