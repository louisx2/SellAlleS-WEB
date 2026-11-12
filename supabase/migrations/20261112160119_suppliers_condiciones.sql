-- Proveedores: los campos que traen los sistemas de compras y que faltaban.
--   trade_name           nombre comercial (la DGII lo trae al escribir el RNC)
--   credit_days          plazo que da el proveedor; 0 = contado, null = sin plazo
--   expense_type_606     tipo de gasto (casilla 11 del 606) que trae su factura
--   bank_*               cuenta para pagarle por transferencia
--   notes                horarios, quién despacha, etc.
-- Todas opcionales: los proveedores que ya existen quedan igual. Las facturas de
-- Cuentas por Pagar las usan como valores iniciales (se pueden cambiar).
--
-- Grants: la tabla ya tiene los suyos (de antes del 30-oct-2026) y los grants de
-- tabla cubren las columnas nuevas. No hace falta ninguno aquí.

alter table public.suppliers
  add column trade_name text,
  add column credit_days integer,
  add column expense_type_606 text,
  add column bank_name text,
  add column bank_account_type text,
  add column bank_account_number text,
  add column notes text;

alter table public.suppliers
  add constraint suppliers_credit_days_check
    check (credit_days between 0 and 365),
  add constraint suppliers_expense_type_606_check
    check (expense_type_606 in ('01','02','03','04','05','06','07','08','09','10','11')),
  add constraint suppliers_bank_account_type_check
    check (bank_account_type in ('ahorro','corriente'));

comment on column public.suppliers.credit_days is
  'Días de crédito del proveedor: 0 = contado, null = sin plazo. La factura nueva vence en fecha + días.';
comment on column public.suppliers.expense_type_606 is
  'Tipo de gasto del 606 (01-11) que trae por defecto la factura de este proveedor.';
