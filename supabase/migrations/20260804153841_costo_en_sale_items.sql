-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- El costo se congela en la línea al vender, tomándolo del producto en ese
-- momento. Calcular la ganancia contra el costo actual mentía en cuanto el
-- costo del producto cambiaba: las ventas viejas se recalculaban solas.

CREATE OR REPLACE FUNCTION public.create_sale_with_items(p_sale jsonb, p_items jsonb)
 RETURNS sales
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
