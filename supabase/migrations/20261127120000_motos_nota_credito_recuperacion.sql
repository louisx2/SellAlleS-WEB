-- Motopréstamos 4B: nota de crédito por lo no cobrado de una venta recuperada.
-- Diseño: docs/superpowers/specs/2026-11-26-motoprestamos-4b-nota-credito-design.md
-- Plan:   docs/superpowers/plans/2026-11-26-motoprestamos-entrega-4b-nota-credito.md (Task 1)
--
-- No cambia ninguna función viva: annul_sale sigue igual y sus notas quedan con
-- kind = 'anulacion'. El bloque que asigna el número de la nota (B04 o E34) es
-- copia del de annul_sale (20261124160000_motos_venta_por_chasis.sql). La E34 la
-- encola trg_ecf_encolar_nota_credito, como en la anulación.
-- Pruebas: supabase/tests/motos_nota_credito.sql

-- 1. Tipo de nota y sus líneas ---------------------------------------------------------------
-- La nota de una recuperación guarda sus líneas ya prorrateadas: ecf-emitir arma el
-- E34 con ellas (código 3, «corrige montos») en vez de con las de la venta.

alter table public.credit_notes
  add column kind text not null default 'anulacion' check (kind in ('anulacion', 'recuperacion')),
  add column items jsonb,
  add constraint credit_notes_items_solo_recuperacion check (items is null or kind = 'recuperacion');

-- 2. Emitir la nota de crédito de una venta recuperada -----------------------------------------
-- Monto: lo que no se cobró del valor facturado. factor = (dado de baja + devuelto al
-- cliente) / total a pagar (con intereses si es financiada), topado en 1. Cada línea de
-- la venta va por su parte (cantidad 1, precio en centavos) y la última absorbe el
-- redondeo. Los totales salen de las líneas con la misma regla que armar.ts: ITBIS
-- sobre el gravado, hacia adentro si la venta trae el ITBIS incluido.

