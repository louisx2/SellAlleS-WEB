-- Facturación electrónica (e-CF) con MSeller: "Anular venta" emite una nota de
-- crédito electrónica (E34), un comprobante rechazado por la DGII se puede
-- reemitir con un número nuevo y un envío con error se puede reintentar.
-- Diseño: docs/2026-10-28-ecf-mseller-diseno.md (repo raíz), secciones 6 y 9.
--
-- annul_sale() se modificó partiendo de su definición viva (pg_get_functiondef
-- del 2026-11-02), no de ninguna copia del repo. Lo que hacía y se conserva
-- tal cual: la validación de empresa y de administrador, el manejo de ventas a
-- crédito y financiadas, la reposición de inventario, la caja, la nota de
-- crédito y el JSON de respuesta (que ya trae credit_note_id). Cambia solo
-- el bloque que obtiene el NCF de la nota de crédito:
--   * venta con e-NCF y e-CF activo: depende del documento vigente de la venta
--     (el que no ha sido reemplazado) y la E34 sale de assign_ncf(), que ya
--     usa la secuencia electrónica con 10 dígitos;
--   * venta con e-NCF y e-CF no activo (suspendido): se rechaza con un mensaje;
--     no se emite ni E34 ni B04 hasta que la empresa reactive la facturación
--     electrónica;
--   * cualquier otra venta con NCF (serie B): la B04 de siempre, sin corte de
--     fecha. La única diferencia es que ahora excluye las secuencias
--     electrónicas (`not electronica`): antes no existían, y sin el filtro una
--     E34 cargada antes que la B04 se usaría con 8 dígitos para una venta B.
--
-- Mientras ninguna empresa tenga `ecf_activa`, annul_sale se comporta como hoy.

-- ---------------------------------------------------------------------------
-- 1. annul_sale: E34 con e-CF activo
-- ---------------------------------------------------------------------------
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
      -- original (el vigente: el que no ha sido reemplazado por otro).
      select d.estado into v_doc_estado
        from ecf_documentos d
       where d.sale_id = v_sale.id and d.reemplazado_por is null
       order by d.created_at desc
       limit 1;

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

-- ---------------------------------------------------------------------------
-- 2. Bandeja de salida: cada nota de crédito con E34 crea su documento
-- ---------------------------------------------------------------------------
-- AFTER INSERT, en la misma transacción que la anulación: si el documento no se
-- puede crear, la anulación tampoco se guarda. Security definer porque
-- `authenticated` solo lee ecf_documentos. Una nota sin e-NCF (de la serie B,
-- o la de una venta rechazada por la DGII) no crea nada.
create or replace function public.ecf_encolar_nota_credito()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ncf ~ '^E34\d{10}$' then
    insert into public.ecf_documentos (company_id, branch_id, credit_note_id, tipo_ecf, encf, ambiente, estado)
    select new.company_id, new.branch_id, new.id, 34, new.ncf, c.ambiente, 'por_enviar'
      from public.ecf_config c
     where c.company_id = new.company_id;
  end if;
  return new;
end $$;

comment on function public.ecf_encolar_nota_credito() is
  'Trigger AFTER INSERT de credit_notes: cuando la nota lleva e-NCF E34 crea su fila en ecf_documentos (por_enviar) para que el worker la envíe a MSeller.';

revoke all on function public.ecf_encolar_nota_credito() from public, anon, authenticated;

drop trigger if exists trg_ecf_encolar_nota_credito on public.credit_notes;
create trigger trg_ecf_encolar_nota_credito
  after insert on public.credit_notes
  for each row execute function public.ecf_encolar_nota_credito();

-- ---------------------------------------------------------------------------
-- 3. reemitir_ecf: un número nuevo para un comprobante rechazado
-- ---------------------------------------------------------------------------
-- Mismo criterio de permisos que annul_sale: la venta tiene que ser de la
-- empresa del usuario (o ser super admin) y el usuario, administrador. Toma el
-- documento vigente de la venta (el que no ha sido reemplazado); solo si está
-- rechazado asigna un e-NCF nuevo del mismo tipo, lo pone en la venta, crea el
-- documento nuevo y enlaza el viejo con `reemplazado_por`. Todo o nada: si no
-- hay secuencia disponible no cambia nada. Una venta anulada no se reemite.
create or replace function public.reemitir_ecf(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale  sales%rowtype;
  v_doc   ecf_documentos%rowtype;
  v_encf  text;
  v_nuevo uuid;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;

  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede reemitir comprobantes.';
  end if;

  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta ya fue anulada.';
  end if;

  select * into v_doc
    from ecf_documentos
   where sale_id = v_sale.id and reemplazado_por is null
   order by created_at desc
   limit 1
   for update;
  if not found or v_doc.estado <> 'rechazado' then
    raise exception 'Solo se puede reemitir un comprobante rechazado por la DGII.';
  end if;

  -- Sin e-CF activo assign_ncf devolvería una B: no es lo que se reemite.
  if not ecf_activa(v_sale.company_id) then
    raise exception 'La facturación electrónica no está activa para esta empresa.';
  end if;

  v_encf := assign_ncf(v_sale.company_id, v_sale.ncf_type::text);

  insert into ecf_documentos (company_id, branch_id, sale_id, tipo_ecf, encf, ambiente, estado)
  select v_sale.company_id, v_sale.branch_id, v_sale.id, substr(v_encf, 2, 2)::smallint, v_encf, c.ambiente, 'por_enviar'
    from ecf_config c
   where c.company_id = v_sale.company_id
  returning id into v_nuevo;

  update ecf_documentos set reemplazado_por = v_nuevo, updated_at = now() where id = v_doc.id;
  update sales set ncf = v_encf where id = v_sale.id;

  return jsonb_build_object('documento_id', v_nuevo, 'encf', v_encf);
end;
$$;

comment on function public.reemitir_ecf(uuid) is
  'Reemite con un e-NCF nuevo el comprobante rechazado por la DGII de una venta: actualiza sales.ncf, crea el documento nuevo (por_enviar) y marca el viejo como reemplazado. Solo administradores de la empresa.';

revoke all on function public.reemitir_ecf(uuid) from public;
revoke execute on function public.reemitir_ecf(uuid) from anon;
grant execute on function public.reemitir_ecf(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ecf_reintentar: volver a poner en cola un envío con error o sin cupo
-- ---------------------------------------------------------------------------
-- error_datos no se reintenta solo (hay que corregir algo primero) y sin_cupo
-- espera a que el plan lo permita: este es el botón del administrador.
create or replace function public.ecf_reintentar(p_documento uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc ecf_documentos%rowtype;
begin
  select * into v_doc from ecf_documentos where id = p_documento for update;
  if not found or (v_doc.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Comprobante no encontrado.';
  end if;

  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede reintentar comprobantes.';
  end if;

  if v_doc.estado not in ('error_datos', 'sin_cupo') then
    raise exception 'Solo se puede reintentar un comprobante con error o sin cupo.';
  end if;

  update ecf_documentos
     set estado = 'por_enviar', proximo_intento_at = now(), updated_at = now()
   where id = v_doc.id;
end;
$$;

comment on function public.ecf_reintentar(uuid) is
  'Deja un comprobante en error_datos o sin_cupo otra vez en por_enviar, listo para el worker. Solo administradores de la empresa.';

revoke all on function public.ecf_reintentar(uuid) from public;
revoke execute on function public.ecf_reintentar(uuid) from anon;
grant execute on function public.ecf_reintentar(uuid) to authenticated;
