-- Datos del cliente en la factura, a pedido.
--   receipt_customer_info_enabled  la empresa usa la opción: con esto encendido,
--                                  el pago muestra la casilla "Incluir datos del
--                                  cliente en la factura" (desmarcada).
--   receipt_customer_fields        qué datos salen cuando se marca: address,
--                                  phone, email.
-- Caso que lo pidió: Comercial GP entrega con chofer y él necesita la dirección y
-- el teléfono del cliente. Las empresas que ya existen quedan igual (apagado).
--
-- Grants: la tabla ya tiene los suyos y los grants de tabla cubren las columnas
-- nuevas. No hace falta ninguno aquí.

alter table public.companies
  add column if not exists receipt_customer_info_enabled boolean not null default false,
  add column if not exists receipt_customer_fields text[] not null default '{address,phone}';

alter table public.companies
  add constraint companies_receipt_customer_fields_check
    check (receipt_customer_fields <@ array['address','phone','email']::text[]);

comment on column public.companies.receipt_customer_info_enabled is
  'Si el pago ofrece incluir los datos del cliente en la factura (casilla por venta, desmarcada).';
comment on column public.companies.receipt_customer_fields is
  'Datos del cliente que salen en la factura cuando se incluyen: address, phone, email.';
