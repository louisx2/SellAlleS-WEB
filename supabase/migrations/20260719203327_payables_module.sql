-- Módulo de Cuentas por Pagar (payables) + Compras a inventario (purchases).
-- Facturas de suplidores a nivel documento con los campos del Formato 606 de
-- DGII, abonos por RPC (patrón del motor de crédito) y entrada de stock
-- opcional cuando el módulo 'purchases' está activo para la empresa.

-- ── Tablas ──────────────────────────────────────────────────────────────────

create table public.supplier_invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null default current_company_id() references public.companies(id),
  branch_id         uuid references public.branches(id),
  supplier_id       uuid not null references public.suppliers(id),
  invoice_number    text,
  issue_date        date not null,                -- fecha comprobante (606)
  due_date          date,
  payment_date      date,                         -- última fecha de pago (606)
  status            text not null default 'pending' check (status in ('pending','partial','paid')),
  subtotal_goods    numeric not null default 0 check (subtotal_goods >= 0),   -- monto facturado bienes (606)
  subtotal_services numeric not null default 0 check (subtotal_services >= 0),-- monto facturado servicios (606)
  total             numeric not null check (total >= 0),
  amount_paid       numeric not null default 0 check (amount_paid >= 0),
  -- Las retenciones no se pagan al suplidor (se remiten a DGII), por eso se
  -- netean del balance: la factura queda saldada al pagar total - retenciones.
  balance           numeric generated always as
                      (total - itbis_retenido - isr_retention_amount - amount_paid) stored,
  -- Fiscal DGII (0/null para empresas informales)
  ncf               text,
  ncf_modified      text,
  expense_type      text check (expense_type in ('01','02','03','04','05','06','07','08','09','10','11')),
  itbis_facturado   numeric not null default 0 check (itbis_facturado >= 0),
  itbis_retenido    numeric not null default 0 check (itbis_retenido >= 0),
  itbis_proporcionalidad numeric not null default 0 check (itbis_proporcionalidad >= 0),
  itbis_llevado_costo    numeric not null default 0 check (itbis_llevado_costo >= 0),
  isr_retention_type   text check (isr_retention_type in ('01','02','03','04','05','06','07','08')),
  isr_retention_amount numeric not null default 0 check (isr_retention_amount >= 0),
  impuesto_selectivo   numeric not null default 0 check (impuesto_selectivo >= 0),
  otros_impuestos      numeric not null default 0 check (otros_impuestos >= 0),
  propina_legal        numeric not null default 0 check (propina_legal >= 0),
  payment_form      text check (payment_form in ('01','02','03','04','05','06','07')),
  notes             text,
  user_id           uuid default auth.uid(),
  user_name         text,
  created_at        timestamptz not null default now()
);

create index supplier_invoices_company_status_idx on public.supplier_invoices (company_id, status);
create index supplier_invoices_company_issue_idx  on public.supplier_invoices (company_id, issue_date);
create index supplier_invoices_supplier_idx       on public.supplier_invoices (supplier_id);
create index supplier_invoices_branch_idx         on public.supplier_invoices (branch_id);
-- El NCF es único por emisor: no puede repetirse para el mismo suplidor.
create unique index supplier_invoices_ncf_uniq
  on public.supplier_invoices (company_id, supplier_id, ncf) where ncf is not null;

create table public.supplier_invoice_items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default current_company_id() references public.companies(id),
  invoice_id   uuid not null references public.supplier_invoices(id) on delete cascade,
  product_id   uuid references public.products(id),   -- null = línea libre (sin inventario)
  description  text not null,
  quantity     numeric not null check (quantity > 0),
  unit_cost    numeric not null check (unit_cost >= 0),
  itbis_amount numeric not null default 0 check (itbis_amount >= 0),
  created_at   timestamptz not null default now()
);

create index supplier_invoice_items_invoice_idx on public.supplier_invoice_items (invoice_id);
create index supplier_invoice_items_product_idx on public.supplier_invoice_items (product_id);

