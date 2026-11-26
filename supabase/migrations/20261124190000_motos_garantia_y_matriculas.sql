-- Motopréstamos 2B: préstamo con la moto en garantía y matrículas en custodia.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 2)
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-2b-garantia-matriculas.md (Task 2)
--
-- Cambia tres funciones vivas, partiendo de pg_get_functiondef:
--   vehicles_before     db33a5f099fe6c40f9ec2d39fdf30f95
--   vehicles_after      e97ae77132d6f01defb00c63abe73860
--   motos_anular_venta  9e02e4f81fb39ba605fe30116ff3cbc2
-- No toca abonos ni refinanciación (register_loan_payment, void_loan_payment,
-- refinance_loan, register_sale_payment, void_credit_payment): lo que pasa con la
-- moto al saldar, al anular un abono o al refinanciar lo hacen triggers sobre
-- `loans` y `sales` que salen enseguida si no hay vehículos enlazados.
--
-- Enlace préstamo ↔ moto: `vehicles.loan_id` (como `sale_id`); el historial de
-- préstamos de cada moto queda en `vehicle_events.loan_id`.
-- Pruebas: supabase/tests/motos_garantia.sql

-- 1. Columnas ------------------------------------------------------------------------

alter table public.vehicles
  add column loan_id                        uuid references public.loans(id) on delete set null,
  add column registration_delivered_to      text,
  add column registration_delivered_doc     text,
  add column registration_delivered_at      timestamptz,
  add column registration_delivered_by_name text;
create index vehicles_loan_idx on public.vehicles(loan_id) where loan_id is not null;

alter table public.vehicle_events
  add column loan_id uuid references public.loans(id) on delete set null;

alter table public.vehicle_events drop constraint vehicle_events_kind_check;
alter table public.vehicle_events add constraint vehicle_events_kind_check check (kind in (
  'ingreso', 'venta', 'venta_anulada', 'cambio_estado', 'matricula', 'edicion', 'baja', 'garantia', 'liberacion'));

-- 2. Triggers de vehículos (desde lo vivo) -------------------------------------------

create or replace function public.vehicles_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sistema boolean := coalesce(current_setting('motos.sistema', true), '') = 'si';
begin
  new.chassis := nullif(btrim(new.chassis), '');
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.branches where id = new.branch_id and company_id = new.company_id) then
      raise exception 'Sucursal no válida.';
    end if;
    if not v_sistema then
      new.status := case new.origin when 'garantia' then 'en_garantia' else 'disponible' end;
      new.sale_id := null;
      new.loan_id := null;
      new.registration_delivered_to := null;
      new.registration_delivered_doc := null;
      new.registration_delivered_at := null;
      new.registration_delivered_by_name := null;
      if new.origin = 'inventario' then
        new.customer_id := null;
        new.registration_status := 'no_aplica';
      end if;
    end if;
    if new.origin = 'inventario' and not exists (
      select 1 from public.products p
       where p.id = new.product_id and p.is_vehicle
         and p.branch_id = new.branch_id and p.company_id = new.company_id
    ) then
      raise exception 'La unidad tiene que ser de un artículo-vehículo de la misma sucursal.';
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_by_name := coalesce(new.created_by_name, (select name from public.profiles where id = auth.uid()));
    return new;
  end if;

  -- UPDATE: lo que cambia el estado, la venta, el préstamo, la matrícula o a quién
  -- pertenece lo hace el sistema (venta, préstamo, entrega, recuperación). El
  -- usuario solo da de baja una unidad disponible y edita datos descriptivos y
  -- dónde se guarda la matrícula.
  if not v_sistema then
    if new.status is distinct from old.status
       and not (old.status = 'disponible' and new.status = 'baja') then
      raise exception 'Ese cambio de estado lo hace el sistema (venta, préstamo o recuperación).';
    end if;
    -- La venta o el préstamo solo quedan en null solos cuando se borraron (la FK,
    -- al borrar una empresa o una sucursal).
    if (new.sale_id is distinct from old.sale_id
        and not (new.sale_id is null and not exists (select 1 from public.sales where id = old.sale_id)))
       or (new.loan_id is distinct from old.loan_id
           and not (new.loan_id is null and not exists (select 1 from public.loans where id = old.loan_id)))
       or new.product_id is distinct from old.product_id
       or new.branch_id is distinct from old.branch_id
       or new.company_id is distinct from old.company_id
       or new.origin is distinct from old.origin
       or new.registration_status is distinct from old.registration_status
       or new.registration_delivered_to is distinct from old.registration_delivered_to
       or new.registration_delivered_doc is distinct from old.registration_delivered_doc
       or new.registration_delivered_at is distinct from old.registration_delivered_at
       or new.registration_delivered_by_name is distinct from old.registration_delivered_by_name
       or (old.origin = 'inventario' and new.customer_id is distinct from old.customer_id) then
      raise exception 'Ese cambio lo hace el sistema (venta, préstamo o recuperación).';
    end if;
  end if;
  return new;
