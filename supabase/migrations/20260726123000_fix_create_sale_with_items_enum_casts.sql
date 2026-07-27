-- sales.payment_method, payment_status y ncf_type son ENUM, no text. El jsonb
-- entrega text y PostgreSQL no convierte solo, así que sin los casts el insert
-- revienta en tiempo de ejecución (el cuerpo de una función plpgsql no se
-- valida al crearla, por eso el error solo aparece al vender).
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
    (p_sale->>'payment_method')::payment_method,
    (p_sale->>'payment_status')::payment_status,
    coalesce((p_sale->>'amount_paid')::numeric, 0),
    nullif(p_sale->>'payment_reference', ''), nullif(p_sale->>'ncf', ''),
    (p_sale->>'ncf_type')::ncf_type,
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
      (sale_id, product_id, product_name, quantity, price, custom_price, itbis, unit)
    values (
      v_sale.id, v_item.product_id, v_item.product_name, v_item.quantity,
      v_item.price, v_item.custom_price, coalesce(v_item.itbis, false),
      coalesce(nullif(v_item.unit, ''), 'und')
    );
  end loop;

  return v_sale;
end;
$function$;

grant execute on function public.create_sale_with_items(jsonb, jsonb) to authenticated;
