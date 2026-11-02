-- Facturación electrónica (e-CF) con MSeller: el e-NCF se asigna al guardar la
-- venta, la serie B se corta en la fecha configurada y cada e-CF entra a la
-- bandeja de salida (ecf_documentos).
-- Diseño: docs/2026-10-28-ecf-mseller-diseno.md (repo raíz).
--
-- assign_ncf() y set_sale_ncf() se modificaron partiendo de sus definiciones
-- vivas (pg_get_functiondef del 2026-11-02), no de ninguna copia del repo. Lo
-- que hacían y se conserva: assign_ncf devuelve null si la empresa no emite
-- comprobantes (companies.ncf_enabled), toma la primera secuencia activa con
-- números disponibles y no vencida (for update), y falla con los dos mensajes
-- de "no hay secuencia" / "se agotó"; set_sale_ncf solo asigna cuando la venta
-- no trae NCF y lo pidió (ncf_requested). Siguen siendo security definer con
-- search_path = public, sin execute para anon ni authenticated.
--
-- Mientras ninguna empresa tenga `ecf_activa` y la fecha de corte no llegue,
-- todo se comporta como hoy.

-- ---------------------------------------------------------------------------
-- 1. ¿Sigue vigente la serie B?
-- ---------------------------------------------------------------------------
-- Verdadero hasta el día anterior a platform_settings.ncf_b_fecha_corte, según
-- el día local de la empresa. Sin fecha de corte configurada, la B sigue vigente.
create or replace function public.ncf_b_vigente(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.company_today(p_company) < (select ncf_b_fecha_corte from public.platform_settings limit 1),
    true
  );
$$;

comment on function public.ncf_b_vigente(uuid) is
  'true mientras la empresa puede seguir emitiendo serie B: su día local es anterior a platform_settings.ncf_b_fecha_corte.';

