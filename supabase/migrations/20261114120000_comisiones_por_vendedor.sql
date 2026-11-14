-- Comisiones por vendedor.
--
-- Un módulo nuevo, `commissions`, apagado por defecto (se enciende por empresa
-- en Plataforma → Módulos). Con el módulo encendido:
--   · cada miembro de la empresa tiene un % de comisión (lo fija el admin);
--   · cada venta guarda quién la vendió y el % que tenía ESE día, así cambiar el
--     % mañana no reescribe lo que ya se ganó;
--   · la comisión se calcula sobre lo vendido sin ITBIS (total - itbis_amount;
--     el total de una venta financiada no lleva el interés) y las ventas
--     anuladas no cuentan. Eso lo hace el reporte, aquí solo se guarda el dato.
--
-- El vendedor es por defecto quien cobra (sales.user_id); en el cobro se puede
-- elegir otro miembro de la empresa. Un admin puede corregirlo después.
--
-- `seller_id` va SIN foreign key a propósito: `sales` ya tiene una a `profiles`
-- (user_id) y una segunda vuelve ambiguo para PostgREST cualquier embed entre
-- ventas y perfiles (300 Multiple Choices; ver el incidente de branch_sharing).
-- La pertenencia a la empresa la valida el trigger, y `seller_name` guarda el
-- nombre de aquel día por si el perfil desaparece.
--
-- Contenido:
--   1. Columnas profile_companies.commission_rate y sales.seller_id,
--      seller_name, commission_rate.
--   2. Trigger before_sale_vendedor (INSERT): vendedor por defecto, validación
--      y % congelado.
--   3. Trigger proteger_vendedor_venta (UPDATE): solo un admin cambia vendedor
--      o % de una venta ya hecha.
--   4. create_sale_with_items acepta `seller_id` (partiendo de la definición
--      viva; lo único nuevo es esa columna).
--   5. RPCs: vendedores_de_empresa(), fijar_comision_vendedor(),
--      cambiar_vendedor_venta().

-- ── 1. Columnas ──────────────────────────────────────────────────────────────
alter table public.profile_companies
  add column if not exists commission_rate numeric(5,2) not null default 0;

alter table public.profile_companies
  drop constraint if exists profile_companies_commission_rate_rango;
alter table public.profile_companies
  add constraint profile_companies_commission_rate_rango
  check (commission_rate >= 0 and commission_rate <= 100);

comment on column public.profile_companies.commission_rate is
  '% de comisión del miembro sobre lo que vende (sin ITBIS). Solo cuenta con el módulo commissions encendido.';

alter table public.sales
  add column if not exists seller_id uuid,
  add column if not exists seller_name text,
  add column if not exists commission_rate numeric(5,2);

comment on column public.sales.seller_id is
  'Quién vendió (perfil). Por defecto quien cobró (user_id). Sin FK a propósito: ver migración 20261114120000.';
comment on column public.sales.seller_name is
  'Nombre del vendedor el día de la venta.';
comment on column public.sales.commission_rate is
  '% de comisión del vendedor congelado al vender. Nulo = la venta no comisiona (módulo apagado o vendedor sin membresía).';

create index if not exists sales_company_seller_created_idx
  on public.sales (company_id, seller_id, created_at);

-- ── 2. Vendedor y % al vender ────────────────────────────────────────────────
create or replace function public.before_sale_vendedor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rate numeric;
  v_nombre text;
begin
  new.seller_id := coalesce(new.seller_id, new.user_id);

  if new.seller_id is null then
    new.seller_name := null;
    new.commission_rate := null;
    return new;
  end if;

  select pc.commission_rate, coalesce(nullif(btrim(p.name), ''), p.email)
    into v_rate, v_nombre
    from public.profile_companies pc
    join public.profiles p on p.id = pc.profile_id
   where pc.profile_id = new.seller_id
     and pc.company_id = new.company_id;

  if not found then
    -- Elegir a alguien de fuera de la empresa no se permite. Quien cobra sin
    -- membresía (super admin de plataforma, procesos de servicio) sí puede
    -- vender: la venta queda a su nombre y sin comisión.
    if new.seller_id is distinct from new.user_id then
      raise exception 'El vendedor elegido no pertenece a esta empresa.';
    end if;
    new.seller_name := new.user_name;
    new.commission_rate := null;
    return new;
  end if;

  new.seller_name := v_nombre;
  new.commission_rate := case
    when public.is_module_enabled(new.company_id, 'commissions', false) then v_rate
    else null
  end;
  return new;
end;
$$;

revoke all on function public.before_sale_vendedor() from public, anon, authenticated;

drop trigger if exists trg_before_sale_vendedor on public.sales;
create trigger trg_before_sale_vendedor
  before insert on public.sales
  for each row execute function public.before_sale_vendedor();

