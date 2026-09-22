-- ════════════════════════════════════════════════════════════════════════════
-- El abono que no se podía aplicar: el plan de financiamiento fantasma
-- ════════════════════════════════════════════════════════════════════════════
--
-- Síntoma: un cliente con RD$10,500 de deuda a crédito simple, y al registrarle
-- un abono de RD$4,200 la caja devolvía
--
--   «No se pudo aplicar RD$4,200.00 del abono a ninguna venta abierta.»
--
-- El techo del abono (que sale de las ventas) decía que sí había RD$10,500 que
-- cobrar, pero el motor no lograba colocar ni un peso. Reconstruida, la
-- secuencia fue esta:
--
--   1. La venta se crea a crédito simple (`payment_status = 'credit'`).
--   2. Se le registra un abono. Funciona: el motor lo aplica al saldo.
--   3. Se ANULA ese abono (se cobró en efectivo y era transferencia).
--   4. Desde ahí, ningún abono más se puede aplicar a esa venta.
--
-- La anulación era la que rompía la venta. `void_credit_payment` devuelve el
-- `amount_paid` y recalcula el estado con
--
--   when financing_details is not null then 'in_financing' else 'credit' end
--
-- y `financing_details` NO venía en NULL: venía con el jsonb `null` literal.
-- El POS manda `financing_details: null` en el JSON de la venta, y
-- `create_sale_with_items` lo extrae con `p_sale->'financing_details'`, que
-- para un `null` de JSON devuelve el valor jsonb `'null'`, no SQL NULL. Y en
-- SQL `'null'::jsonb is not null` es TRUE.
--
-- Resultado: una venta a crédito simple quedaba marcada `in_financing` sin plan
-- y sin cuotas. Y `apply_payment_to_sale`, al verla financiada, buscaba dónde
-- poner el dinero en `financing_installments`, no encontraba ninguna cuota, y
-- devolvía `consumed = 0`. El abono se quedaba en el aire y la RPC abortaba.
--
-- Eran 549 ventas con ese jsonb `null` cargado: 539 ya pagadas, 9 vivas a
-- crédito y 1 ya convertida. Cada una de las 9 era la misma avería esperando
-- que alguien le anulara un abono.
--
-- Se cierra por cuatro lados, para que no dependa de un solo parche:
--
--   1. El dato: `'null'::jsonb` se normaliza a SQL NULL y un trigger impide
--      que vuelva a entrar, venga de donde venga.
--   2. La estructura: un CHECK deja a `financing_details` sólo dos formas
--      válidas, un objeto o NULL.
--   3. La decisión: nadie más pregunta `is not null` para saber si una venta
--      está financiada; hay una función que lo dice.
--   4. El motor: un abono ya no se queda en el aire aunque las cuotas no
--      alcancen a representar la deuda. El dinero entra al capital.
--
-- ── 1. Qué es estar financiada ──────────────────────────────────────────────
-- Una sola definición, para que no haya dos maneras de contestarlo. Un plan es
-- un OBJETO con campos; cualquier otra cosa (NULL, el jsonb `null`, un número)
-- es ausencia de plan.

