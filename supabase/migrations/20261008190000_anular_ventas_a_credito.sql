-- Anular ventas a crédito y financiadas.
--
-- `annul_sale` rechazaba toda venta con saldo pendiente ("gestiona sus abonos
-- desde Cuentas por Cobrar"), pero desde ahí no hay forma de deshacer la venta:
-- solo se anulan abonos, y el abono inicial ni eso (es parte de la venta). Una
-- venta a crédito facturada por error quedaba para siempre como deuda del
-- cliente, con el artículo fuera del inventario.
--
-- Ahora un administrador la anula igual que una venta pagada — repone el
-- inventario, emite la nota de crédito B04 si llevó NCF y marca cancelled_at —
-- y además:
--
-- * Anula el abono inicial. Un abono anulado ya no cuenta en el cierre de caja
--   (`close_caja_session` los ignora), que es justo lo que pasa con ese dinero
--   tanto si se le devuelve al cliente como si nunca entró.
-- * Si el abono inicial en efectivo se cobró en una sesión de caja que ya cerró
--   y se le devuelve al cliente, la salida va a la caja abierta (mismo criterio
--   que `void_credit_payment`). Con 'none' no sale nada: el dinero nunca entró.
-- * Recalcula `customers.credit_balance`, que ya ignora las ventas anuladas.
--
-- Los abonos posteriores a la venta (por venta o generales) se anulan antes,
-- uno a uno y con su motivo, desde el detalle de la venta o el estado de
-- cuenta: cada uno puede haber entrado por otra vía o en otra caja, y repartir
-- esa reversión a ciegas aquí descuadraría algo. Si quedan vigentes, la
-- anulación se rechaza y dice qué hacer.
--
-- La devolución de una venta a crédito sale por donde entró el abono inicial,
-- o 'none' si se pide a propósito. No se acepta otro método: devolver por
-- transferencia un abono cobrado en efectivo dejaría la caja sobrando.

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

  -- NCF B04: solo si la venta original llevó comprobante. Una venta facturada
  -- por error igual consumió su NCF, así que la nota de crédito se emite
  -- aunque no haya devolución: es lo que la deja anulada ante la DGII.
  if v_sale.ncf is not null then
    select * into v_seq from ncf_sequences
     where company_id = v_sale.company_id
       and tipo = 'nota_credito'
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

  -- La devolución en efectivo sale de la caja: si el módulo está activo,
  -- exige caja abierta (mismo criterio que los pagos a suplidores). Sin
  -- devolución no hay salida de dinero, así que la caja no hace falta.
  if v_refund_method = 'cash' and caja_blocks_cash(v_sale.company_id, v_sale.branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de devolver efectivo.';
  end if;

  -- Reponer inventario de las líneas con producto. Los productos que no
  -- manejan existencias quedan fuera: nunca se les descontó nada al vender.
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

comment on function public.annul_sale(uuid, text, text) is
  'Anula una venta (pagada, a crédito o financiada): repone inventario, emite la nota de crédito B04 si llevó NCF, anula el abono inicial de las ventas a crédito y recalcula el balance del cliente. Exige anular antes los abonos posteriores. Solo administradores.';

revoke all on function public.annul_sale(uuid, text, text) from public;
grant execute on function public.annul_sale(uuid, text, text) to authenticated, service_role;
