-- Enlaces cortos para los comprobantes que se comparten por WhatsApp.
--
-- La URL firmada de Storage mide 559 caracteres porque lleva el token dentro:
-- ilegible en un mensaje, y apuntando a un dominio que el cliente no reconoce.
-- Aqui se guarda un codigo corto que apunta a la venta; la Edge Function `c`
-- lo resuelve, firma la descarga en ese momento y redirige.
--
-- Dos cosas que esto habilita y la URL firmada no permitia:
--   - revocar un comprobante (borrar la fila), en vez de esperar 15 dias;
--   - cambiar de dominio sin invalidar lo ya enviado.
create table if not exists public.receipt_links (
  code          text primary key,
  sale_id       uuid not null references public.sales(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  -- Copia del nombre de la empresa en el momento de compartir. Va en la URL
  -- solo para que el cliente vea de quien es; si la empresa se renombra, el
  -- enlace ya enviado tiene que seguir abriendo.
  company_slug  text not null,
  storage_path  text not null,
  download_name text not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);

create index if not exists receipt_links_sale_id_idx on public.receipt_links (sale_id);
create index if not exists receipt_links_expires_at_idx on public.receipt_links (expires_at);

alter table public.receipt_links enable row level security;

-- Sin policies a proposito: solo el service role (que no pasa por RLS) escribe
-- y lee aqui. El codigo corto ES el secreto del enlace; si el navegador pudiera
-- consultar la tabla, cualquiera con sesion leeria los comprobantes de todas
-- las empresas.
revoke all on public.receipt_links from anon, authenticated;

comment on table public.receipt_links is
  'Codigos cortos de comprobantes. Los resuelve la Edge Function `c` con service role; nadie mas tiene acceso.';
