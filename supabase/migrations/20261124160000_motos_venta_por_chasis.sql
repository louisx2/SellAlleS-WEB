-- Motopréstamos 2A: venta y anulación por chasis.
-- Plan: docs/superpowers/plans/2026-11-23-motoprestamos-entrega-2a-vehiculos.md (Task 3)
-- Va después de 20261124150000_motos_vehiculos.sql.
--
-- Parte de la definición viva (pg_get_functiondef) del 2026-11-24.
-- huella previa (md5 de prosrc sin \r):
--   create_sale_with_items                 d3123c9369728de2d67b711194b7f81c
--   decrement_product_stock_for_sale_item  21d136c614f498ae7d7edc152a60bb1b
--   annul_sale                             2b253a85f4db29758499ecfc1f7db6c4
-- Pruebas: supabase/tests/motos_venta.sql

-- 1. Gancho de venta: la línea con vehicle_id vende ESA unidad --------------------

create or replace function public.motos_vincular_venta(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  r      record;
  v      public.vehicles%rowtype;
begin
  if not exists (select 1 from public.sale_items where sale_id = p_sale_id and vehicle_id is not null) then
    return;
  end if;

  -- La llama create_sale_with_items como el usuario (por eso authenticated la
  -- puede ejecutar): solo actúa sobre una venta vigente de su empresa.
  select * into v_sale from public.sales where id = p_sale_id;
  if not found or (v_sale.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta ya fue anulada.';
  end if;
  if v_sale.customer_id is null then
    raise exception 'Para vender un vehículo elige el cliente.';
  end if;
  if exists (
    select 1 from public.sale_items
     where sale_id = p_sale_id and vehicle_id is not null
     group by vehicle_id having count(*) > 1
  ) then
    raise exception 'El mismo vehículo está dos veces en la venta.';
  end if;

  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.evento', 'venta', true);

  for r in
    select si.* from public.sale_items si
     where si.sale_id = p_sale_id and si.vehicle_id is not null
     order by si.id
  loop
    -- Bloqueada: dos cajas vendiendo el mismo chasis, la segunda espera y falla.
    select * into v from public.vehicles where id = r.vehicle_id for update;
    if not found or v.company_id <> v_sale.company_id then
      raise exception 'Vehículo no encontrado.';
    end if;
    if v.status <> 'disponible' then
      raise exception 'El vehículo con chasis % no está disponible.', coalesce(v.chassis, '(sin chasis)');
    end if;
    if v.branch_id <> v_sale.branch_id or v.product_id is distinct from r.product_id then
      raise exception 'El vehículo no corresponde a ese artículo en esta sucursal.';
    end if;
    if r.quantity <> 1 or r.presentation_id is not null then
      raise exception 'Cada vehículo se vende en su propia línea, con cantidad 1.';
    end if;

    update public.vehicles
       set status = 'vendido',
           customer_id = v_sale.customer_id,
           sale_id = v_sale.id,
           -- A crédito o financiada, la matrícula queda guardada hasta saldar.
           registration_status = case when v_sale.payment_status::text in ('credit', 'in_financing')
                                      then 'en_custodia' else 'entregada' end,
           registration_since = now()
     where id = v.id;

    -- La línea lleva el costo de ESA unidad y su descripción (chasis y motor en
    -- la factura).
    update public.sale_items
       set cost = coalesce(v.cost, cost),
           product_name = public.motos_descripcion(v)
     where id = r.id;
  end loop;

  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
end;
$$;

-- 2. Gancho de anulación: la unidad vuelve a estar disponible -----------------------

create or replace function public.motos_anular_venta(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.evento', 'venta_anulada', true);
  update public.vehicles
     set status = 'disponible', customer_id = null, sale_id = null,
         registration_status = 'no_aplica', registration_since = null
   where sale_id = p_sale_id and status = 'vendido';
  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
end;
$$;

revoke execute on function public.motos_vincular_venta(uuid) from public, anon;
revoke execute on function public.motos_anular_venta(uuid) from public, anon, authenticated;
grant execute on function public.motos_vincular_venta(uuid) to authenticated, service_role;
grant execute on function public.motos_anular_venta(uuid) to service_role;

-- 3. Stock: la línea de un vehículo no descuenta (lo hace el cambio de estado) ------

create or replace function public.decrement_product_stock_for_sale_item()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  -- Línea de un caso del taller: la pieza salió del inventario al agregarla al
  -- caso. taller_vincular_venta comprueba que la línea sea de verdad del caso.
  if new.service_item_id is not null then
    return new;
  end if;

  -- Línea de un vehículo: el stock baja cuando motos_vincular_venta lo marca
  -- vendido (el stock de un artículo-vehículo es derivado de sus unidades).
  if new.vehicle_id is not null then
    return new;
  end if;

  if new.product_id is null then
    return new;
  end if;

  -- Un artículo-vehículo sin chasis elegido (cotización convertida, app vieja):
  -- mejor esto que un "Stock insuficiente" que nadie entiende.
  if exists (select 1 from public.products where id = new.product_id and is_vehicle) then
    raise exception 'Elige el chasis de «%» antes de cobrar.', new.product_name;
  end if;

  if coalesce(new.quantity, 0) <= 0 then
    raise exception 'La cantidad vendida debe ser mayor que cero.';
  end if;

  v_company := current_company_id();

  if not coalesce((
    select tracks_stock from public.products
     where id = new.product_id and company_id = v_company
  ), true) then
    return new;
  end if;

  -- El stock se cuenta en unidad base: una línea de presentación descuenta
  -- quantity × units_per (units_per es 1 en las sueltas). Cada línea descuenta
  -- y compara contra lo que dejaron las anteriores de la misma venta, así que
  -- el mismo producto en dos líneas se valida contra la suma.
  update public.products
     set stock = stock - new.quantity * new.units_per
   where id = new.product_id
     and company_id = v_company
     and stock >= new.quantity * new.units_per;

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

-- 4. Venta: acepta vehicle_id por línea y llama al gancho ---------------------------

create or replace function public.create_sale_with_items(p_sale jsonb, p_items jsonb)
 returns sales
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_sale public.sales%rowtype;
  v_item record;
  v_tiene_rapidos boolean;
  v_units_per numeric;
  v_pres_id uuid;
  v_pres_name text;
  v_nombre text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un artículo.';
  end if;

  insert into public.sales (
    branch_id, customer_id, subtotal, itbis_amount, total, itbis_included,
    payment_method, payment_status, amount_paid, payment_reference, ncf,
    ncf_type, ncf_requested, down_payment_method, down_payment_reference, notes,
    financing_details, user_name, user_email, quote_id, coupon_id, seller_id, service_id
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
    nullif(p_sale->>'coupon_id', '')::uuid,
    nullif(p_sale->>'seller_id', '')::uuid,
    nullif(p_sale->>'service_id', '')::uuid
  ) returning * into v_sale;

  select coalesce(bool_or(coalesce((x->>'is_quick')::boolean, false)), false)
    into v_tiene_rapidos
    from jsonb_array_elements(p_items) x;

  if v_tiene_rapidos then
    if not is_module_enabled(v_sale.company_id, 'quick-sales', true) then
      raise exception 'Las ventas rápidas están desactivadas para esta empresa.';
    end if;
    if not puede_vender_rapido(v_sale.branch_id) then
      raise exception 'Tu rol no permite ventas rápidas en esta sucursal.';
    end if;
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      product_id uuid, product_name text, quantity numeric, price numeric,
      custom_price numeric, itbis boolean, unit text, is_quick boolean, cost numeric,
      presentation_id uuid, units_per numeric, service_item_id uuid, vehicle_id uuid
    )
  loop
    -- Lo que la línea mueva del inventario lo decide el servidor: nombre y
    -- unidades de la presentación salen de su fila, nunca del navegador. Sin
    -- presentación la línea es suelta (1 unidad base).
    v_units_per := 1;
    v_pres_id := null;
    v_pres_name := null;

    if coalesce(v_item.is_quick, false) then
      if v_item.product_id is not null then
        raise exception 'Un artículo rápido no puede llevar producto.';
      end if;
      if v_item.presentation_id is not null then
        raise exception 'Un artículo rápido no puede llevar presentación.';
      end if;
      if btrim(coalesce(v_item.product_name, '')) = '' then
        raise exception 'Escribe la descripción del artículo rápido.';
      end if;
      if v_item.price is null or v_item.price < 0 then
        raise exception 'El precio del artículo rápido no puede ser negativo.';
      end if;
      if v_item.quantity is null or v_item.quantity <= 0 then
        raise exception 'La cantidad vendida debe ser mayor que cero.';
      end if;
      if v_item.cost is not null and v_item.cost < 0 then
        raise exception 'El costo del artículo rápido no puede ser negativo.';
      end if;
    elsif v_item.presentation_id is not null then
      -- Se busca por id y tiene que ser de este producto (la RLS de
      -- product_presentations deja fuera las de otras empresas y sucursales).
      select pp.id, pp.name, pp.units
        into v_pres_id, v_pres_name, v_units_per
        from public.product_presentations pp
       where pp.id = v_item.presentation_id and pp.product_id = v_item.product_id;
      if not found then
        raise exception 'La presentación no corresponde a este producto.';
      end if;
      -- El carrito manda las unidades que tenía la presentación al agregarla. Si
      -- ya no son las de hoy (carrito guardado, otra tableta), el precio de la
      -- línea es el de la presentación vieja. Sin el dato (app vieja) pasa igual.
      if v_item.units_per is not null and v_item.units_per <> v_units_per then
        raise exception 'La presentación «%» cambió; quítala del carrito y vuelve a agregarla.', v_pres_name;
      end if;
      if v_item.quantity <> trunc(v_item.quantity) then
        raise exception 'Las presentaciones van enteras: la cantidad tiene que ser un número entero.';
      end if;
    elsif v_item.product_id is not null then
      select p.name into v_nombre
        from public.products p
       where p.id = v_item.product_id and not p.sold_loose;
      if found then
        raise exception '«%» no se vende suelto.', v_nombre;
      end if;
    end if;

    insert into public.sale_items
      (sale_id, product_id, product_name, quantity, price, custom_price, itbis, unit, cost, is_quick,
       presentation_id, presentation_name, units_per, service_item_id, vehicle_id)
    values (
      v_sale.id, v_item.product_id,
      case when coalesce(v_item.is_quick, false) then btrim(v_item.product_name) else v_item.product_name end,
      v_item.quantity,
      v_item.price, v_item.custom_price, coalesce(v_item.itbis, false),
      coalesce(nullif(v_item.unit, ''), 'und'),
      case
        when coalesce(v_item.is_quick, false) then v_item.cost
        else (select p.cost from public.products p where p.id = v_item.product_id) * v_units_per
      end,
      coalesce(v_item.is_quick, false),
      v_pres_id, v_pres_name, v_units_per, v_item.service_item_id, v_item.vehicle_id
    );
  end loop;

  -- Venta de un caso del taller: comprueba sus líneas y lo marca cobrado.
  perform public.taller_vincular_venta(v_sale.id);
  -- Venta de vehículos: cada línea con chasis vende esa unidad.
  perform public.motos_vincular_venta(v_sale.id);

  return v_sale;
end;
$function$;

-- 5. Anulación: no repone stock de líneas de vehículo y devuelve la unidad -----------
-- Cambian dos cosas respecto a la viva: el filtro `si.vehicle_id is null` del
-- bucle de reposición y la llamada a motos_anular_venta después del taller.

create or replace function public.annul_sale(p_sale_id uuid, p_reason text default null::text, p_refund_method text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale          sales%rowtype;
  v_seq           ncf_sequences%rowtype;
  v_session       caja_sessions%rowtype;
  v_item          record;
  v_pay           credit_payments%rowtype;
  v_ncf           text := null;
  v_user_name     text;
  v_note_id       uuid;
  v_refund_method text;
  v_is_credit     boolean;
  v_down_paid     numeric := 0;
  v_down_method   text;
  v_voided        numeric := 0;
  v_cash_out      numeric := 0;
  v_void_reason   text;
  v_doc_estado    text;
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

  v_is_credit := v_sale.payment_status in ('credit', 'in_financing');

  if v_is_credit then
    select coalesce(sum(amount), 0), min(method::text)
      into v_down_paid, v_down_method
      from credit_payments
     where sale_id = v_sale.id and kind = 'down_payment' and voided_at is null;

    -- Abonos posteriores todavía vigentes: los que nombran la venta, los
    -- generales cuyo reparto la tocó y, para los viejos sin reparto
    -- registrado, lo que `amount_paid` tenga por encima del abono inicial.
    if exists (
         select 1 from credit_payments cp
          where cp.voided_at is null
            and cp.kind <> 'down_payment'
            and (cp.sale_id = v_sale.id
                 or exists (select 1
                              from jsonb_array_elements(coalesce(cp.allocation->'sales', '[]'::jsonb)) e
                             where e->>'sale_id' = v_sale.id::text))
       )
       or v_sale.amount_paid > v_down_paid + 0.01 then
      raise exception 'Esta venta tiene abonos posteriores al abono inicial. Anúlalos primero desde el detalle de la venta (o el estado de cuenta del cliente) y luego anula la venta.';
    end if;

    -- Sin abono inicial no hay nada que devolver.
    v_refund_method := case
      when p_refund_method = 'none' or v_down_paid <= 0 then 'none'
      else v_down_method
    end;
    if p_refund_method is not null and p_refund_method not in ('none', v_refund_method) then
      raise exception 'El abono inicial entró por %: la devolución sale por esa misma vía, o elige "Sin devolución".',
        case v_down_method when 'cash' then 'efectivo' when 'card' then 'tarjeta' else 'transferencia' end;
    end if;
  else
    -- payment_method es un enum en la base: se compara/almacena como texto aquí.
    -- Sin método explícito se asume que el dinero vuelve por donde entró; 'none'
    -- hay que pedirlo a propósito, para que no se anule sin devolver por descuido.
    v_refund_method := coalesce(p_refund_method, v_sale.payment_method::text);
  end if;

  if v_refund_method not in ('cash', 'card', 'transfer', 'none') then
    raise exception 'Método de devolución no válido.';
  end if;

  -- NCF de la nota de crédito: solo si la venta original llevó comprobante.
  -- Una venta facturada por error igual consumió su NCF, así que la nota de
  -- crédito se emite aunque no haya devolución: es lo que la deja anulada ante
  -- la DGII.
  if v_sale.ncf is not null then
    if v_sale.ncf ~ '^E\d{12}$' then
      -- Una venta con e-NCF solo se anula con una E34, y la E34 solo se emite
      -- con el e-CF activo: suspendido (o apagado) no se anula ni con una B04.
      if not ecf_activa(v_sale.company_id) then
        raise exception 'La facturación electrónica de esta empresa no está activa; no se puede anular una venta con comprobante electrónico hasta reactivarla.';
      end if;

      -- e-CF: lo que se puede hacer depende de en qué quedó el comprobante
      -- original (el vigente: el que no ha sido reemplazado por otro). Se lee
      -- bloqueado para que su estado no cambie mientras se decide.
      select d.estado into v_doc_estado
        from ecf_documentos d
       where d.sale_id = v_sale.id and d.reemplazado_por is null
       order by d.created_at desc
       limit 1
       for share;

      -- Sin enviar a la DGII no hay nada contra qué emitir la nota de crédito.
      if v_doc_estado in ('por_enviar', 'enviando', 'error_datos', 'sin_cupo') then
        raise exception 'Esta venta tiene su e-CF todavía sin enviar a la DGII. Espera a que salga o reintenta el envío antes de anularla.';
      end if;

      -- Rechazado: la DGII nunca lo aceptó, así que se anula sin nota de
      -- crédito (credit_notes.ncf queda null). En cualquier otro estado, aun
      -- recibido y sin respuesta, la E34 sale de la secuencia electrónica.
      if v_doc_estado is distinct from 'rechazado' then
        v_ncf := assign_ncf(v_sale.company_id, 'nota_credito');
      end if;
    else
      select * into v_seq from ncf_sequences
       where company_id = v_sale.company_id
         and tipo = 'nota_credito'
         and not electronica
         and active
         and (expires_at is null or expires_at >= company_today(v_sale.company_id))
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
  end if;

  -- La devolución en efectivo sale de la caja: si el módulo está activo,
  -- exige caja abierta (mismo criterio que los pagos a suplidores). Sin
  -- devolución no hay salida de dinero, así que la caja no hace falta.
  if v_refund_method = 'cash' and caja_blocks_cash(v_sale.company_id, v_sale.branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de devolver efectivo.';
  end if;

  -- Reponer inventario de las líneas con producto. Los productos que no
  -- manejan existencias quedan fuera: nunca se les descontó nada al vender.
  -- Se repone en unidad base (quantity × units_per, los de la línea: la
  -- presentación pudo haberse editado o borrado después de vender).
  for v_item in
    select si.product_id, si.quantity * si.units_per as base_qty
      from sale_items si
      join products p on p.id = si.product_id and p.company_id = v_sale.company_id
     where si.sale_id = v_sale.id
       and si.product_id is not null
       and p.tracks_stock
       -- Las piezas de un caso del taller siguen en el equipo del cliente.
       and si.service_item_id is null
       -- Un vehículo vuelve con motos_anular_venta (su stock es derivado).
       and si.vehicle_id is null
  loop
    update products set stock = stock + v_item.base_qty
     where id = v_item.product_id and company_id = v_sale.company_id;
  end loop;

  select name into v_user_name from profiles where id = auth.uid();

  if v_is_credit then
    v_void_reason := 'Venta anulada' || coalesce(': ' || nullif(btrim(p_reason), ''), '');

    if v_refund_method = 'cash' and is_module_enabled(v_sale.company_id, 'caja', false) then
      select * into v_session from caja_sessions
       where branch_id = v_sale.branch_id and status = 'open' for update;
    end if;

    for v_pay in
      select * from credit_payments
       where sale_id = v_sale.id and kind = 'down_payment' and voided_at is null
       for update
    loop
      update credit_payments
         set voided_at = now(), voided_by = auth.uid(),
             voided_by_name = v_user_name, void_reason = v_void_reason
       where id = v_pay.id;
      v_voided := v_voided + v_pay.amount;

      -- Cobrado en la sesión que sigue abierta: basta con anularlo, el cierre
      -- ya no lo cuenta. Cobrado en una sesión que ya cerró con ese dinero
      -- contado: hay que sacarlo de la caja abierta ahora.
      if v_refund_method = 'cash' and v_pay.method = 'cash'
         and v_session.id is not null and v_session.opened_at > v_pay.date then
        v_cash_out := v_cash_out + v_pay.amount;
      end if;
    end loop;

    update sales set amount_paid = greatest(round(amount_paid - v_voided, 2), 0)
     where id = v_sale.id;
  end if;

  insert into credit_notes
    (company_id, branch_id, sale_id, customer_id, ncf, ncf_modified,
     subtotal, itbis_amount, total, refund_method, reason, user_id, user_name)
  values
    (v_sale.company_id, v_sale.branch_id, v_sale.id, v_sale.customer_id,
     v_ncf, v_sale.ncf, v_sale.subtotal, v_sale.itbis_amount, v_sale.total,
     v_refund_method, nullif(p_reason, ''), auth.uid(), v_user_name)
  returning id into v_note_id;

  update sales set cancelled_at = now() where id = v_sale.id;

  -- El caso del taller vuelve a quedar por cobrar.
  perform set_config('taller.cobro', 'si', true);
  update services set sale_id = null, payment_status = 'pending', amount_paid = 0
   where sale_id = v_sale.id;
  perform set_config('taller.cobro', '', true);

  -- Los vehículos de la venta vuelven a estar disponibles.
  perform public.motos_anular_venta(v_sale.id);

  if v_is_credit then
    if v_cash_out > 0 then
      insert into caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values
        (v_session.id, v_sale.company_id, v_sale.branch_id, 'out', v_cash_out,
         'Devolución del abono inicial por anulación de venta'
           || case when v_ncf is not null then ' · NC ' || v_ncf else '' end,
         auth.uid(), v_user_name);
    end if;
    perform recompute_customer_balance(v_sale.customer_id);
  elsif v_refund_method = 'cash' and is_module_enabled(v_sale.company_id, 'caja', false) then
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
    'refund_method',  v_refund_method,
    'payments_voided', v_voided
  );
end;
$function$;
