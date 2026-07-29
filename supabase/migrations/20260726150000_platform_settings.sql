-- Ajustes globales del SaaS (no del tenant): canales de contacto de soporte.
-- Nacen para sacar del código el número de WhatsApp 829-933-3226, que estaba
-- repetido en 4 archivos de dos apps distintas y solo se podía cambiar
-- redesplegando. Ahora se editan desde Administrar > Configuración de la
-- Plataforma, y cada canal se puede apagar sin dejar botones rotos.

-- ── Tabla singleton ────────────────────────────────────────────────────────
-- El pk booleano con check(id) permite una sola fila: un segundo insert choca
-- contra la clave primaria.

create table public.platform_settings (
  id                       boolean primary key default true check (id),
  support_whatsapp_enabled boolean not null default true,
  -- Solo dígitos, en el formato que espera wa.me (código de país + número, sin
  -- '+', guiones ni espacios). El constraint evita que un enlace quede roto.
  support_whatsapp_number  text check (support_whatsapp_number ~ '^[0-9]{8,15}$'),
  -- Cómo se muestra al usuario ('829-933-3226'); puede diferir del anterior.
  support_whatsapp_label   text,
  support_email_enabled    boolean not null default true,
  support_email            text check (support_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  support_hours            text,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.profiles(id)
);

comment on table public.platform_settings is
  'Ajustes globales del SaaS, una sola fila. Legible por anon a propósito: la landing es un export estático y consulta sin sesión. Solo contiene datos de contacto públicos — NO agregar campos sensibles aquí.';

-- Semilla con exactamente los valores que hoy están en el código, para que el
-- despliegue no cambie ningún comportamiento.
insert into public.platform_settings (
  id, support_whatsapp_enabled, support_whatsapp_number, support_whatsapp_label,
  support_email_enabled, support_email, support_hours
) values (
  true, true, '18299333226', '829-933-3226',
  true, 'soporte@sellalles.com', 'Lunes a viernes, 8:00 a.m. a 6:00 p.m.'
);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.platform_settings enable row level security;

-- Lectura abierta: es información de contacto pública y la landing la necesita
-- sin sesión.
create policy platform_settings_select on public.platform_settings for select
  to anon, authenticated
  using (true);

-- Escritura solo del super admin de plataforma. Se usa is_platform_super_admin()
-- y no is_super_admin() a propósito: esto es configuración del SaaS, así que
-- debe seguir siendo editable aunque el super admin esté impersonando.
create policy platform_settings_update on public.platform_settings for update
  to authenticated
  using (public.is_platform_super_admin())
  with check (public.is_platform_super_admin());

-- Sin policy de insert ni de delete: RLS niega por defecto, así que la fila
-- única sembrada arriba no se puede duplicar ni borrar desde la API.
-- Además se quitan los privilegios de escritura de anon (defensa en capas:
-- Supabase concede insert/update/delete por defecto a anon en public).
revoke insert, update, delete on public.platform_settings from anon;
revoke insert, delete on public.platform_settings from authenticated;

-- ── updated_at / updated_by automáticos ────────────────────────────────────

create or replace function public.platform_settings_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.id := true;   -- blinda el singleton ante un update del propio pk
  return new;
end;
$$;

create trigger platform_settings_touch
  before update on public.platform_settings
  for each row execute function public.platform_settings_touch();

-- La función solo se invoca desde el trigger; nadie necesita ejecutarla.
revoke all on function public.platform_settings_touch() from public, anon, authenticated;
