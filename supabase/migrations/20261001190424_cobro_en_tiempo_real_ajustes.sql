-- Ajustes al aviso en tiempo real (revisión de cobro_en_tiempo_real).
--
-- 1) La dirección del aviso se conserva aunque la clave anterior se haya revocado primero: "Revocar" y luego
--    "Generar" (lo que se hace cuando una clave se filtra) ya no la pierde. Se toma la de la clave más reciente.
-- 2) El aviso nunca frena un pago: si pg_net fallara al encolar, queda una advertencia y el comprobante o el pago se
--    guardan igual. La hora firmada es la del momento (clock_timestamp), no la del inicio de la transacción.

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
  v_en text := floor(extract(epoch from clock_timestamp()))::bigint::text;
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

  begin
    -- pg_net encola el pedido y lo manda aparte: el cambio no espera ni falla si el otro lado no responde
    perform net.http_post(
      url     := v_aviso_url,
      body    := jsonb_build_object('tabla', tg_table_name, 'evento', lower(tg_op)),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-aviso-en', v_en,
        'x-firma-cobro', encode(extensions.hmac(v_en, v_clave_hash, 'sha256'), 'hex'))
    );
  exception when others then
    raise warning '_avisar_cambio_de_cobro: no se pudo encolar el aviso (%).', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public._avisar_cambio_de_cobro() from public, anon, authenticated;

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
  -- la dirección del aviso es de la conexión: se toma la de la clave más reciente, activa o no
  select aviso_url into v_aviso_url
    from public.claves_cobro_externo
   where company_id = p_company_id
   order by creada_en desc
   limit 1;
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
