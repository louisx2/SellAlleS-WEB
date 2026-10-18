-- Anular sin devolver dinero.
--
-- La anulación obligaba a elegir efectivo, tarjeta o transferencia, aunque la
-- venta se hubiera facturado por error y el cliente nunca pagara (un doble clic
-- en cobrar deja dos ventas idénticas). Quedaba registrada una devolución que
-- nunca ocurrió, y con el módulo de caja activo salía plata real de la caja.
--
-- 'none' anula igual — repone inventario, emite la nota de crédito y marca
-- cancelled_at — pero no mueve dinero ni exige caja abierta.

comment on column public.credit_notes.refund_method is
  'cash | card | transfer | none (none = se facturó por error, no hubo dinero que devolver)';

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
  -- Sin método explícito se asume que el dinero vuelve por donde entró; 'none'
  -- hay que pedirlo a propósito, para que no se anule sin devolver por descuido.
  v_refund_method := coalesce(p_refund_method, v_sale.payment_method::text);
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
  -- exige caja abierta (mismo criterio que los pagos a suplidores). Sin
  -- devolución no hay salida de dinero, así que la caja no hace falta.
  if v_refund_method = 'cash'
     and is_module_enabled(v_sale.company_id, 'caja', false)
     and (v_sale.branch_id is null or not has_open_caja(v_sale.branch_id)) then
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

revoke all on function public.annul_sale(uuid, text, text) from public;
-- Los default privileges de Supabase dan EXECUTE a anon en funciones nuevas.
revoke execute on function public.annul_sale(uuid, text, text) from anon;
grant execute on function public.annul_sale(uuid, text, text) to authenticated;
