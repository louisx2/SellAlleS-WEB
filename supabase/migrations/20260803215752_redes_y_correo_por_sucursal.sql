-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Redes y correo propios por sucursal, y la empresa decide qué contacto lleva
-- el ticket: el suyo, el de la sucursal, o los dos.

alter table public.branches
  add column if not exists instagram text,
  add column if not exists facebook  text,
  add column if not exists email     text;

alter table public.companies
  add column if not exists email text;

alter table public.companies
  add column if not exists ticket_social_display text not null default 'company'
    check (ticket_social_display in ('company', 'branch', 'both'));
