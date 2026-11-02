-- Facturación electrónica (e-CF) con MSeller: esquema base.
-- Diseño: docs/2026-10-28-ecf-mseller-diseno.md (repo raíz).
--
-- Solo la base de datos: las tablas donde vive cada comprobante, la
-- configuración y las credenciales de cada empresa ante MSeller, el contador
-- de uso del plan, y las marcas que necesitan las tareas siguientes (la venta,
-- las Edge Functions y la pantalla). Esta migración no cambia el
-- comportamiento de ninguna función existente: mientras ninguna empresa tenga
-- `ecf_activa`, todo sigue como hoy.

-- ---------------------------------------------------------------------------
-- 1. Configuración por empresa
-- ---------------------------------------------------------------------------
create table if not exists public.ecf_config (
  company_id              uuid primary key references public.companies(id) on delete cascade,
  estado                  text not null default 'preparacion'
                            check (estado in ('preparacion', 'activa', 'suspendida')),
  ambiente                text not null default 'TesteCF'
                            check (ambiente in ('TesteCF', 'CerteCF', 'eCF')),
  -- 9 dígitos (RNC) u 11 (cédula de una persona física).
  rnc_emisor              text check (rnc_emisor ~ '^\d{9}(\d{2})?$'),
  razon_social            text not null,
  nombre_comercial        text,
  direccion               text not null,
  -- El plan de MSeller de esta empresa (el plan es por RNC emisor) y sus límites.
  plan                    text not null default 'gratis'
                            check (plan in ('gratis', 'emprende', 'basico', 'negocio', 'avanzado', 'empresa')),
  cupo_comprobantes       int not null default 250,
  cupo_requests           int not null default 1000,
  -- 60 en el plan gratis, 30 en los de pago.
  minutos_entre_consultas int not null default 60,
  certificado_vence       date,
  conexion_probada_at     timestamptz,
  activada_at             timestamptz,
  updated_at              timestamptz default now()
);

comment on table public.ecf_config is
  'Una fila por empresa con e-CF: datos del emisor, ambiente y plan de MSeller con su cupo. La lee la empresa; solo el super admin la cambia.';

-- updated_at lo pone el trigger, no quien actualiza: la tarea 4 lo usa para
-- saber si el plan cambió desde la última vez.
create or replace function public.ecf_config_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.ecf_config_touch() from public, anon, authenticated;

drop trigger if exists ecf_config_touch on public.ecf_config;
create trigger ecf_config_touch
  before update on public.ecf_config
  for each row execute function public.ecf_config_touch();

alter table public.ecf_config enable row level security;

drop policy if exists ecf_config_select on public.ecf_config;
create policy ecf_config_select on public.ecf_config
  for select
  using (company_id = (select current_company_id()) or (select is_super_admin()));

drop policy if exists ecf_config_insert on public.ecf_config;
create policy ecf_config_insert on public.ecf_config
  for insert
  with check ((select is_super_admin()));

drop policy if exists ecf_config_update on public.ecf_config;
create policy ecf_config_update on public.ecf_config
  for update
  using ((select is_super_admin()))
  with check ((select is_super_admin()));

drop policy if exists ecf_config_delete on public.ecf_config;
create policy ecf_config_delete on public.ecf_config
  for delete
  using ((select is_super_admin()));

revoke all on public.ecf_config from anon, authenticated;
grant select, insert, update, delete on public.ecf_config to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Credenciales ante MSeller (una subcuenta por empresa y ambiente)
-- ---------------------------------------------------------------------------
-- Las tres claves viven en Vault; aquí solo se guarda a qué secreto apuntan
-- (sin clave foránea: vault.secrets no es nuestro). El idToken dura 60
-- minutos y se guarda para no autenticar en cada llamada.
create table if not exists public.ecf_credenciales (
  company_id              uuid not null references public.companies(id) on delete cascade,
  ambiente                text not null,
  email                   text not null,
  password_secret_id      uuid,
  api_key_secret_id       uuid,
  refresh_token_secret_id uuid,
  sub                     text,
  id_token                text,
  id_token_vence          timestamptz,
  updated_at              timestamptz default now(),
  primary key (company_id, ambiente)
);

comment on table public.ecf_credenciales is
  'Credenciales de MSeller por empresa y ambiente. RLS sin políticas y sin permisos para anon ni authenticated: solo las Edge Functions (service role) la tocan.';