-- ── 3. Nadie más que un admin cambia el vendedor de una venta hecha ──────────
-- La política de `sales` deja actualizar filas a cualquiera de la sucursal; sin
-- esto un vendedor podría subirse el % por la API.
create or replace function public.proteger_vendedor_venta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.seller_id is distinct from old.seller_id
      or new.seller_name is distinct from old.seller_name
      or new.commission_rate is distinct from old.commission_rate)
     and auth.uid() is not null
     and not public.is_company_admin() then
    raise exception 'Solo un administrador puede cambiar el vendedor o la comisión de una venta.';
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_vendedor_venta() from public, anon, authenticated;

drop trigger if exists trg_proteger_vendedor_venta on public.sales;
create trigger trg_proteger_vendedor_venta
  before update of seller_id, seller_name, commission_rate on public.sales
  for each row execute function public.proteger_vendedor_venta();

-- ── 4. create_sale_with_items acepta seller_id ───────────────────────────────
-- Copia de la definición viva (pg_get_functiondef, 2026-11-14). Lo único nuevo
-- es `seller_id` en el insert de la venta; el resto queda igual, casts a ENUM
-- incluidos. Una app vieja que no lo manda deja el vendedor en quien cobra.
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
    financing_details, user_name, user_email, quote_id, coupon_id, seller_id
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
    nullif(p_sale->>'seller_id', '')::uuid
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
      presentation_id uuid, units_per numeric
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
       presentation_id, presentation_name, units_per)
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
      v_pres_id, v_pres_name, v_units_per
    );
  end loop;

  return v_sale;
end;
$function$;

-- ── 5. RPCs ──────────────────────────────────────────────────────────────────

-- Los miembros de la empresa activa, para elegir vendedor en el cobro y para
-- la pantalla de porcentajes. Cualquier miembro la puede llamar (un cajero
-- elige vendedor), pero el % solo lo ve un admin.
create or replace function public.vendedores_de_empresa()
returns table (
  profile_id uuid,
  nombre text,
  email text,
  rol text,
  activo boolean,
  commission_rate numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id,
         coalesce(nullif(btrim(p.name), ''), p.email),
         p.email,
         pc.role::text,
         coalesce(p.is_active, true),
         case when public.is_company_admin() then pc.commission_rate end
    from public.profile_companies pc
    join public.profiles p on p.id = pc.profile_id
   where pc.company_id = public.current_company_id()
     and (
       public.is_super_admin()
       or exists (
         select 1 from public.profile_companies yo
          where yo.profile_id = auth.uid()
            and yo.company_id = pc.company_id
       )
     )
   order by 2;
$$;

revoke all on function public.vendedores_de_empresa() from public, anon;
grant execute on function public.vendedores_de_empresa() to authenticated, service_role;

create or replace function public.fijar_comision_vendedor(p_profile_id uuid, p_rate numeric)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rate numeric;
begin
  if not public.is_company_admin() then
    raise exception 'Solo un administrador puede fijar las comisiones.';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 then
    raise exception 'El porcentaje de comisión debe estar entre 0 y 100.';
  end if;

  update public.profile_companies
     set commission_rate = round(p_rate, 2)
   where profile_id = p_profile_id
     and company_id = public.current_company_id()
  returning commission_rate into v_rate;

  if not found then
    raise exception 'Ese usuario no pertenece a esta empresa.';
  end if;
  return v_rate;
end;
$$;

revoke all on function public.fijar_comision_vendedor(uuid, numeric) from public, anon;
grant execute on function public.fijar_comision_vendedor(uuid, numeric) to authenticated, service_role;

-- Corrige el vendedor de una venta (el cajero olvidó elegirlo). El % que queda
-- es el que el vendedor nuevo tiene hoy: es el que habría quedado si se hubiera
-- elegido bien al cobrar, salvo que su % haya cambiado desde entonces.
create or replace function public.cambiar_vendedor_venta(p_sale_id uuid, p_seller_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale public.sales%rowtype;
  v_rate numeric;
  v_nombre text;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found or v_sale.company_id is distinct from public.current_company_id() then
    raise exception 'Venta no encontrada.';
  end if;
  if not public.is_company_admin() then
    raise exception 'Solo un administrador puede cambiar el vendedor de una venta.';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'La venta está anulada: ya no comisiona.';
  end if;

  select pc.commission_rate, coalesce(nullif(btrim(p.name), ''), p.email)
    into v_rate, v_nombre
    from public.profile_companies pc
    join public.profiles p on p.id = pc.profile_id
   where pc.profile_id = p_seller_id
     and pc.company_id = v_sale.company_id;
  if not found then
    raise exception 'El vendedor elegido no pertenece a esta empresa.';
  end if;

  update public.sales
     set seller_id = p_seller_id,
         seller_name = v_nombre,
         commission_rate = case
           when public.is_module_enabled(v_sale.company_id, 'commissions', false) then v_rate
           else null
         end
   where id = p_sale_id;
end;
$$;

revoke all on function public.cambiar_vendedor_venta(uuid, uuid) from public, anon;
grant execute on function public.cambiar_vendedor_venta(uuid, uuid) to authenticated, service_role;
