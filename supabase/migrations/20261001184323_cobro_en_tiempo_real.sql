-- Cobros en tiempo real.
--
-- 1) Comprobantes y pagos de suscripción entran a Realtime: Cobros (super admin), Mi Suscripción (el admin de cada
--    empresa) y el contador del menú se recargan solos. Realtime respeta las políticas de lectura, así que cada
--    quien recibe solo lo que ya podía ver.
-- 2) Al sistema externo de una empresa (hoy Anadsll) se le avisa cuando cambia un comprobante o un pago de esa
--    empresa, para que su panel se actualice sin recargar. El aviso va a la dirección guardada en su clave de
--    conexión y lleva una firma: HMAC-SHA256 de la hora del aviso con el hash de la clave como llave. El otro lado
--    tiene la clave, así que puede calcular el mismo hash y comprobar la firma sin que haya otro secreto que
--    guardar. El aviso no lleva datos: solo dice "algo cambió" y el otro lado vuelve a pedir el estado por el puente.

alter publication supabase_realtime add table public.subscription_payment_reports, public.subscription_payments;

alter table public.claves_cobro_externo
  add column aviso_url text check (aviso_url is null or aviso_url ~ '^https://');

comment on column public.claves_cobro_externo.aviso_url is
  'Dirección a la que se avisa (POST sin datos, firmado) cuando cambia un comprobante o un pago de la empresa. Nula = no se avisa.';

create or replace function public._avisar_cambio_de_cobro()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid;
  v_clave_hash text;
  v_aviso_url text;
  v_en text := floor(extract(epoch from now()))::bigint::text;
begin
  if tg_op = 'DELETE' then
    v_company := old.company_id;
  else
    v_company := new.company_id;
  end if;

  select k.clave_hash, k.aviso_url into v_clave_hash, v_aviso_url
    from public.claves_cobro_externo k
   where k.company_id = v_company and k.revocada_en is null and k.aviso_url is not null;
  if v_aviso_url is null then
    return null;
  end if;

  -- pg_net encola el pedido y lo manda aparte: el cambio no espera ni falla si el otro lado no responde
  perform net.http_post(
    url     := v_aviso_url,
    body    := jsonb_build_object('tabla', tg_table_name, 'evento', lower(tg_op)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-aviso-en', v_en,
      'x-firma-cobro', encode(extensions.hmac(v_en, v_clave_hash, 'sha256'), 'hex'))
  );
  return null;
end;
$$;

revoke all on function public._avisar_cambio_de_cobro() from public, anon, authenticated;

create trigger trg_avisar_cambio_de_cobro_reportes
  after insert or update or delete on public.subscription_payment_reports
  for each row execute function public._avisar_cambio_de_cobro();

create trigger trg_avisar_cambio_de_cobro_pagos
  after insert or update or delete on public.subscription_payments
  for each row execute function public._avisar_cambio_de_cobro();

-- La dirección del aviso es de la conexión, no de la clave: al generar otra clave se conserva.
create or replace function public.generar_clave_cobro_externo(p_company_id uuid, p_etiqueta text default 'Anadsll')
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_clave text;
  v_aviso_url text;
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede generar claves de conexión.';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Empresa no encontrada.';
  end if;
  select aviso_url into v_aviso_url
    from public.claves_cobro_externo
   where company_id = p_company_id and revocada_en is null;
  -- una sola clave activa por empresa: la anterior deja de servir en el acto
  update public.claves_cobro_externo set revocada_en = now()
   where company_id = p_company_id and revocada_en is null;
  v_clave := 'cobro_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.claves_cobro_externo (company_id, clave_hash, etiqueta, aviso_url)
  values (p_company_id, encode(extensions.digest(v_clave, 'sha256'), 'hex'),
          coalesce(nullif(btrim(p_etiqueta), ''), 'Conexión externa'), v_aviso_url);
  return v_clave;
end;
$$;

create or replace function public.poner_aviso_cobro_externo(p_company_id uuid, p_aviso_url text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super administrador puede cambiar el aviso de una conexión.';
  end if;
  if nullif(btrim(p_aviso_url), '') is not null and btrim(p_aviso_url) !~ '^https://' then
    raise exception 'La dirección del aviso tiene que empezar con https://.';
  end if;
  update public.claves_cobro_externo
     set aviso_url = nullif(btrim(p_aviso_url), '')
   where company_id = p_company_id and revocada_en is null;
  if not found then
    raise exception 'Esta empresa no tiene una clave de conexión activa.';
  end if;
end;
$$;

revoke all on function public.poner_aviso_cobro_externo(uuid, text) from public, anon;
grant execute on function public.poner_aviso_cobro_externo(uuid, text) to authenticated;