end;
$$;

-- `motos.evento` dice qué evento es un cambio de estado y `motos.nota` agrega una
-- nota al evento de estado o de matrícula. Los eventos guardan el préstamo.
create or replace function public.vehicles_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario text := (select name from public.profiles where id = auth.uid());
  v_campos  text[] := '{}';
  v_nota    text := nullif(current_setting('motos.nota', true), '');
begin
  if tg_op = 'INSERT' then
    perform public.motos_recalcular_stock(new.product_id);
    insert into public.vehicle_events (company_id, vehicle_id, kind, to_status, loan_id, created_by_name)
    values (new.company_id, new.id, 'ingreso', new.status, new.loan_id, v_usuario);
    -- Una moto que entra ya como garantía de un préstamo (motos_crear_prestamo).
    if new.loan_id is not null then
      insert into public.vehicle_events (company_id, vehicle_id, kind, to_status, note, loan_id, created_by_name)
      values (new.company_id, new.id, 'garantia', new.status, v_nota, new.loan_id, v_usuario);
    end if;
    return new;
  end if;

  if new.product_id is distinct from old.product_id then
    perform public.motos_recalcular_stock(old.product_id);
  end if;
  if new.status is distinct from old.status or new.product_id is distinct from old.product_id then
    perform public.motos_recalcular_stock(new.product_id);
  end if;

  if new.status is distinct from old.status then
    -- Los ganchos de venta, préstamo y anulación dicen qué evento es (motos.evento).
    insert into public.vehicle_events (company_id, vehicle_id, kind, from_status, to_status, note, sale_id, loan_id, created_by_name)
    values (new.company_id, new.id,
            coalesce(nullif(current_setting('motos.evento', true), ''),
                     case when new.status = 'baja' then 'baja' else 'cambio_estado' end),
            old.status, new.status,
            coalesce(v_nota, case when new.status = 'baja' then new.notes end),
            coalesce(new.sale_id, old.sale_id), coalesce(new.loan_id, old.loan_id), v_usuario);
  end if;

  if new.registration_status is distinct from old.registration_status then
    insert into public.vehicle_events (company_id, vehicle_id, kind, from_status, to_status, note, sale_id, loan_id, created_by_name)
    values (new.company_id, new.id, 'matricula', old.registration_status, new.registration_status, v_nota,
            coalesce(new.sale_id, old.sale_id), coalesce(new.loan_id, old.loan_id), v_usuario);
  end if;

  if new.status is not distinct from old.status then
    if new.brand is distinct from old.brand then v_campos := array_append(v_campos, 'marca'); end if;
    if new.model is distinct from old.model then v_campos := array_append(v_campos, 'modelo'); end if;
    if new.year is distinct from old.year then v_campos := array_append(v_campos, 'año'); end if;
    if new.color is distinct from old.color then v_campos := array_append(v_campos, 'color'); end if;
    if new.chassis is distinct from old.chassis then v_campos := array_append(v_campos, 'chasis'); end if;
    if new.engine_number is distinct from old.engine_number then v_campos := array_append(v_campos, 'motor'); end if;
    if new.plate is distinct from old.plate then v_campos := array_append(v_campos, 'placa'); end if;
    if new.registration_number is distinct from old.registration_number then v_campos := array_append(v_campos, 'matrícula'); end if;
    if new.registration_location is distinct from old.registration_location then v_campos := array_append(v_campos, 'ubicación de la matrícula'); end if;
    if new.cc is distinct from old.cc then v_campos := array_append(v_campos, 'cilindraje'); end if;
    if new.vehicle_type_id is distinct from old.vehicle_type_id then v_campos := array_append(v_campos, 'tipo'); end if;
    if new.extra is distinct from old.extra then v_campos := array_append(v_campos, 'datos extra'); end if;
    if new.condition is distinct from old.condition then v_campos := array_append(v_campos, 'condición'); end if;
    if new.cost is distinct from old.cost then v_campos := array_append(v_campos, 'costo'); end if;
    if new.price is distinct from old.price then v_campos := array_append(v_campos, 'precio'); end if;
    if new.notes is distinct from old.notes then v_campos := array_append(v_campos, 'notas'); end if;
    if array_length(v_campos, 1) > 0 then
      insert into public.vehicle_events (company_id, vehicle_id, kind, note, loan_id, created_by_name)
      values (new.company_id, new.id, 'edicion', 'Cambió: ' || array_to_string(v_campos, ', '), new.loan_id, v_usuario);
    end if;
  end if;

  return new;
