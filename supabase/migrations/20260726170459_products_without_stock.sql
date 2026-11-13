-- Productos que no se gastan: platos preparados, servicios, tarifas. Se venden
-- sin descontar existencias y sin poder quedarse "agotados".
--
-- Fase 1 de la idea de restaurante: por ahora el plato no consume nada. La
-- fase 2 (recetas: vender 1 hamburguesa descuenta 1 pan y 150 g de carne)
-- se construirá sobre esta misma bandera.
--
-- IMPORTANTE: los cuerpos de estas funciones salen de la definición VIVA en la
-- nube (pg_get_functiondef), no de los archivos del repo: varias se
-- corrigieron directo en la base y el repo quedó desactualizado.

alter table public.products
  add column tracks_stock boolean not null default true;

comment on column public.products.tracks_stock is
  'false = el producto no maneja existencias (plato preparado, servicio): no descuenta stock al venderse ni se agota.';

-- ── Venta: no descontar ─────────────────────────────────────────────────────
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

  -- Un producto que no maneja existencias se vende siempre, sin tocar stock.
  -- Si el producto no existe, coalesce deja pasar para que el error de abajo
  -- siga siendo el correcto ("no pertenece a esta empresa").
  if not coalesce((
    select tracks_stock from public.products
     where id = new.product_id and company_id = v_company
  ), true) then
    return new;
  end if;

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

-- ── Servicios: mismo criterio al consumir repuestos ─────────────────────────
create or replace function public.handle_service_item_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- El "and tracks_stock" hace que los productos sin inventario no muevan
  -- existencias; la función no comprueba FOUND, así que no afecta nada más.
  if TG_OP = 'INSERT' then
    update public.products
       set stock = stock - NEW.quantity
     where id = NEW.product_id and tracks_stock;

    update public.services
       set parts_total = parts_total + (NEW.price * NEW.quantity)
     where id = NEW.service_id;

  elsif TG_OP = 'DELETE' then
    update public.products
       set stock = stock + OLD.quantity
     where id = OLD.product_id and tracks_stock;

    update public.services
       set parts_total = parts_total - (OLD.price * OLD.quantity)
     where id = OLD.service_id;

  elsif TG_OP = 'UPDATE' then
    update public.products
       set stock = stock + OLD.quantity - NEW.quantity
     where id = NEW.product_id and tracks_stock;

    update public.services
       set parts_total = parts_total - (OLD.price * OLD.quantity) + (NEW.price * NEW.quantity)
     where id = NEW.service_id;
  end if;
  return null;
end;
$function$;

