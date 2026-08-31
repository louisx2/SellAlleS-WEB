-- Comprobantes fiscales a demanda + errores accionables al tomar el número.
--
-- Hasta aquí el NCF era todo-o-nada: con companies.ncf_enabled en true, el
-- trigger set_sale_ncf le ponía comprobante a TODAS las ventas. En la calle el
-- cliente pide el comprobante solo a veces, y quemar un número autorizado por
-- DGII en cada venta de mostrador agota el rango en semanas.
--
-- Ahora la venta declara si lleva comprobante (sales.ncf_requested) y el
-- trigger solo toma número cuando se pidió. Ninguna empresa tiene ncf_enabled
-- ni existe una venta con NCF, así que el cambio no altera nada ya registrado:
-- las ventas viejas quedan en false, que es justo lo que fueron.

alter table public.sales
  add column if not exists ncf_requested boolean not null default false;

comment on column public.sales.ncf_requested is
  'La venta pidió comprobante fiscal: set_sale_ncf le asigna NCF de ncf_sequences.';


-- ── Etiqueta legible de cada tipo, para los mensajes de error ───────────────
-- La app rotula igual (ncf-settings-card, checkout); aquí hace falta porque el
-- cajero solo ve lo que dice la excepción cuando la venta no puede facturarse.

create or replace function public.ncf_tipo_label(p_tipo text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_tipo
    when 'consumer'         then 'Consumidor Final (B02)'
    when 'fiscal'           then 'Crédito Fiscal (B01)'
    when 'nota_credito'     then 'Nota de Crédito (B04)'
    when 'gubernamental'    then 'Gubernamental (B15)'
    when 'regimen_especial' then 'Régimen Especial (B14)'
    when 'nota_debito'      then 'Nota de Débito (B03)'
    else coalesce(p_tipo, 'comprobante')
  end;
$function$;


-- ── El número solo se quema cuando se pidió comprobante ─────────────────────

create or replace function public.set_sale_ncf()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.ncf is null and coalesce(new.ncf_requested, false) then
    new.ncf := public.assign_ncf(new.company_id, new.ncf_type::text);
  end if;
  return new;
end;
$function$;

-- Función de trigger: la invoca Postgres, no la app (misma regla que el resto).
revoke all on function public.set_sale_ncf() from public, anon, authenticated;


-- ── assign_ncf: mismo comportamiento, errores que el cajero puede accionar ──
--
-- Antes lanzaba 'No hay secuencia NCF activa disponible para el tipo consumer',
-- que llega crudo al toast del POS. Ahora distingue los dos casos, que se
-- arreglan distinto: nunca se registró el rango, o se agotó/venció.

create or replace function public.assign_ncf(p_company uuid, p_ncf_type text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_enabled    boolean;
  v_seq        public.ncf_sequences%rowtype;
  v_ncf        text;
  v_registered integer;
begin
  select ncf_enabled into v_enabled from public.companies where id = p_company;
  if not coalesce(v_enabled, false) then
    return null; -- empresa que no emite comprobantes: venta sin NCF
  end if;

  select * into v_seq
  from public.ncf_sequences
  where company_id = p_company
    and tipo = p_ncf_type
    and active
    and current_val <= range_to
    and (expires_at is null or expires_at >= current_date)
  order by created_at
  limit 1
  for update;

  if not found then
    select count(*) into v_registered
      from public.ncf_sequences
     where company_id = p_company and tipo = p_ncf_type;

    if v_registered = 0 then
      raise exception 'No hay secuencia de % registrada. Un administrador debe cargar el rango autorizado por DGII en Perfil de Empresa → Facturación Fiscal.',
        public.ncf_tipo_label(p_ncf_type);
    else
      raise exception 'La secuencia de % se agotó, venció o está inactiva. Un administrador debe registrar el nuevo rango autorizado por DGII en Perfil de Empresa → Facturación Fiscal.',
        public.ncf_tipo_label(p_ncf_type);
    end if;
  end if;

  v_ncf := coalesce(v_seq.prefix, '') || lpad(v_seq.current_val::text, 8, '0');

  update public.ncf_sequences set current_val = current_val + 1 where id = v_seq.id;

  return v_ncf;
end;
$function$;


-- ── La venta tiene que poder decir que pidió comprobante ───────────────────
--
-- create_sale_with_items inserta con lista explícita de columnas: sin agregar
-- ncf_requested aquí, el campo que manda la app se descarta en silencio y
-- ninguna venta tomaría NCF nunca. El resto de la función queda igual.

create or replace function public.create_sale_with_items(p_sale jsonb, p_items jsonb)
returns sales
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sale public.sales%rowtype;
  v_item record;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un artículo.';
  end if;

  insert into public.sales (
    branch_id, customer_id, subtotal, itbis_amount, total, itbis_included,
    payment_method, payment_status, amount_paid, payment_reference, ncf,
    ncf_type, ncf_requested, down_payment_method, down_payment_reference, notes,
    financing_details, user_name, user_email, quote_id, coupon_id
  ) values (
    nullif(p_sale->>'branch_id', '')::uuid,
    nullif(p_sale->>'customer_id', '')::uuid,
    coalesce((p_sale->>'subtotal')::numeric, 0),
    coalesce((p_sale->>'itbis_amount')::numeric, 0),
    coalesce((p_sale->>'total')::numeric, 0),
    coalesce((p_sale->>'itbis_included')::boolean, false),
    (p_sale->>'payment_method')::payment_method,
    (p_sale->>'payment_status')::payment_status,
    coalesce((p_sale->>'amount_paid')::numeric, 0),
    nullif(p_sale->>'payment_reference', ''), nullif(p_sale->>'ncf', ''),
    (p_sale->>'ncf_type')::ncf_type,
    coalesce((p_sale->>'ncf_requested')::boolean, false),
    nullif(p_sale->>'down_payment_method', ''),
    nullif(p_sale->>'down_payment_reference', ''), nullif(p_sale->>'notes', ''),
    p_sale->'financing_details', nullif(p_sale->>'user_name', ''),
    nullif(p_sale->>'user_email', ''), nullif(p_sale->>'quote_id', '')::uuid,
    nullif(p_sale->>'coupon_id', '')::uuid
  ) returning * into v_sale;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      product_id uuid, product_name text, quantity numeric, price numeric,
      custom_price numeric, itbis boolean, unit text
    )
  loop
    insert into public.sale_items
      (sale_id, product_id, product_name, quantity, price, custom_price, itbis, unit, cost)
    values (
      v_sale.id, v_item.product_id, v_item.product_name, v_item.quantity,
      v_item.price, v_item.custom_price, coalesce(v_item.itbis, false),
      coalesce(nullif(v_item.unit, ''), 'und'),
      (select p.cost from public.products p where p.id = v_item.product_id)
    );
  end loop;

  return v_sale;
end;
$function$;
