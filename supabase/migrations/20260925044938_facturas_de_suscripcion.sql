-- Factura por cada pago de suscripción.
--
-- Hasta ahora, registrar un pago solo mandaba un correo de "Recibo de pago"
-- sin número ni documento. Desde aquí cada pago nace con su factura: un número
-- consecutivo y una copia de los datos del emisor (SellAlleS) y del cliente (la
-- empresa) tal como estaban al emitirla. El PDF se arma en el navegador a
-- partir de esa fila, así que reimprimir una factura vieja da la misma factura
-- aunque la empresa cambie de nombre o SellAlleS de dirección.
--
-- La factura vive en la misma fila del pago y no en una tabla aparte: es uno a
-- uno, y así hereda sin más las políticas que ya tiene subscription_payments
-- (la ve el admin de la empresa y el super admin; solo el super admin escribe).

-- ── Datos del emisor ───────────────────────────────────────────────────────
-- En platform_settings, que es legible por anon. No rompe la regla de "nada
-- sensible aquí": todo esto sale impreso en cada factura que se entrega.
-- Los formatos los valida también la pantalla de Plataforma; si se relaja uno
-- hay que relajar el otro.
alter table public.platform_settings
  add column invoice_legal_name     text,
  add column invoice_rnc            text check (invoice_rnc ~ '^[0-9]{9}([0-9]{2})?$'),
  add column invoice_address        text,
  add column invoice_phone          text,
  add column invoice_email          text check (invoice_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add column invoice_notes          text,
  add column invoice_itbis_included boolean not null default false;

comment on column public.platform_settings.invoice_legal_name is
  'Nombre o razón social que emite las facturas de suscripción. Vacío: "SellAlleS".';
comment on column public.platform_settings.invoice_rnc is
  'RNC (9 dígitos) o cédula (11) del emisor, solo dígitos. Vacío: la factura no lo muestra.';
comment on column public.platform_settings.invoice_notes is
  'Texto al pie de cada factura (condiciones, agradecimiento, cuenta para transferir).';
comment on column public.platform_settings.invoice_itbis_included is
  'Si el monto cobrado ya incluye ITBIS (18%) y la factura debe desglosarlo. Solo tiene sentido si el emisor está formalizado.';

-- ── La factura dentro del pago ─────────────────────────────────────────────
alter table public.subscription_payments
  add column invoice_number   integer,
  add column invoice_issuer   jsonb,
  add column invoice_customer jsonb,
  add column invoice_itbis    numeric(12,2) not null default 0;

comment on column public.subscription_payments.invoice_number is
  'Número de la factura del pago. Consecutivo y sin huecos; lo asigna el trigger, nunca el cliente.';
comment on column public.subscription_payments.invoice_issuer is
  'Copia de los datos del emisor al emitir: legal_name, rnc, address, phone, email, notes.';
comment on column public.subscription_payments.invoice_customer is
  'Copia de los datos de la empresa al emitir: name, rnc, address, phone, email.';
comment on column public.subscription_payments.invoice_itbis is
  'ITBIS incluido en amount, congelado al emitir. 0 si el emisor no desglosa ITBIS.';

-- ── Contador de facturas ───────────────────────────────────────────────────
-- Una fila que solo sube. No sirve sacar el número de max(invoice_number)+1:
-- delete_company_cascade borra los pagos de la empresa, y si era la dueña de
-- la última factura, la siguiente repetiría un número que ya está en manos de
-- alguien. Tampoco una secuencia: deja huecos cada vez que una transacción se
-- revierte, y a una numeración de facturas no le pueden faltar números. El
-- update de esta fila hace las dos cosas: la bloquea hasta el commit (dos pagos
-- a la vez esperan uno por el otro) y se deshace con la transacción.
--
-- Sin políticas y sin permisos para la API: solo la toca el trigger de abajo.
-- Tampoco va en platform_settings, que lee anon: cuántas facturas se han
-- emitido no es cosa de la landing.
create table public.subscription_invoice_counter (
  id          boolean primary key default true check (id),
  last_number integer not null default 0 check (last_number >= 0)
);

comment on table public.subscription_invoice_counter is
  'Último número de factura de suscripción emitido. Una sola fila; la usa solo el trigger subscription_payments_emitir_factura.';

alter table public.subscription_invoice_counter enable row level security;
revoke all on public.subscription_invoice_counter from anon, authenticated;

insert into public.subscription_invoice_counter (id, last_number) values (true, 0);

-- ── Emisión ────────────────────────────────────────────────────────────────
-- Trigger y no dentro de record_subscription_payment: el super admin también
-- puede insertar directo por la API (su política lo permite), y un pago sin
-- factura, o con un número elegido a mano, no debe poder existir.
create or replace function public.subscription_payments_emitir_factura()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ajustes platform_settings%rowtype;
  v_empresa record;
begin
  update subscription_invoice_counter
     set last_number = last_number + 1
   where id
  returning last_number into new.invoice_number;

  if new.invoice_number is null then
    raise exception 'Falta la fila de subscription_invoice_counter; no se puede numerar la factura.';
  end if;

  select * into v_ajustes from platform_settings limit 1;

  -- Si no se configuró teléfono o correo para facturas, se usan los canales de
  -- soporte que estén encendidos: una factura sin forma de contacto no sirve.
  new.invoice_issuer := jsonb_strip_nulls(jsonb_build_object(
    'legal_name', coalesce(nullif(btrim(v_ajustes.invoice_legal_name), ''), 'SellAlleS'),
    'rnc',        v_ajustes.invoice_rnc,
    'address',    nullif(btrim(v_ajustes.invoice_address), ''),
    'phone',      coalesce(
                    nullif(btrim(v_ajustes.invoice_phone), ''),
                    case when v_ajustes.support_whatsapp_enabled then v_ajustes.support_whatsapp_label end),
    'email',      coalesce(
                    v_ajustes.invoice_email,
                    case when v_ajustes.support_email_enabled then v_ajustes.support_email end),
    'notes',      nullif(btrim(v_ajustes.invoice_notes), '')
  ));

  select name, rnc, address, phone, email
    into v_empresa
    from companies
   where id = new.company_id;

  new.invoice_customer := jsonb_strip_nulls(jsonb_build_object(
    'name',    v_empresa.name,
    'rnc',     nullif(btrim(v_empresa.rnc), ''),
    'address', nullif(btrim(v_empresa.address), ''),
    'phone',   nullif(btrim(v_empresa.phone), ''),
    'email',   nullif(btrim(v_empresa.email), '')
  ));

  -- Hacia adentro, igual que las sucursales con precios con ITBIS incluido:
  -- el total no cambia, solo se desglosa.
  new.invoice_itbis := case
    when coalesce(v_ajustes.invoice_itbis_included, false)
      then round(new.amount - new.amount / 1.18, 2)
    else 0
  end;

  return new;
end;
$$;

revoke all on function public.subscription_payments_emitir_factura() from public, anon, authenticated;

create trigger subscription_payments_emitir_factura
  before insert on public.subscription_payments
  for each row execute function public.subscription_payments_emitir_factura();

-- ── Pagos anteriores ───────────────────────────────────────────────────────
-- Si ya hay pagos registrados, reciben número en el orden en que se hicieron y
-- los datos vigentes hoy (no hay otros). Sin pagos, no hace nada.
with numerados as (
  select id, row_number() over (order by created_at, id) as num
    from public.subscription_payments
   where invoice_number is null
)
update public.subscription_payments sp
   set invoice_number = n.num + coalesce((select max(invoice_number) from public.subscription_payments), 0),
       invoice_issuer = jsonb_strip_nulls(jsonb_build_object(
         'legal_name', 'SellAlleS',
         'phone', (select case when support_whatsapp_enabled then support_whatsapp_label end from public.platform_settings limit 1),
         'email', (select case when support_email_enabled then support_email end from public.platform_settings limit 1)
       )),
       invoice_customer = jsonb_strip_nulls(jsonb_build_object(
         'name', c.name,
         'rnc', nullif(btrim(c.rnc), ''),
         'address', nullif(btrim(c.address), ''),
         'phone', nullif(btrim(c.phone), ''),
         'email', nullif(btrim(c.email), '')
       ))
  from numerados n, public.companies c
 where sp.id = n.id
   and c.id = sp.company_id;

update public.subscription_invoice_counter
   set last_number = coalesce((select max(invoice_number) from public.subscription_payments), 0);

alter table public.subscription_payments
  alter column invoice_number set not null,
  add constraint subscription_payments_invoice_number_key unique (invoice_number);

-- ── record_subscription_payment ────────────────────────────────────────────
-- Misma definición que la viva. Se recrea para que cada sesión vuelva a
-- compilarla con el tipo de fila nuevo de subscription_payments (devuelve la
-- fila entera, y el cliente lee de ahí el número de factura).
create or replace function public.record_subscription_payment(
  p_company_id uuid,
  p_amount numeric,
  p_paid_at date default null::date,
  p_method text default 'transfer'::text,
  p_reference text default null::text,
  p_period_start date default null::date,
  p_period_end date default null::date,
  p_plan_name text default null::text,
  p_notes text default null::text,
  p_activate boolean default true
)
returns subscription_payments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  v_row  subscription_payments%rowtype;
begin
  if not is_super_admin() then
    raise exception 'Solo el super administrador puede registrar pagos.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del pago debe ser mayor que cero.';
  end if;
  if p_method not in ('transfer','cash','card','other') then
    raise exception 'Método de pago no válido.';
  end if;
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Empresa no encontrada.';
  end if;

  select name into v_name from profiles where id = auth.uid();

  insert into subscription_payments
    (company_id, amount, paid_at, method, reference, period_start, period_end, plan_name, notes, recorded_by, recorded_by_name)
  values
    (p_company_id, p_amount, coalesce(p_paid_at, company_today(p_company_id)), p_method, p_reference,
     p_period_start, p_period_end, p_plan_name, p_notes, auth.uid(), v_name)
  returning * into v_row;

  if p_activate then
    update companies
       set status = 'active',
           trial_ends_at = null,
           paid_until = case
             when p_period_end is null then paid_until
             else greatest(p_period_end, coalesce(paid_until, p_period_end))
           end
     where id = p_company_id;
  end if;

  return v_row;
end;
$function$;