create table public.supplier_payments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default current_company_id() references public.companies(id),
  invoice_id   uuid not null references public.supplier_invoices(id),
  supplier_id  uuid not null references public.suppliers(id),
  branch_id    uuid references public.branches(id),
  amount       numeric not null check (amount > 0),
  method       text not null check (method in ('cash','card','transfer')),
  reference    text,
  notes        text,
  user_id      uuid default auth.uid(),
  user_name    text,
  date         timestamptz not null default now()
);

create index supplier_payments_company_date_idx on public.supplier_payments (company_id, date);
create index supplier_payments_invoice_idx      on public.supplier_payments (invoice_id);
create index supplier_payments_supplier_idx     on public.supplier_payments (supplier_id);
create index supplier_payments_branch_idx       on public.supplier_payments (branch_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- SELECT sin gate de módulo: apagar el módulo oculta la UI, no corrompe datos.
-- INSERT exige el módulo 'payables' activo. DELETE solo sin abonos.
-- branch_id null = documento a nivel empresa, visible para cualquier miembro.

alter table public.supplier_invoices enable row level security;

create policy supplier_invoices_select on public.supplier_invoices for select
  using (((company_id = current_company_id())
          and (is_company_admin() or branch_id in (select user_branch_ids()) or branch_id is null))
         or is_super_admin());

create policy supplier_invoices_insert on public.supplier_invoices for insert
  with check ((company_id = current_company_id())
              and (is_company_admin() or branch_id in (select user_branch_ids()) or branch_id is null)
              and is_module_enabled(company_id, 'payables', false));

create policy supplier_invoices_update on public.supplier_invoices for update
  using (((company_id = current_company_id())
          and (is_company_admin() or branch_id in (select user_branch_ids()) or branch_id is null))
         or is_super_admin())
  with check (((company_id = current_company_id())
               and (is_company_admin() or branch_id in (select user_branch_ids()) or branch_id is null))
              or is_super_admin());

create policy supplier_invoices_delete on public.supplier_invoices for delete
  using ((((company_id = current_company_id())
           and (is_company_admin() or branch_id in (select user_branch_ids()) or branch_id is null))
          or is_super_admin())
         and amount_paid = 0);

alter table public.supplier_invoice_items enable row level security;

create policy supplier_invoice_items_all on public.supplier_invoice_items for all
  using ((company_id = current_company_id()) or is_super_admin())
  with check ((company_id = current_company_id()) or is_super_admin());

alter table public.supplier_payments enable row level security;

create policy supplier_payments_all on public.supplier_payments for all
  using (((company_id = current_company_id())
          and (is_company_admin() or branch_id in (select user_branch_ids()) or branch_id is null))
         or is_super_admin())
  with check (((company_id = current_company_id())
               and (is_company_admin() or branch_id in (select user_branch_ids()) or branch_id is null))
              or is_super_admin());

-- ── RPC: registrar abono a una factura de suplidor ──────────────────────────

create or replace function public.register_supplier_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_invoice       supplier_invoices%rowtype;
  v_company       uuid;
  v_user_name     text;
  v_supplier_name text;
  v_payment_id    uuid;
  v_session       caja_sessions%rowtype;
  v_new_paid      numeric;
  v_new_balance   numeric;
  v_new_status    text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del abono debe ser mayor que cero.';
  end if;
  if p_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into v_invoice from supplier_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Factura no encontrada.';
  end if;
  if v_invoice.status = 'paid' then
    raise exception 'Esta factura ya está saldada.';
  end if;

  v_company := v_invoice.company_id;

  if p_amount > v_invoice.balance + 0.01 then
    raise exception 'El abono (RD$%) excede el balance pendiente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'),
      to_char(v_invoice.balance, 'FM999,999,990.00');
  end if;

  if p_method = 'cash' and is_module_enabled(v_company, 'caja', false)
     and (p_branch_id is null or not has_open_caja(p_branch_id)) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de pagar en efectivo.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();
  select name into v_supplier_name from suppliers where id = v_invoice.supplier_id;

  insert into supplier_payments
    (company_id, invoice_id, supplier_id, branch_id, amount, method, reference, notes, user_id, user_name, date)
  values
    (v_company, v_invoice.id, v_invoice.supplier_id, p_branch_id, p_amount,
     p_method, p_reference, p_notes, auth.uid(), v_user_name, now())
  returning id into v_payment_id;

  v_new_paid    := v_invoice.amount_paid + p_amount;
  v_new_balance := v_invoice.total - v_invoice.itbis_retenido - v_invoice.isr_retention_amount - v_new_paid;
  v_new_status  := case when v_new_balance <= 0.01 then 'paid' else 'partial' end;

  update supplier_invoices
     set amount_paid  = v_new_paid,
         payment_date = current_date,
         status       = v_new_status
   where id = v_invoice.id;

  -- El cierre de caja cuadra por movimientos: un pago en efectivo a un
  -- suplidor sale del efectivo de la sucursal.
  if p_method = 'cash' and is_module_enabled(v_company, 'caja', false) then
    select * into v_session from caja_sessions
     where branch_id = p_branch_id and status = 'open' for update;
    if found then
      insert into caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values
        (v_session.id, v_company, p_branch_id, 'out', p_amount,
         'Pago a suplidor: ' || coalesce(v_supplier_name, ''), auth.uid(), v_user_name);
    end if;
  end if;

  return jsonb_build_object(
    'payment_id',        v_payment_id,
    'amount',            p_amount,
    'remaining_balance', greatest(v_new_balance, 0),
    'status',            v_new_status
  );