-- ── Anulación: no reponer lo que nunca se descontó ──────────────────────────
create or replace function public.annul_sale(
  p_sale_id uuid,
  p_reason text default null,
  p_refund_method text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale          sales%rowtype;
  v_seq           ncf_sequences%rowtype;
  v_session       caja_sessions%rowtype;
  v_item          record;
  v_ncf           text := null;
  v_user_name     text;
  v_note_id       uuid;
  v_refund_method text;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;

  -- La función es SECURITY DEFINER (salta RLS para tomar la secuencia B04 y
  -- escribir credit_notes), así que el permiso se valida aquí. V1: solo
  -- administradores de la empresa; los roles personalizados con sales:delete
  -- ven el botón pero la base los rechaza (pendiente de unificar).
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede anular ventas.';
  end if;

  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta ya fue anulada.';
  end if;
  if v_sale.payment_status in ('credit', 'in_financing') then
    raise exception 'Las ventas a crédito o financiadas no se pueden anular: gestiona sus abonos desde Cuentas por Cobrar.';
  end if;

  -- payment_method es un enum en la base: se compara/almacena como texto aquí.
  v_refund_method := coalesce(p_refund_method, v_sale.payment_method::text);
  if v_refund_method not in ('cash', 'card', 'transfer') then
    raise exception 'Método de devolución no válido.';
  end if;

  -- NCF B04: solo si la venta original llevó comprobante.
  if v_sale.ncf is not null then
    select * into v_seq from ncf_sequences
     where company_id = v_sale.company_id
       and tipo = 'nota_credito'
       and active
       and (expires_at is null or expires_at >= current_date)
       and current_val <= range_to
     order by created_at
     limit 1
     for update;
    if not found then
      raise exception 'No hay una secuencia de Notas de Crédito (B04) activa con números disponibles. Agrégala en Perfil de Sucursal → Facturación Fiscal.';
    end if;
    v_ncf := v_seq.prefix || lpad(v_seq.current_val::text, 8, '0');
    update ncf_sequences set current_val = current_val + 1 where id = v_seq.id;
  end if;

  -- La devolución en efectivo sale de la caja: si el módulo está activo,
  -- exige caja abierta (mismo criterio que los pagos a suplidores).
  if v_refund_method = 'cash'
     and is_module_enabled(v_sale.company_id, 'caja', false)
     and (v_sale.branch_id is null or not has_open_caja(v_sale.branch_id)) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de devolver efectivo.';
  end if;

  -- Reponer inventario de las líneas con producto. Los que no manejan
  -- existencias quedan fuera: nunca se les descontó nada al vender.
  for v_item in
    select si.product_id, si.quantity
      from sale_items si
      join products p on p.id = si.product_id and p.company_id = v_sale.company_id
     where si.sale_id = v_sale.id
       and si.product_id is not null
       and p.tracks_stock
  loop
    update products set stock = stock + v_item.quantity
     where id = v_item.product_id and company_id = v_sale.company_id;
  end loop;

  select name into v_user_name from profiles where id = auth.uid();

  insert into credit_notes
    (company_id, branch_id, sale_id, customer_id, ncf, ncf_modified,
     subtotal, itbis_amount, total, refund_method, reason, user_id, user_name)
  values
    (v_sale.company_id, v_sale.branch_id, v_sale.id, v_sale.customer_id,
     v_ncf, v_sale.ncf, v_sale.subtotal, v_sale.itbis_amount, v_sale.total,
     v_refund_method, nullif(p_reason, ''), auth.uid(), v_user_name)
  returning id into v_note_id;

  update sales set cancelled_at = now() where id = v_sale.id;

  if v_refund_method = 'cash' and is_module_enabled(v_sale.company_id, 'caja', false) then
    select * into v_session from caja_sessions
     where branch_id = v_sale.branch_id and status = 'open' for update;
    if found then
      insert into caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values
        (v_session.id, v_sale.company_id, v_sale.branch_id, 'out', v_sale.total,
         'Devolución por anulación de venta'
           || case when v_ncf is not null then ' · NC ' || v_ncf else '' end,
         auth.uid(), v_user_name);
    end if;
  end if;

  return jsonb_build_object(
    'credit_note_id', v_note_id,
    'ncf',            v_ncf,
    'ncf_modified',   v_sale.ncf,
    'total',          v_sale.total,
    'refund_method',  v_refund_method
  );
end;
$function$;

-- ── Compras: no sumar existencias a lo que no las lleva ─────────────────────
create or replace function public.create_supplier_invoice(
  p_supplier_id uuid,
  p_issue_date date,
  p_branch_id uuid default null,
  p_invoice_number text default null,
  p_due_date date default null,
  p_subtotal_goods numeric default 0,
  p_subtotal_services numeric default 0,
  p_ncf text default null,
  p_ncf_modified text default null,
  p_expense_type text default null,
  p_itbis_facturado numeric default 0,
  p_itbis_retenido numeric default 0,
  p_itbis_proporcionalidad numeric default 0,
  p_itbis_llevado_costo numeric default 0,
  p_isr_retention_type text default null,
  p_isr_retention_amount numeric default 0,
  p_impuesto_selectivo numeric default 0,
  p_otros_impuestos numeric default 0,
  p_propina_legal numeric default 0,
  p_payment_form text default null,
  p_notes text default null,
  p_initial_payment numeric default 0,
  p_initial_method text default 'cash',
  p_initial_reference text default null,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_company      uuid;
  v_goods        numeric := coalesce(p_subtotal_goods, 0);
  v_services     numeric := coalesce(p_subtotal_services, 0);
  v_ncf          text    := nullif(trim(coalesce(p_ncf, '')), '');
  v_total        numeric;
  v_invoice      supplier_invoices%rowtype;
  v_item         record;
  v_desc         text;
  v_user_name    text;
  v_purchases_on boolean;
  v_pay          jsonb;
begin
  v_company := current_company_id();

  if not exists (select 1 from suppliers where id = p_supplier_id and company_id = v_company) then
    raise exception 'Suplidor no encontrado.';
  end if;
  if p_issue_date is null then
    raise exception 'La fecha del comprobante es obligatoria.';
  end if;
  if v_goods + v_services <= 0 then
    raise exception 'El monto facturado debe ser mayor que cero.';
  end if;
  if v_ncf is not null and upper(v_ncf) !~ '^[BE][0-9]{10,12}$' then
    raise exception 'El NCF no tiene un formato válido (ej. B0100000001).';
  end if;
  if v_ncf is not null and p_expense_type is null then
    raise exception 'Con NCF, el tipo de gasto (Formato 606) es obligatorio.';
  end if;
  if v_ncf is not null and exists (
    select 1 from supplier_invoices
     where company_id = v_company and supplier_id = p_supplier_id and ncf = upper(v_ncf)
  ) then
    raise exception 'Ya existe una factura con ese NCF para este suplidor.';
  end if;

  v_total := v_goods + v_services
           + coalesce(p_itbis_facturado, 0) + coalesce(p_impuesto_selectivo, 0)
           + coalesce(p_otros_impuestos, 0) + coalesce(p_propina_legal, 0);

  if coalesce(p_itbis_retenido, 0) + coalesce(p_isr_retention_amount, 0) > v_total then
    raise exception 'Las retenciones no pueden exceder el total de la factura.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into supplier_invoices (
    company_id, branch_id, supplier_id, invoice_number, issue_date, due_date,
    subtotal_goods, subtotal_services, total,
    ncf, ncf_modified, expense_type,
    itbis_facturado, itbis_retenido, itbis_proporcionalidad, itbis_llevado_costo,
    isr_retention_type, isr_retention_amount,
    impuesto_selectivo, otros_impuestos, propina_legal,
    payment_form, notes, user_id, user_name
  ) values (
    v_company, p_branch_id, p_supplier_id, nullif(trim(coalesce(p_invoice_number, '')), ''),
    p_issue_date, p_due_date,
    v_goods, v_services, v_total,
    upper(v_ncf), nullif(trim(coalesce(p_ncf_modified, '')), ''), p_expense_type,
    coalesce(p_itbis_facturado, 0), coalesce(p_itbis_retenido, 0),
    coalesce(p_itbis_proporcionalidad, 0), coalesce(p_itbis_llevado_costo, 0),
    p_isr_retention_type, coalesce(p_isr_retention_amount, 0),
    coalesce(p_impuesto_selectivo, 0), coalesce(p_otros_impuestos, 0), coalesce(p_propina_legal, 0),
    p_payment_form, p_notes, auth.uid(), v_user_name
  ) returning * into v_invoice;

  v_purchases_on := is_module_enabled(v_company, 'purchases', false);

  for v_item in
    select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as x(product_id uuid, description text, quantity numeric, unit_cost numeric, itbis_amount numeric)
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'La cantidad de cada línea debe ser mayor que cero.';
    end if;
    if coalesce(v_item.unit_cost, -1) < 0 then
      raise exception 'El costo unitario de cada línea no puede ser negativo.';
    end if;

    v_desc := nullif(trim(coalesce(v_item.description, '')), '');
    if v_desc is null and v_item.product_id is not null then
      select name into v_desc from products where id = v_item.product_id and company_id = v_company;
    end if;
    if v_desc is null then
      raise exception 'Cada línea debe tener una descripción.';
    end if;

    insert into supplier_invoice_items
      (company_id, invoice_id, product_id, description, quantity, unit_cost, itbis_amount)
    values
      (v_company, v_invoice.id, v_item.product_id, v_desc,
       v_item.quantity, v_item.unit_cost, coalesce(v_item.itbis_amount, 0));

    -- Solo con el módulo 'purchases' activo la compra entra al inventario, y
    -- solo si el producto maneja existencias. La comprobación de pertenencia
    -- va aparte para que un producto sin inventario no dispare su error.
    if v_purchases_on and v_item.product_id is not null then
      if not exists (
        select 1 from products where id = v_item.product_id and company_id = v_company
      ) then
        raise exception 'Producto no encontrado para esta empresa.';
      end if;
      update products set stock = stock + v_item.quantity
       where id = v_item.product_id and company_id = v_company and tracks_stock;
    end if;
  end loop;

  if coalesce(p_initial_payment, 0) > 0 then
    v_pay := register_supplier_payment(
      v_invoice.id, p_initial_payment, coalesce(p_initial_method, 'cash'),
      p_branch_id, 'Pago inicial', p_initial_reference);
    select * into v_invoice from supplier_invoices where id = v_invoice.id;
  end if;

  return jsonb_build_object(
    'invoice_id',      v_invoice.id,
    'total',           v_invoice.total,
    'status',          v_invoice.status,
    'balance',         v_invoice.balance,
    'initial_payment', v_pay
  );
end;
$function$;

grant execute on function public.create_supplier_invoice to authenticated;