create or replace function public.sale_is_financed(p_details jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(jsonb_typeof(p_details) = 'object', false);
$function$;

comment on function public.sale_is_financed(jsonb) is
  'TRUE si el `financing_details` de una venta es un plan de verdad (un objeto). Existe porque `financing_details is not null` daba TRUE para el jsonb `null` que mandaba el POS y marcaba ventas a crédito como financiadas.';

grant execute on function public.sale_is_financed(jsonb) to authenticated, service_role;

-- ── 2. La puerta: normalizar al escribir ────────────────────────────────────
-- Se arregla aquí y no sólo en `create_sale_with_items` porque el jsonb `null`
-- puede entrar por cualquier ruta de escritura, y cada una tendría que
-- acordarse de limpiarlo. El nombre empieza con `00` a propósito: los triggers
-- BEFORE del mismo evento corren en orden alfabético, así que este normaliza
-- antes de que `before_sale_credit_checks` valide el plan. Así una venta que
-- llegue marcada `in_financing` sin plan de verdad se rechaza con el mensaje
-- que corresponde ('Falta el plan de financiamiento') en vez de colarse.

create or replace function public.before_sale_normalize_financing_details()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.financing_details is not null
     and jsonb_typeof(new.financing_details) <> 'object' then
    new.financing_details := null;
  end if;
  return new;
end;
$function$;

comment on function public.before_sale_normalize_financing_details() is
  'Deja `sales.financing_details` en SQL NULL cuando no es un plan (objeto). Cierra la puerta al jsonb `null` que el POS mandaba y que hacía pasar ventas a crédito por financiadas.';

revoke all on function public.before_sale_normalize_financing_details() from public, anon, authenticated;

drop trigger if exists trg_before_sale_00_financing_details on public.sales;
create trigger trg_before_sale_00_financing_details
  before insert or update on public.sales
  for each row execute function public.before_sale_normalize_financing_details();

-- ── 3. Limpiar lo que ya está guardado ──────────────────────────────────────
-- Primero el dato, después el estado: el paso siguiente pregunta por el plan ya
-- normalizado. Ninguno de estos UPDATE dispara validaciones de venta — los
-- triggers de crédito, caja y NCF son sólo BEFORE INSERT.

update public.sales
   set financing_details = null
 where financing_details is not null
   and jsonb_typeof(financing_details) <> 'object';

-- Las ventas que la anulación ya había convertido: sin plan y sin una sola
-- cuota, nunca fueron financiadas. Vuelven a crédito simple, o a pagada si su
-- abono ya las había cubierto. Y como les cambia el estado, se recalcula el
-- balance de esos clientes desde sus ventas, que es la única fuente que manda.
do $do$
declare
  v_cust uuid;
begin
  for v_cust in
    with corregidas as (
      update public.sales s
         set payment_status = case
               when s.amount_paid >= s.total - 0.01 then 'paid'::payment_status
               else 'credit'::payment_status
             end
       where s.payment_status = 'in_financing'
         and not public.sale_is_financed(s.financing_details)
         and not exists (select 1 from public.financing_installments fi
                          where fi.sale_id = s.id)
      returning s.customer_id
    )
    select distinct customer_id from corregidas where customer_id is not null
  loop
    perform public.recompute_customer_balance(v_cust);
  end loop;
end
$do$;

-- ── 4. Que la base no acepte otra forma ─────────────────────────────────────
-- Barato y definitivo. Los CHECK se evalúan después de los triggers BEFORE, así
-- que el normalizador de arriba lo satisface siempre: esto atrapa cualquier
-- escritura que llegara a saltárselo.

alter table public.sales
  drop constraint if exists sales_financing_details_es_objeto;
alter table public.sales
  add constraint sales_financing_details_es_objeto
  check (financing_details is null or jsonb_typeof(financing_details) = 'object');

-- ── 5. El motor de abonos, con red ──────────────────────────────────────────
-- Igual que antes (mora primero, luego capital FIFO por cuota), con un cambio:
-- si al terminar el recorrido de cuotas todavía queda deuda de la venta sin
-- cubrir, el resto entra al capital en vez de devolverse sin aplicar.
--
-- Sin esa red, el dinero sólo tenía dónde caer si existían cuotas abiertas que
-- sumaran la deuda completa. Cuando no era así — no hay plan, el plan no cubre
-- la deuda, las cuotas quedaron todas en 'paid' por redondeo — el motor
-- devolvía `consumed = 0`, el abono quedaba sin aplicar y la RPC lo rechazaba
-- entero. Un abono que cabe en la deuda ahora siempre encuentra dónde entrar.

create or replace function public.apply_payment_to_sale(
  p_sale_id uuid,
  p_amount  numeric
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sale      sales%rowtype;
  v_is_fin    boolean;
  v_pol       record;
  v_today     date;
  v_total_due numeric;
  v_remaining numeric := p_amount;
  v_late      numeric := 0;
  v_capital   numeric := 0;
  v_inst      record;
  v_apply     numeric;
  v_fee_due   numeric;
  v_insts     jsonb := '[]'::jsonb;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada.';
  end if;

  -- Financiada es la que TIENE plan, no la que tiene el campo ocupado: el
  -- estado puede haber quedado en 'in_financing' por una anulación vieja.
  v_is_fin := (v_sale.payment_status = 'in_financing')
              and sale_is_financed(v_sale.financing_details);

  if v_is_fin then
    v_total_due := coalesce((v_sale.financing_details->>'totalWithInterest')::numeric, v_sale.total)
                   - v_sale.amount_paid;
  else
    v_total_due := v_sale.total - v_sale.amount_paid;
  end if;
  v_total_due := greatest(round(v_total_due, 2), 0);

  if v_is_fin then
    select p.* into v_pol
      from companies c,
           lateral late_fee_policy(v_sale.financing_details, c.late_fee_rate, c.late_fee_grace_days) p
     where c.id = v_sale.company_id;
    v_today := company_today(v_sale.company_id);

    perform 1 from financing_installments where sale_id = p_sale_id for update;

    -- 1) La mora primero, de la cuota más vieja a la más nueva.
    for v_inst in
      select * from financing_installments
       where sale_id = p_sale_id
         and status <> 'paid'
         and due_date + v_pol.grace_days < v_today
       order by installment_number
    loop
      exit when v_remaining <= 0;
      v_fee_due := late_fee_due(v_inst.amount, v_inst.paid_amount, v_inst.late_fee_paid,
                                v_inst.due_date, v_today,
                                v_pol.rate, v_pol.fee_mode, v_pol.grace_days,
                                v_pol.max_rate, v_pol.period_days);
      if v_fee_due > 0 then
        v_apply := least(v_remaining, v_fee_due);
        update financing_installments
           set late_fee_paid = late_fee_paid + v_apply
         where id = v_inst.id;
        v_late      := v_late + v_apply;
        v_remaining := v_remaining - v_apply;
        v_insts := v_insts || jsonb_build_object(
          'id', v_inst.id, 'number', v_inst.installment_number,
          'principal', 0, 'late_fee', v_apply);
      end if;
    end loop;

    -- 2) Capital FIFO, sin pasarse de la deuda: lo que sobre se devuelve a
    --    quien llamó (el abono general lo lleva a la siguiente venta).
    v_remaining := least(v_remaining, v_total_due);
    for v_inst in
      select * from financing_installments
       where sale_id = p_sale_id and status <> 'paid'
       order by installment_number
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_remaining, v_inst.amount - v_inst.paid_amount);
      if v_apply > 0 then
        update financing_installments
           set paid_amount = paid_amount + v_apply,
               status  = case when paid_amount + v_apply >= amount - 0.005 then 'paid' else 'partial' end,
               paid_at = case when paid_amount + v_apply >= amount - 0.005 then now() else paid_at end
         where id = v_inst.id;
        v_remaining := v_remaining - v_apply;
        v_capital   := v_capital + v_apply;
        v_insts := v_insts || jsonb_build_object(
          'id', v_inst.id, 'number', v_inst.installment_number,
          'principal', v_apply, 'late_fee', 0);
      end if;
    end loop;

    -- 3) La red: queda deuda de la venta que ninguna cuota abierta representa.
    --    Pasa cuando el plan no cubre el total o cuando las cuotas cerraron por
    --    redondeo. El dinero va al capital de la venta: se cobra la deuda, que
    --    es lo que el cajero pidió, y la anulación lo sabe revertir porque
    --    queda anotado como principal sin cuotas.
    v_apply := least(v_remaining, round(v_total_due - v_capital, 2));
    if v_apply > 0.005 then
      v_capital   := v_capital + v_apply;
      v_remaining := v_remaining - v_apply;
    end if;
  else
    -- Crédito simple: no hay plan de cuotas ni mora, solo saldo.
    v_capital := least(v_remaining, v_total_due);
  end if;

  if v_capital > 0 then
    update sales
       set amount_paid = amount_paid + v_capital,
           payment_status = case
             when v_is_fin
                  and amount_paid + v_capital >=
                      coalesce((financing_details->>'totalWithInterest')::numeric, total) - 0.01
               then 'paid'::payment_status
             when not v_is_fin and amount_paid + v_capital >= total - 0.01
               then 'paid'::payment_status
             else payment_status
           end
     where id = p_sale_id;
  end if;

  return jsonb_build_object(
    'sale_id',      p_sale_id,
    'principal',    round(v_capital, 2),
    'late_fee',     round(v_late, 2),
    'consumed',     round(v_capital + v_late, 2),
    'installments', v_insts
  );