create or replace function public.motos_nota_credito_recuperacion(p_sale_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale          public.sales%rowtype;
  v_rec           public.vehicle_recoveries%rowtype;
  v_doc_estado    text;
  v_seq           public.ncf_sequences%rowtype;
  v_ncf           text;
  v_total_a_pagar numeric;
  v_factor        numeric;
  v_linea         record;
  v_n             int;
  v_i             int := 0;
  v_bruto_total   numeric;
  v_objetivo      numeric;
  v_acumulado     numeric := 0;
  v_monto         numeric;
  v_items         jsonb := '[]'::jsonb;
  v_suma          numeric := 0;
  v_gravado       numeric := 0;
  v_itbis         numeric;
  v_total         numeric;
  v_incluido      boolean;
  v_id            uuid;
  v_user_name     text;
begin
  if not (public.is_company_admin() or public.is_super_admin()) then
    raise exception 'Solo un administrador puede emitir la nota de crédito de una venta recuperada.';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;
  if v_sale.recovered_at is null then
    raise exception 'Esta venta no está recuperada.';
  end if;
  if v_sale.ncf is null then
    raise exception 'Esta venta no lleva comprobante fiscal: no hace falta nota de crédito.';
  end if;
  if exists (select 1 from public.credit_notes where sale_id = v_sale.id) then
    raise exception 'Esta venta ya tiene una nota de crédito.';
  end if;
  select * into v_rec from public.vehicle_recoveries
   where sale_id = v_sale.id and kind = 'venta' and status = 'recuperada'
   order by created_at desc limit 1;
  if not found then
    raise exception 'Esta venta no está recuperada.';
  end if;

  -- Monto y líneas.
  v_total_a_pagar := coalesce((v_sale.financing_details->>'totalWithInterest')::numeric, v_sale.total);
  if coalesce(v_total_a_pagar, 0) <= 0 then
    raise exception 'Esta venta no tiene saldo no cobrado que acreditar.';
  end if;
  v_factor := least(1, (coalesce(v_rec.written_off, 0) + coalesce(v_rec.refunded, 0)) / v_total_a_pagar);
  if v_factor <= 0 then
    raise exception 'Esta venta no tiene saldo no cobrado que acreditar.';
  end if;

  select count(*), coalesce(sum(i.quantity * coalesce(i.custom_price, i.price)), 0)
    into v_n, v_bruto_total
    from public.sale_items i where i.sale_id = v_sale.id;
  v_objetivo := round(v_bruto_total * v_factor, 2);

  for v_linea in
    select i.product_name,
           i.quantity * coalesce(i.custom_price, i.price) as bruto,
           coalesce(i.itbis, false) as itbis,
           coalesce(p.es_servicio, false) as servicio
      from public.sale_items i
      left join public.products p on p.id = i.product_id
     where i.sale_id = v_sale.id
     order by i.id
  loop
    v_i := v_i + 1;
    v_monto := case when v_i < v_n then round(v_linea.bruto * v_factor, 2) else round(v_objetivo - v_acumulado, 2) end;
    v_acumulado := v_acumulado + v_monto;
    if v_monto > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'nombre', v_linea.product_name, 'cantidad', 1, 'precio', v_monto,
        'itbis', v_linea.itbis, 'servicio', v_linea.servicio));
      v_suma := v_suma + v_monto;
      if v_linea.itbis then
        v_gravado := v_gravado + v_monto;
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'Esta venta no tiene saldo no cobrado que acreditar.';
  end if;

  v_incluido := coalesce(v_sale.itbis_included, false);
  v_itbis := case when v_incluido then round(v_gravado * 0.18 / 1.18, 2) else round(v_gravado * 0.18, 2) end;
  v_total := case when v_incluido then round(v_suma, 2) else round(v_suma + v_itbis, 2) end;

  -- Número de la nota: el mismo camino que annul_sale.
  if v_sale.ncf ~ '^E\d{12}$' then
    if not public.ecf_activa(v_sale.company_id) then
      raise exception 'La facturación electrónica de esta empresa no está activa; no se puede emitir la nota de crédito hasta reactivarla.';
    end if;
    select d.estado into v_doc_estado
      from public.ecf_documentos d
     where d.sale_id = v_sale.id and d.reemplazado_por is null
     order by d.created_at desc
     limit 1
     for share;
    if v_doc_estado in ('por_enviar', 'enviando', 'error_datos', 'sin_cupo') then
      raise exception 'Esta venta tiene su e-CF todavía sin enviar a la DGII. Espera a que salga o reintenta el envío antes de emitir la nota de crédito.';
    end if;
    if v_doc_estado = 'rechazado' then
      raise exception 'El e-CF de esta venta fue rechazado por la DGII: no hay comprobante que corregir.';
    end if;
    v_ncf := public.assign_ncf(v_sale.company_id, 'nota_credito');
  else
    select * into v_seq from public.ncf_sequences
     where company_id = v_sale.company_id
       and tipo = 'nota_credito'
       and not electronica
       and active
       and (expires_at is null or expires_at >= public.company_today(v_sale.company_id))
       and current_val <= range_to
     order by created_at
     limit 1
     for update;
    if not found then
      raise exception 'No hay una secuencia de Notas de Crédito (B04) activa con números disponibles. Agrégala en Perfil de Sucursal → Facturación Fiscal.';
    end if;
    v_ncf := v_seq.prefix || lpad(v_seq.current_val::text, 8, '0');
    update public.ncf_sequences set current_val = current_val + 1 where id = v_seq.id;
  end if;

  select name into v_user_name from public.profiles where id = auth.uid();
  begin
    insert into public.credit_notes
      (company_id, branch_id, sale_id, customer_id, ncf, ncf_modified,
       subtotal, itbis_amount, total, refund_method, reason, user_id, user_name, kind, items)
    values
      (v_sale.company_id, v_sale.branch_id, v_sale.id, v_sale.customer_id, v_ncf, v_sale.ncf,
       round(v_total - v_itbis, 2), v_itbis, v_total, null,
       coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Recuperación del vehículo'),
       auth.uid(), v_user_name, 'recuperacion', v_items)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esta venta ya tiene una nota de crédito.';
  end;

  return jsonb_build_object('credit_note_id', v_id, 'ncf', v_ncf, 'total', v_total, 'itbis_amount', v_itbis);
end;
$$;

-- 3. Grants ------------------------------------------------------------------------------------

revoke execute on function public.motos_nota_credito_recuperacion(uuid, text) from public, anon;
grant execute on function public.motos_nota_credito_recuperacion(uuid, text) to authenticated, service_role;
