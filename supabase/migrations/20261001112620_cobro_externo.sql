-- Cobro externo: otro sistema (Anadsll) cobra a SU empresa a través de SellAlleS con una clave de conexión.
--
-- La clave identifica UNA empresa; aquí solo se guarda su sha-256. La usa la Edge Function cobro-externo con
-- service role. Las reglas de "reportar" y "retirar" pasan a funciones internas que reciben la empresa como
-- dato: la app (por la sesión) y el puente (por la clave) usan las mismas validaciones y el mismo disparador
-- de "comprobante recibido".

-- ── Claves ─────────────────────────────────────────────────────────────────
create table public.claves_cobro_externo (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  clave_hash text not null unique,
  etiqueta text not null default 'Conexión externa' check (btrim(etiqueta) <> ''),
  creada_en timestamptz not null default now(),
  ultimo_uso timestamptz,
  revocada_en timestamptz
);

create unique index claves_cobro_externo_una_activa
  on public.claves_cobro_externo (company_id) where revocada_en is null;

comment on table public.claves_cobro_externo is
  'Claves con las que un sistema externo (p. ej. Anadsll) consulta y reporta los pagos de UNA empresa por la Edge Function cobro-externo. Solo se guarda el hash; solo el servidor la lee.';

alter table public.claves_cobro_externo enable row level security;
revoke all on public.claves_cobro_externo from anon, authenticated;
grant select, insert, update, delete on public.claves_cobro_externo to service_role;

create or replace function public.generar_clave_cobro_externo(p_company_id uuid, p_etiqueta text default 'Anadsll')
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_clave text;
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede generar claves de conexión.';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Empresa no encontrada.';
  end if;
  -- una sola clave activa por empresa: la anterior deja de servir en el acto
  update public.claves_cobro_externo set revocada_en = now()
   where company_id = p_company_id and revocada_en is null;
  v_clave := 'cobro_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.claves_cobro_externo (company_id, clave_hash, etiqueta)
  values (p_company_id, encode(extensions.digest(v_clave, 'sha256'), 'hex'),
          coalesce(nullif(btrim(p_etiqueta), ''), 'Conexión externa'));
  return v_clave;
end;
$$;

revoke all on function public.generar_clave_cobro_externo(uuid, text) from public, anon;
grant execute on function public.generar_clave_cobro_externo(uuid, text) to authenticated;