end;
$$;

-- 3. Préstamo con la moto en garantía ------------------------------------------------
-- Crea el préstamo (con los mismos campos que el insert del front, así los
-- triggers de cuotas y desembolso hacen lo de siempre) y su garantía en una sola
-- transacción: si la moto falla, no queda préstamo ni dinero desembolsado.
--
-- p_prestamo: branch_id, customer_id, principal, interest_rate, installments_count,
--             payment_frequency, notes, user_name, disbursement_method, disbursement_reference.
-- p_garantia: vehicle_id (una moto ya registrada del cliente) o vehiculo (los
--             campos de la ficha, con chasis); matricula_en_custodia; ubicacion.

create or replace function public.motos_crear_prestamo(p_prestamo jsonb, p_garantia jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := public.current_company_id();
  v_branch   uuid := nullif(p_prestamo->>'branch_id', '')::uuid;
  v_customer uuid := nullif(p_prestamo->>'customer_id', '')::uuid;
  v_veh      jsonb := p_garantia->'vehiculo';
  v_veh_id   uuid := nullif(p_garantia->>'vehicle_id', '')::uuid;
  v_custodia boolean := coalesce((p_garantia->>'matricula_en_custodia')::boolean, false);
  v_ubicacion text := nullif(btrim(coalesce(p_garantia->>'ubicacion', '')), '');
  v_usuario  text := (select name from public.profiles where id = auth.uid());
  v_loan     uuid;
  v_actual   public.vehicles%rowtype;
  v_tipo     uuid;
begin
  if v_company is null then
    raise exception 'No hay una empresa activa.';
  end if;
  if not exists (select 1 from public.company_modules
                  where company_id = v_company and module_key = 'motoprestamos' and enabled) then
    raise exception 'El módulo Motopréstamos está apagado.';
  end if;
  -- El mismo acceso que exige la política de `loans` para crear un préstamo.
  if not (public.is_super_admin() or public.is_company_admin()
          or v_branch in (select public.user_branch_ids())
          or public.branch_shares_with_me('prestamos', v_branch)) then
    raise exception 'No tienes acceso a esta sucursal.';
  end if;
  if p_garantia is null or (v_veh is null and v_veh_id is null) then
    raise exception 'Falta la moto de la garantía.';
  end if;
  if v_veh_id is null and nullif(btrim(coalesce(v_veh->>'chassis', '')), '') is null then
    raise exception 'Falta el chasis de la moto.';
  end if;

  -- La moto ya registrada se valida antes de crear el préstamo.
  if v_veh_id is not null then
    select * into v_actual from public.vehicles where id = v_veh_id for update;
    if not found or v_actual.company_id <> v_company or v_actual.customer_id is distinct from v_customer
       or not (v_actual.status = 'liberado'
               or (v_actual.status = 'vendido'
                   and (v_actual.sale_id is null
                        or exists (select 1 from public.sales s
                                    where s.id = v_actual.sale_id and s.payment_status::text = 'paid'
                                      and s.cancelled_at is null)))) then
      raise exception 'Esa moto no se puede usar como garantía: tiene que ser del cliente y estar liberada o con su venta saldada.';
    end if;
    if v_actual.branch_id <> v_branch then
      raise exception 'Esa moto es de otra sucursal: el préstamo tiene que ser de la misma.';
    end if;
  end if;

  insert into public.loans
    (company_id, branch_id, customer_id, principal, interest_rate, installments_count,
     payment_frequency, notes, created_by, user_name, disbursement_method, disbursement_reference)
  values
    (v_company, v_branch, v_customer,
     (p_prestamo->>'principal')::numeric,
     coalesce((p_prestamo->>'interest_rate')::numeric, 0),
     (p_prestamo->>'installments_count')::integer,
     coalesce(nullif(p_prestamo->>'payment_frequency', ''), 'monthly'),
     nullif(btrim(coalesce(p_prestamo->>'notes', '')), ''),
     auth.uid(),
     coalesce(nullif(p_prestamo->>'user_name', ''), v_usuario),
     nullif(p_prestamo->>'disbursement_method', ''),
     nullif(btrim(coalesce(p_prestamo->>'disbursement_reference', '')), ''))
  returning id into v_loan;

  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.evento', 'garantia', true);

  if v_veh_id is not null then
    update public.vehicles
       set status = 'en_garantia', loan_id = v_loan,
           registration_status = case when v_custodia then 'en_custodia' else 'no_aplica' end,
           registration_location = coalesce(v_ubicacion, registration_location),
           registration_since = case when v_custodia then now() end,
           registration_delivered_to = null, registration_delivered_doc = null,
           registration_delivered_at = null, registration_delivered_by_name = null
     where id = v_veh_id;
  else
    v_tipo := (select id from public.vehicle_types
                where id = nullif(v_veh->>'vehicle_type_id', '')::uuid and company_id = v_company);
    begin
      insert into public.vehicles
        (company_id, branch_id, vehicle_type_id, origin, customer_id, loan_id, status,
         brand, model, year, color, chassis, engine_number, plate, registration_number, cc,
         extra, condition, notes, registration_status, registration_location, registration_since)
      values
        (v_company, v_branch, v_tipo, 'garantia', v_customer, v_loan, 'en_garantia',
         nullif(btrim(coalesce(v_veh->>'brand', '')), ''),
         nullif(btrim(coalesce(v_veh->>'model', '')), ''),
         nullif(v_veh->>'year', '')::integer,
         nullif(btrim(coalesce(v_veh->>'color', '')), ''),
         v_veh->>'chassis',
         nullif(btrim(coalesce(v_veh->>'engine_number', '')), ''),
         nullif(btrim(coalesce(v_veh->>'plate', '')), ''),
         nullif(btrim(coalesce(v_veh->>'registration_number', '')), ''),
         nullif(btrim(coalesce(v_veh->>'cc', '')), ''),
         coalesce(v_veh->'extra', '{}'::jsonb),
         coalesce(nullif(v_veh->>'condition', ''), 'usado'),
         nullif(btrim(coalesce(v_veh->>'notes', '')), ''),
         case when v_custodia then 'en_custodia' else 'no_aplica' end,
         v_ubicacion,
         case when v_custodia then now() end);
    exception when unique_violation then
      raise exception 'Ya hay otro vehículo con ese chasis.';
    end;
  end if;

  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
  return v_loan;
end;
$$;

-- 4. Saldar, anular el abono que saldó y refinanciar ---------------------------------

-- Préstamo saldado (o cancelado): la moto se libera y la matrícula queda lista.
-- Si se anula el abono que lo saldó, vuelve a garantía y a custodia (salvo una
-- matrícula ya entregada, que sigue entregada).
create or replace function public.motos_prestamo_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.vehicles where loan_id = new.id) then
    return null;
  end if;

  perform set_config('motos.sistema', 'si', true);
  if new.status in ('paid', 'cancelled') and old.status = 'active' then
    perform set_config('motos.evento', 'liberacion', true);
    update public.vehicles
       set status = 'liberado',
           registration_status = case when registration_status = 'en_custodia' then 'lista_para_entregar' else registration_status end,
           registration_since = case when registration_status = 'en_custodia' then now() else registration_since end
     where loan_id = new.id and status = 'en_garantia';
  elsif old.status = 'paid' and new.status = 'active' then
    perform set_config('motos.evento', 'garantia', true);
    perform set_config('motos.nota', 'Se anuló un abono', true);
    update public.vehicles
       set status = 'en_garantia',
           registration_status = case when registration_status = 'lista_para_entregar' then 'en_custodia' else registration_status end,
           registration_since = case when registration_status = 'lista_para_entregar' then now() else registration_since end
     where loan_id = new.id and status = 'liberado';
  end if;
  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
  perform set_config('motos.nota', '', true);
  return null;
