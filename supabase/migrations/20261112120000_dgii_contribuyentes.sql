-- Memoria de las consultas de RNC y cédulas a la DGII.
--
-- La Edge Function `dgii-rnc` consulta la página pública de la DGII
-- (consultas/rnc.aspx) cuando alguien escribe un RNC o una cédula en Clientes,
-- Suplidores o el carrito, y guarda aquí lo que respondió. Lo guardado se usa por
-- 30 días (1 día si no se encontró) y, si la DGII no responde, sirve de respaldo.
-- No es una copia del padrón de la DGII: solo hay lo que alguien consultó.
--
-- Solo la función la lee y la escribe, con la service role: RLS encendida, sin
-- políticas y sin permisos para anon ni authenticated.

create table if not exists public.dgii_contribuyentes (
  rnc                    text primary key check (rnc ~ '^\d{9}(\d{2})?$'),
  encontrado             boolean not null,
  razon_social           text,
  nombre_comercial       text,
  categoria              text,
  regimen_pagos          text,
  estado                 text,
  actividad_economica    text,
  administracion_local   text,
  facturador_electronico boolean,
  consultado_at          timestamptz not null default now()
);

comment on table public.dgii_contribuyentes is
  'Memoria de las consultas de RNC/cédula a la DGII que hace la Edge Function dgii-rnc (30 días; 1 día si no se encontró). Solo la service role.';

alter table public.dgii_contribuyentes enable row level security;

revoke all on public.dgii_contribuyentes from anon, authenticated;
grant select, insert, update, delete on public.dgii_contribuyentes to service_role;