end;
$function$;

comment on function public.apply_payment_to_sale(uuid, numeric) is
  'Interno: aplica un monto a una venta (mora primero, luego capital FIFO) con la política congelada en su plan, y devuelve el detalle para poder revertirlo. Si las cuotas abiertas no alcanzan a representar la deuda, el resto entra al capital: un abono que cabe en la deuda nunca se queda sin aplicar. No valida permisos — eso lo hace la RPC que lo llama.';

revoke all on function public.apply_payment_to_sale(uuid, numeric) from public, anon, authenticated;

-- ── 6. La anulación ya no inventa financiamientos ───────────────────────────
-- Único cambio: para decidir el estado de la venta al devolverle el dinero
-- pregunta por el plan con `sale_is_financed`, no por el campo ocupado. Una
-- venta a crédito simple vuelve a 'credit', como salió.

create or replace function public.void_credit_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_p          credit_payments%rowtype;
  v_sale_ent   jsonb;
  v_inst_ent   jsonb;
  v_sale       sales%rowtype;
  v_principal  numeric;
  v_user_name  text;
  v_session    caja_sessions%rowtype;
  v_balance    numeric;
  v_cash_out   boolean := false;
begin
  select * into v_p from credit_payments where id = p_payment_id for update;
  if not found or (v_p.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Abono no encontrado.';
  end if;
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede anular un abono.';
  end if;
  if v_p.voided_at is not null then
    raise exception 'Este abono ya fue anulado.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la anulación.';
  end if;
  if v_p.kind = 'down_payment' then
    raise exception 'El abono inicial es parte de la venta: para revertirlo hay que anular la venta completa.';
  end if;
  if v_p.allocation is null then
    raise exception 'Este abono es anterior al registro de aplicación por cuota, así que no se puede revertir automáticamente. Corrígelo desde la base con respaldo.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  -- El efectivo tiene que salir de una caja abierta. Si el abono se cobró
  -- dentro de la sesión que sigue abierta, basta con excluirlo del cierre
  -- (`close_caja_session` ya ignora los anulados); si fue en una sesión
  -- anterior, esa ya cerró con el dinero contado y hay que sacarlo ahora.
  if v_p.method = 'cash'
     and is_module_enabled(v_p.company_id, 'caja', false)
     and v_p.branch_id is not null
     and branch_uses_caja(v_p.branch_id) then
    select * into v_session from caja_sessions
     where branch_id = v_p.branch_id and status = 'open' for update;
    if not found then
      raise exception 'Abre la caja de esta sucursal antes de anular un abono cobrado en efectivo.';
    end if;
    v_cash_out := (v_session.opened_at > v_p.date);
  end if;

  for v_sale_ent in select * from jsonb_array_elements(v_p.allocation->'sales')
  loop
    v_principal := coalesce((v_sale_ent->>'principal')::numeric, 0);

    select * into v_sale from sales where id = (v_sale_ent->>'sale_id')::uuid for update;
    if found then
      update sales
         set amount_paid = greatest(round(amount_paid - v_principal, 2), 0),
             payment_status = case
               when greatest(amount_paid - v_principal, 0) >=
                    case when sale_is_financed(financing_details)
                         then coalesce((financing_details->>'totalWithInterest')::numeric, total)
                         else total end - 0.01
                 then 'paid'::payment_status
               when sale_is_financed(financing_details) then 'in_financing'::payment_status
               else 'credit'::payment_status
             end
       where id = v_sale.id;
    end if;

    for v_inst_ent in select * from jsonb_array_elements(v_sale_ent->'installments')
    loop
      update financing_installments fi
         set paid_amount   = greatest(round(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 2), 0),
             late_fee_paid = greatest(round(fi.late_fee_paid - coalesce((v_inst_ent->>'late_fee')::numeric, 0), 2), 0),
             status = case
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) >= fi.amount - 0.005 then 'paid'
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) <= 0.005 then 'pending'
               else 'partial' end,
             paid_at = case
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) >= fi.amount - 0.005 then fi.paid_at
               else null end
       where fi.id = (v_inst_ent->>'id')::uuid;
    end loop;
  end loop;

  update credit_payments
     set voided_at = now(), voided_by = auth.uid(),
         voided_by_name = v_user_name, void_reason = btrim(p_reason)
   where id = p_payment_id;

  if v_cash_out then
    insert into caja_movements
      (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
    values
      (v_session.id, v_p.company_id, v_p.branch_id, 'out', v_p.amount,
       'Anulación de abono del ' || to_char(v_p.date, 'DD/MM/YYYY') || ': ' || btrim(p_reason),
       auth.uid(), v_user_name);
  end if;

  v_balance := recompute_customer_balance(v_p.customer_id);

  return jsonb_build_object(
    'payment_id',       v_p.id,
    'amount',           v_p.amount,
    'cash_returned',    v_cash_out,
    'customer_balance', v_balance
  );
end;
$function$;

comment on function public.void_credit_payment(uuid, text) is
  'Anula un abono a crédito: devuelve el capital a la venta y a sus cuotas, saca el efectivo de la caja si la sesión que lo recibió ya cerró, y recalcula el balance del cliente. El estado de la venta se decide con `sale_is_financed`: una venta a crédito simple vuelve a crédito, no a financiada.';