end;
$$;

create trigger trg_motos_prestamo_estado after update of status on public.loans
  for each row when (old.status is distinct from new.status)
  execute function public.motos_prestamo_estado();

-- Refinanciación: las motos en garantía del préstamo viejo pasan al nuevo. El
-- estado no cambia, así que el evento se escribe aquí.
create or replace function public.motos_prestamo_refinanciado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario text := (select name from public.profiles where id = auth.uid());
begin
  perform set_config('motos.sistema', 'si', true);
  with movidas as (
    update public.vehicles set loan_id = new.id
     where loan_id = new.refinanced_from_id and status = 'en_garantia'
    returning id, company_id, status
  )
  insert into public.vehicle_events (company_id, vehicle_id, kind, from_status, to_status, note, loan_id, created_by_name)
  select m.company_id, m.id, 'garantia', m.status, m.status, 'Refinanciación', new.id, v_usuario from movidas m;
  perform set_config('motos.sistema', '', true);
  return null;
end;
$$;

create trigger trg_motos_prestamo_refinanciado after insert on public.loans
  for each row when (new.refinanced_from_id is not null)
  execute function public.motos_prestamo_refinanciado();

-- Venta a crédito o financiada saldada: la matrícula queda lista para entregar; si
-- se anula el abono que la saldó, vuelve a custodia.
create or replace function public.motos_venta_saldada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cancelled_at is not null
     or not exists (select 1 from public.vehicles where sale_id = new.id) then
    return null;
  end if;

  perform set_config('motos.sistema', 'si', true);
  if new.payment_status::text = 'paid' then
    update public.vehicles
       set registration_status = 'lista_para_entregar', registration_since = now()
     where sale_id = new.id and status = 'vendido' and registration_status = 'en_custodia';
  elsif old.payment_status::text = 'paid' then
    update public.vehicles
       set registration_status = 'en_custodia', registration_since = now()
     where sale_id = new.id and status = 'vendido' and registration_status = 'lista_para_entregar';
  end if;
  perform set_config('motos.sistema', '', true);
  return null;