create or replace function public.revocar_clave_cobro_externo(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede revocar claves de conexión.';
  end if;
  update public.claves_cobro_externo set revocada_en = now()
   where company_id = p_company_id and revocada_en is null;
end;
$$;

revoke all on function public.revocar_clave_cobro_externo(uuid) from public, anon;
grant execute on function public.revocar_clave_cobro_externo(uuid) to authenticated;

create or replace function public.estado_clave_cobro_externo(p_company_id uuid)
returns table (activa boolean, etiqueta text, creada_en timestamptz, ultimo_uso timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede ver las claves de conexión.';
  end if;
  return query
    select true, k.etiqueta, k.creada_en, k.ultimo_uso
      from public.claves_cobro_externo k
     where k.company_id = p_company_id and k.revocada_en is null;
end;
$$;

revoke all on function public.estado_clave_cobro_externo(uuid) from public, anon;
grant execute on function public.estado_clave_cobro_externo(uuid) to authenticated;

-- La clave → la empresa. Solo el servidor; anota el último uso.
create or replace function public._empresa_de_clave(p_clave_hash text)
returns table (company_id uuid, etiqueta text)
language sql
volatile
security definer
set search_path to 'public'
as $$
  update public.claves_cobro_externo k
     set ultimo_uso = now()
   where k.clave_hash = p_clave_hash and k.revocada_en is null
  returning k.company_id, k.etiqueta;
$$;

revoke all on function public._empresa_de_clave(text) from public, anon, authenticated;
grant execute on function public._empresa_de_clave(text) to service_role;

-- ── Reportar y retirar: una sola regla ─────────────────────────────────────
create or replace function public._reportar_pago(
  p_company_id uuid,
  p_reportado_por uuid,
  p_reportado_por_nombre text,
  p_amount numeric,
  p_paid_at date,
  p_bank_account_id uuid,
  p_reference text,
  p_notes text,
  p_file_path text,
  p_file_name text,
  p_file_mime text,
  p_file_sha256 text
) returns public.subscription_payment_reports
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_banco text;
  v_row public.subscription_payment_reports%rowtype;
begin
  if p_company_id is null then
    raise exception 'Empresa no encontrada.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;
  if p_paid_at is null or p_paid_at > public.company_today(p_company_id) then
    raise exception 'La fecha del pago no puede ser futura.';
  end if;
  if p_file_path is null or split_part(p_file_path, '/', 1) <> p_company_id::text then
    raise exception 'El comprobante no pertenece a esta empresa.';
  end if;
  if not exists (
    select 1 from storage.objects where bucket_id = 'comprobantes-de-pago' and name = p_file_path
  ) then
    raise exception 'No se encontró el comprobante subido. Vuelve a adjuntarlo.';
  end if;
  if nullif(btrim(p_file_sha256), '') is not null and exists (
    select 1 from public.subscription_payment_reports
     where company_id = p_company_id and file_sha256 = p_file_sha256
       and status in ('por_confirmar', 'confirmado')
  ) then
    raise exception 'Ese comprobante ya lo enviaste antes.';
  end if;

  if p_bank_account_id is not null then
    select a.bank || ' · ' || initcap(a.account_type) || ' · ' || a.account_number
      into v_banco
      from public.platform_bank_accounts a where a.id = p_bank_account_id;
    if v_banco is null then
      raise exception 'La cuenta bancaria elegida no existe.';
    end if;
  end if;

  insert into public.subscription_payment_reports (
    company_id, amount, paid_at, bank_account_id, bank_label, reference, notes,
    file_path, file_name, file_mime, file_sha256, reported_by, reported_by_name
  ) values (
    p_company_id, round(p_amount, 2), p_paid_at, p_bank_account_id, v_banco,
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''),
    p_file_path, nullif(btrim(p_file_name), ''), nullif(btrim(p_file_mime), ''),
    nullif(btrim(p_file_sha256), ''),
    p_reportado_por, nullif(btrim(p_reportado_por_nombre), '')
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public._reportar_pago(uuid, uuid, text, numeric, date, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public._reportar_pago(uuid, uuid, text, numeric, date, uuid, text, text, text, text, text, text) to service_role;

-- La de la app: misma firma y mismos permisos de antes, ahora como envoltura.
create or replace function public.reportar_pago_de_suscripcion(
  p_amount numeric,
  p_paid_at date,
  p_bank_account_id uuid,
  p_reference text,
  p_notes text,
  p_file_path text,
  p_file_name text,
  p_file_mime text,
  p_file_sha256 text
) returns public.subscription_payment_reports
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.is_company_admin() then
    raise exception 'Solo el administrador de la empresa puede reportar pagos.';
  end if;
  return public._reportar_pago(
    v_company, auth.uid(), (select name from public.profiles where id = auth.uid()),
    p_amount, p_paid_at, p_bank_account_id, p_reference, p_notes,
    p_file_path, p_file_name, p_file_mime, p_file_sha256);
end;
$$;

create or replace function public._anular_reporte(p_company_id uuid, p_report_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.subscription_payment_reports
     set status = 'anulado', reviewed_at = now()
   where id = p_report_id
     and company_id = p_company_id
     and status = 'por_confirmar';
  if not found then
    raise exception 'Solo se puede retirar un comprobante que todavía está por confirmar.';
  end if;
end;
$$;

revoke all on function public._anular_reporte(uuid, uuid) from public, anon, authenticated;
grant execute on function public._anular_reporte(uuid, uuid) to service_role;

create or replace function public.anular_reporte_de_pago(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_company_admin() then
    raise exception 'Solo el administrador de la empresa puede retirar un comprobante.';
  end if;
  perform public._anular_reporte(public.current_company_id(), p_report_id);
end;
$$;

-- El puente lee la cuenta con service role.
grant execute on function public._cuenta_de_suscripcion(uuid, date) to service_role;