end;
$function$;

grant execute on function public.register_supplier_payment to authenticated;

-- ── RPC: crear factura de suplidor (con items y stock opcionales) ───────────

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

    -- Solo con el módulo 'purchases' activo la compra entra al inventario.
    if v_purchases_on and v_item.product_id is not null then
      update products set stock = stock + v_item.quantity
       where id = v_item.product_id and company_id = v_company;
      if not found then
        raise exception 'Producto no encontrado para esta empresa.';
      end if;
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

-- ── Roles: los admins de sistema ven el módulo nuevo ────────────────────────

update public.roles
   set permissions = permissions || '{"payables":["view","create","edit","delete"]}'::jsonb
 where is_system = true and key = 'admin' and not (permissions ? 'payables');

create or replace function public.seed_system_roles()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into roles (company_id, name, key, is_system, description, permissions)
  values (
    NEW.id, 'Administrador', 'admin', true, 'Acceso completo a la empresa.',
    '{"dashboard":["view","create","edit","delete"],"pos":["view","create","edit","delete"],"sales":["view","create","edit","delete"],"quotes":["view","create","edit","delete"],"services":["view","create","edit","delete"],"credit":["view","create","edit","delete"],"financing":["view","create","edit","delete"],"prestamos":["view","create","edit","delete"],"caja":["view","create","edit","delete"],"expenses":["view","create","edit","delete"],"payables":["view","create","edit","delete"],"reports":["view","create","edit","delete"],"products":["view","create","edit","delete"],"customers":["view","create","edit","delete"],"suppliers":["view","create","edit","delete"],"company-profile":["view","create","edit","delete"],"users":["view","create","edit","delete"],"branches":["view","create","edit","delete"],"roles":["view","create","edit","delete"],"suscripcion":["view","create","edit","delete"],"service-types":["view","create","edit","delete"]}'::jsonb
  )
  on conflict (company_id, key) where key is not null do nothing;

  insert into roles (company_id, name, key, is_system, description, permissions)
  values (
    NEW.id, 'Cajero', 'cashier', true, 'Acceso limitado para vender.',
    '{"dashboard":["view"],"pos":["view","create"],"quotes":["view","create"],"services":["view","create"],"caja":["view","create"]}'::jsonb
  )
  on conflict (company_id, key) where key is not null do nothing;

  return NEW;
end;
$function$;