end;
$$;

create trigger trg_motos_venta_saldada after update of payment_status on public.sales
  for each row when (old.payment_status is distinct from new.payment_status)
  execute function public.motos_venta_saldada();

-- Anular la venta de una moto que después se dio en garantía dejaría la unidad
-- con el cliente (en garantía o liberada) y una venta anulada: se rechaza. Desde lo
-- vivo de motos_anular_venta (9e02e4f81fb39ba605fe30116ff3cbc2); el raise deshace
-- annul_sale entero.
create or replace function public.motos_anular_venta(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.vehicles
              where sale_id = p_sale_id and status in ('en_garantia', 'liberado')) then
    raise exception 'La moto de esta venta se usó después como garantía de un préstamo: no se puede anular la venta.';
  end if;
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

-- 5. Entregar la matrícula -------------------------------------------------------------
-- Lista para entregar: quien edita vehículos la entrega. En custodia (deuda sin
-- saldar): solo un administrador, y con motivo.

create or replace function public.motos_entregar_matricula(
  p_vehicle_id uuid, p_recibe text, p_cedula text, p_motivo_forzado text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v       public.vehicles%rowtype;
  v_recibe text := nullif(btrim(coalesce(p_recibe, '')), '');
  v_cedula text := nullif(btrim(coalesce(p_cedula, '')), '');
  v_motivo text := nullif(btrim(coalesce(p_motivo_forzado, '')), '');
  v_nota   text;
begin
  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found or not (public.is_super_admin() or v.company_id = public.current_company_id()) then
    raise exception 'Vehículo no encontrado.';
  end if;
  if not public.motos_tiene_permiso(v.branch_id, 'motos', 'edit') then
    raise exception 'No tienes permiso para entregar matrículas.';
  end if;
  if v_recibe is null then
    raise exception 'Escribe el nombre de quien retira la matrícula.';
  end if;
  if v.registration_status = 'en_custodia' then
    if not (public.is_company_admin() or public.is_super_admin()) or v_motivo is null then
      raise exception 'La deuda de esta moto no está saldada. Solo un administrador puede entregar la matrícula, y con motivo.';
    end if;
  elsif v.registration_status <> 'lista_para_entregar' then
    raise exception 'Esa matrícula no está en custodia.';
  end if;

  v_nota := 'Entregada a ' || v_recibe || coalesce(' (' || v_cedula || ')', '')
            || case when v.registration_status = 'en_custodia' then ' · Forzada: ' || v_motivo else '' end;

  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.nota', v_nota, true);
  update public.vehicles
     set registration_status = 'entregada',
         registration_since = now(),
         registration_delivered_to = v_recibe,
         registration_delivered_doc = v_cedula,
         registration_delivered_at = now(),
         registration_delivered_by_name = (select name from public.profiles where id = auth.uid())
   where id = p_vehicle_id;
  perform set_config('motos.sistema', '', true);
  perform set_config('motos.nota', '', true);
end;
$$;

-- 6. Grants ------------------------------------------------------------------------------

revoke execute on function public.motos_crear_prestamo(jsonb, jsonb) from public, anon;
revoke execute on function public.motos_entregar_matricula(uuid, text, text, text) from public, anon;
revoke execute on function public.motos_prestamo_estado() from public, anon, authenticated;
revoke execute on function public.motos_prestamo_refinanciado() from public, anon, authenticated;
revoke execute on function public.motos_venta_saldada() from public, anon, authenticated;

grant execute on function public.motos_crear_prestamo(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.motos_entregar_matricula(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.motos_prestamo_estado() to service_role;
grant execute on function public.motos_prestamo_refinanciado() to service_role;
grant execute on function public.motos_venta_saldada() to service_role;
