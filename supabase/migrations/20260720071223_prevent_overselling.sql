-- El descuento de inventario debe ocurrir en la base, no en el navegador:
-- así dos cajas no pueden vender simultáneamente la misma última unidad.
create or replace function public.decrement_product_stock_for_sale_item()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  -- Las líneas libres (sin producto de inventario) no afectan existencias.
  if new.product_id is null then
    return new;
  end if;

  if coalesce(new.quantity, 0) <= 0 then
    raise exception 'La cantidad vendida debe ser mayor que cero.';
  end if;

  v_company := current_company_id();

  -- UPDATE adquiere el bloqueo de fila y solo descuenta cuando todavía hay
  -- unidades suficientes; por eso la comprobación es segura ante concurrencia.
  update public.products
     set stock = stock - new.quantity
   where id = new.product_id
     and company_id = v_company
     and stock >= new.quantity;

  if not found then
    if exists (
      select 1 from public.products
       where id = new.product_id and company_id = v_company
    ) then
      raise exception 'Stock insuficiente para completar la venta.';
    end if;
    raise exception 'El producto seleccionado no pertenece a esta empresa.';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_decrement_product_stock_for_sale_item on public.sale_items;
create trigger trg_decrement_product_stock_for_sale_item
before insert on public.sale_items
for each row execute function public.decrement_product_stock_for_sale_item();

-- Crea cabecera y detalles en una única transacción. Si uno de los detalles
-- no tiene inventario, PostgreSQL revierte también la cabecera y cualquier
-- efecto de sus triggers (NCF, crédito, caja, etc.).
--
-- OJO: esta versión inserta payment_method / payment_status / ncf_type sin
-- castear y esas columnas son ENUM, así que falla al vender. Corregido en
-- 20260726123000_fix_create_sale_with_items_enum_casts.sql; no copies este
-- cuerpo al recrear la función.
create or replace function public.create_sale_with_items(
  p_sale jsonb,
  p_items jsonb
) returns public.sales
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
    ncf_type, down_payment_method, down_payment_reference, notes,
    financing_details, user_name, user_email, quote_id, coupon_id
  ) values (
    nullif(p_sale->>'branch_id', '')::uuid,
    nullif(p_sale->>'customer_id', '')::uuid,
    coalesce((p_sale->>'subtotal')::numeric, 0),
    coalesce((p_sale->>'itbis_amount')::numeric, 0),
    coalesce((p_sale->>'total')::numeric, 0),
    coalesce((p_sale->>'itbis_included')::boolean, false),
    p_sale->>'payment_method', p_sale->>'payment_status',
    coalesce((p_sale->>'amount_paid')::numeric, 0),
    nullif(p_sale->>'payment_reference', ''), nullif(p_sale->>'ncf', ''),
    p_sale->>'ncf_type', nullif(p_sale->>'down_payment_method', ''),
    nullif(p_sale->>'down_payment_reference', ''), nullif(p_sale->>'notes', ''),
    p_sale->'financing_details', nullif(p_sale->>'user_name', ''),
    nullif(p_sale->>'user_email', ''), nullif(p_sale->>'quote_id', '')::uuid,
    nullif(p_sale->>'coupon_id', '')::uuid
  ) returning * into v_sale;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      product_id uuid, product_name text, quantity numeric, price numeric,
      custom_price numeric, itbis boolean
    )
  loop
    insert into public.sale_items
      (sale_id, product_id, product_name, quantity, price, custom_price, itbis)
    values (
      v_sale.id, v_item.product_id, v_item.product_name, v_item.quantity,
      v_item.price, v_item.custom_price, coalesce(v_item.itbis, false)
    );
  end loop;

  return v_sale;
end;
$function$;

grant execute on function public.create_sale_with_items(jsonb, jsonb) to authenticated;