alter table public.ecf_credenciales enable row level security;
revoke all on public.ecf_credenciales from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Un registro por comprobante
-- ---------------------------------------------------------------------------
create table if not exists public.ecf_documentos (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  branch_id          uuid references public.branches(id),
  -- Un comprobante sale de una venta o de una nota de crédito. El nombre de la
  -- clave a sales (ecf_documentos_sale_id_fkey) lo usa el front para traer el
  -- documento junto a la venta; no lo cambies.
  sale_id            uuid references public.sales(id) on delete restrict,
  credit_note_id     uuid references public.credit_notes(id) on delete restrict,
  tipo_ecf           smallint check (tipo_ecf in (31, 32, 33, 34, 44, 45)),
  -- E + tipo (2 dígitos) + secuencia (10 dígitos).
  encf               text not null check (encf ~ '^E\d{12}$'),
  ambiente           text not null,
  estado             text not null default 'por_enviar'
                       check (estado in ('por_enviar', 'enviando', 'recibido', 'aceptado',
                                         'aceptado_condicional', 'rechazado', 'error_datos', 'sin_cupo')),
  security_code      text,
  qr_url             text,
  -- Tal como lo devuelve MSeller (dd-mm-aaaa hh:mm:ss): se imprime igual en el ticket.
  signed_at          text,
  internal_track_id  text,
  mensajes_dgii      jsonb default '[]'::jsonb,
  request_json       jsonb,
  intentos           int not null default 0,
  proximo_intento_at timestamptz default now(),
  reservado_hasta    timestamptz,
  ultimo_error       text,
  enviado_at         timestamptz,
  estado_at          timestamptz,
  ultima_consulta_at timestamptz,
  -- El documento nuevo, si este se rechazó y se volvió a emitir.
  reemplazado_por    uuid references public.ecf_documentos(id),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  constraint ecf_documentos_origen_check check (num_nonnulls(sale_id, credit_note_id) = 1),
  unique (company_id, encf)
);

create index if not exists ecf_documentos_sale_id_idx on public.ecf_documentos (sale_id);
create index if not exists ecf_documentos_credit_note_id_idx on public.ecf_documentos (credit_note_id);
-- Lo que el worker revisa: los que aún no terminaron.
create index if not exists ecf_documentos_pendientes_idx on public.ecf_documentos (estado)
  where estado in ('por_enviar', 'enviando', 'recibido');

comment on table public.ecf_documentos is
  'Cada e-CF emitido o por emitir. Solo se escribe desde el servidor; se lee con la misma visibilidad que la venta o la nota de crédito de la que sale.';

alter table public.ecf_documentos enable row level security;

drop policy if exists ecf_documentos_select on public.ecf_documentos;
create policy ecf_documentos_select on public.ecf_documentos
  for select
  using (
    exists (select 1 from public.sales s where s.id = ecf_documentos.sale_id)
    or exists (select 1 from public.credit_notes n where n.id = ecf_documentos.credit_note_id)
  );

revoke all on public.ecf_documentos from anon, authenticated;
grant select on public.ecf_documentos to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Uso del plan de MSeller (por empresa y mes)
-- ---------------------------------------------------------------------------
-- periodo es el día 1 del mes en UTC (así reinicia el cupo de MSeller).
create table if not exists public.ecf_uso (
  company_id   uuid not null references public.companies(id) on delete cascade,
  periodo      date not null,
  comprobantes int not null default 0,
  requests     int not null default 0,
  primary key (company_id, periodo)
);

comment on table public.ecf_uso is
  'Comprobantes y llamadas a MSeller gastados por empresa en el mes. Solo la lee el super admin.';

alter table public.ecf_uso enable row level security;

drop policy if exists ecf_uso_select on public.ecf_uso;
create policy ecf_uso_select on public.ecf_uso
  for select
  using ((select is_super_admin()));

revoke all on public.ecf_uso from anon, authenticated;
grant select on public.ecf_uso to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cambios en lo que ya existe
-- ---------------------------------------------------------------------------
-- Secuencias de e-NCF: se cargan como las B de hoy, marcadas como electrónicas,
-- y el prefijo tiene que ser el del tipo. Con NULL el `in` no daría false y el
-- check pasaría de largo, por eso el coalesce.
alter table public.ncf_sequences add column if not exists electronica boolean not null default false;

alter table public.ncf_sequences drop constraint if exists ncf_sequences_prefijo_e_check;
alter table public.ncf_sequences add constraint ncf_sequences_prefijo_e_check
  check (not electronica or coalesce((tipo, prefix) in (
    ('consumer', 'E32'), ('fiscal', 'E31'), ('nota_credito', 'E34'),
    ('nota_debito', 'E33'), ('regimen_especial', 'E44'), ('gubernamental', 'E45')
  ), false));

-- Hasta esta fecha se pueden seguir emitiendo B a quien aún no tiene e-CF.
alter table public.platform_settings add column if not exists ncf_b_fecha_corte date not null default '2026-11-15';

-- Los servicios no llevan inventario: el e-CF los marca distinto (indicador de
-- bien o servicio).
alter table public.products add column if not exists es_servicio boolean not null default false;

-- ---------------------------------------------------------------------------
-- 6. ¿Emite esta empresa e-CF?
-- ---------------------------------------------------------------------------
-- Verdadero solo si la empresa está formalizada, tiene el módulo `ecf`
-- encendido y su ecf_config está activa. Siempre devuelve true o false.
create or replace function public.ecf_activa(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.companies c
      join public.ecf_config e on e.company_id = c.id and e.estado = 'activa'
      join public.company_modules m on m.company_id = c.id and m.module_key = 'ecf' and m.enabled
     where c.id = p_company
       and c.is_formalized
  );
$$;

revoke all on function public.ecf_activa(uuid) from public;
revoke execute on function public.ecf_activa(uuid) from anon;
grant execute on function public.ecf_activa(uuid) to authenticated;