revoke all on function public.ncf_b_vigente(uuid) from public;
revoke execute on function public.ncf_b_vigente(uuid) from anon;
grant execute on function public.ncf_b_vigente(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. assign_ncf: e-NCF con e-CF activo, serie B (con corte) si no
-- ---------------------------------------------------------------------------
create or replace function public.assign_ncf(p_company uuid, p_ncf_type text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_enabled    boolean;
  v_ecf        boolean;
  v_corte      date;
  v_prefijo_e  text;
  v_seq        public.ncf_sequences%rowtype;
  v_ncf        text;
  v_registered integer;
begin
  -- Con e-CF activo se emite e-NCF aunque la empresa no tenga ncf_enabled.
  v_ecf := public.ecf_activa(p_company);

  if v_ecf then
    v_prefijo_e := case p_ncf_type
      when 'consumer'         then 'E32'
      when 'fiscal'           then 'E31'
      when 'nota_credito'     then 'E34'
      when 'nota_debito'      then 'E33'
      when 'regimen_especial' then 'E44'
      when 'gubernamental'    then 'E45'
    end;
    if v_prefijo_e is null then
      raise exception 'El comprobante de tipo % no tiene equivalente electrónico (e-CF).',
        public.ncf_tipo_label(p_ncf_type);
    end if;
  else
    select ncf_enabled into v_enabled from public.companies where id = p_company;
    if not coalesce(v_enabled, false) then
      return null; -- empresa que no emite comprobantes: venta sin NCF
    end if;

    -- Desde la fecha de corte ya no se emite serie B.
    select ncf_b_fecha_corte into v_corte from public.platform_settings limit 1;
    if v_corte is not null and public.company_today(p_company) >= v_corte then
      raise exception 'La serie B dejó de ser válida el %. Para emitir comprobantes hay que activar la facturación electrónica.',
        to_char(v_corte, 'DD/MM/YYYY');
    end if;
  end if;

  -- Con e-CF activo solo cuentan las secuencias electrónicas; sin él, solo las B.
  select * into v_seq
  from public.ncf_sequences
  where company_id = p_company
    and tipo = p_ncf_type
    and electronica = v_ecf
    and active
    and current_val <= range_to
    and (expires_at is null or expires_at >= company_today(p_company))
  order by created_at
  limit 1
  for update;

  if not found then
    if v_ecf then
      raise exception 'No hay una secuencia de e-CF (%) activa con números disponibles. Agrégala en Perfil → Facturación fiscal.',
        v_prefijo_e;
    end if;

    select count(*) into v_registered
      from public.ncf_sequences
     where company_id = p_company and tipo = p_ncf_type and not electronica;

    if v_registered = 0 then
      raise exception 'No hay secuencia de % registrada. Un administrador debe cargar el rango autorizado por DGII en Perfil de Empresa → Facturación Fiscal.',
        public.ncf_tipo_label(p_ncf_type);
    else
      raise exception 'La secuencia de % se agotó, venció o está inactiva. Un administrador debe registrar el nuevo rango autorizado por DGII en Perfil de Empresa → Facturación Fiscal.',
        public.ncf_tipo_label(p_ncf_type);
    end if;
  end if;

  -- e-NCF: prefijo (E + tipo) y 10 dígitos; serie B: 8 dígitos.
  v_ncf := coalesce(v_seq.prefix, '')
        || lpad(v_seq.current_val::text, case when v_ecf then 10 else 8 end, '0');

  update public.ncf_sequences set current_val = current_val + 1 where id = v_seq.id;

  return v_ncf;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. set_sale_ncf: con e-CF activo toda venta de hoy lleva e-NCF
-- ---------------------------------------------------------------------------
create or replace function public.set_sale_ncf()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ecf          boolean;
  v_rnc_sucursal text;
  v_rnc_emisor   text;
begin
  v_ecf := public.ecf_activa(new.company_id);

  -- Con e-CF activo no hay venta sin comprobante: se pide aunque el cajero no
  -- lo haya pedido, con consumidor final (E32) si no viene otro tipo. Las
  -- ventas de días anteriores (cargadas después) quedan como llegan.
  if v_ecf and new.ncf is null
     and public.sale_local_date(new.company_id, new.created_at) = public.company_today(new.company_id) then
    new.ncf_requested := true;
    new.ncf_type := coalesce(new.ncf_type, 'consumer');
  end if;

  if new.ncf is null and coalesce(new.ncf_requested, false) then
    -- Las sucursales emiten con el RNC de la empresa: una con otro RNC es otro
    -- contribuyente. Se rechaza antes de gastar un número. Se comparan solo los
    -- dígitos (el RNC de la sucursal es texto libre: con guiones o espacios).
    if v_ecf and new.branch_id is not null then
      select regexp_replace(coalesce(b.rnc, ''), '\D', '', 'g') into v_rnc_sucursal
        from public.branches b where b.id = new.branch_id;
      select c.rnc_emisor into v_rnc_emisor
        from public.ecf_config c where c.company_id = new.company_id;
      if v_rnc_sucursal <> '' and v_rnc_sucursal is distinct from v_rnc_emisor then
        raise exception 'Esta sucursal tiene un RNC distinto al de la empresa; no puede emitir e-CF con el de la empresa.';
      end if;
    end if;

    new.ncf := public.assign_ncf(new.company_id, new.ncf_type::text);
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Bandeja de salida: cada venta con e-NCF crea su ecf_documentos
-- ---------------------------------------------------------------------------
-- AFTER INSERT, en la misma transacción que la venta: si el documento no se
-- puede crear, la venta tampoco se guarda. Security definer porque
-- `authenticated` solo lee ecf_documentos: sin esto la venta de un cajero
-- fallaría. Sin ecf_config no hay ambiente al que mandarlo y no se crea nada
-- (un e-NCF solo sale de assign_ncf, que exige ecf_activa).
create or replace function public.ecf_encolar_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ncf ~ '^E\d{12}$' then
    insert into public.ecf_documentos (company_id, branch_id, sale_id, tipo_ecf, encf, ambiente, estado)
    select new.company_id, new.branch_id, new.id, substr(new.ncf, 2, 2)::smallint, new.ncf, c.ambiente, 'por_enviar'
      from public.ecf_config c
     where c.company_id = new.company_id;
  end if;
  return new;
end $$;

comment on function public.ecf_encolar_venta() is
  'Trigger AFTER INSERT de sales: cuando la venta lleva e-NCF crea su fila en ecf_documentos (por_enviar) para que el worker la envíe a MSeller.';

revoke all on function public.ecf_encolar_venta() from public, anon, authenticated;

drop trigger if exists trg_ecf_encolar_venta on public.sales;
create trigger trg_ecf_encolar_venta
  after insert on public.sales
  for each row execute function public.ecf_encolar_venta();
