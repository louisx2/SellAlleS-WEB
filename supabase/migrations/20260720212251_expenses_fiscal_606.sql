-- Datos fiscales opcionales en Gastos (Formato 606 de DGII).
-- Un gasto con comprobante (NCF) puede reportarse en el 606 junto a las
-- facturas de Cuentas por Pagar: combustible, dieta, compras menores (B13),
-- comprobante de compras (B11), etc.

alter table public.expenses
  add column if not exists rnc text,                                   -- RNC/cédula del suplidor del gasto
  add column if not exists ncf text,                                   -- NCF del comprobante recibido
  add column if not exists expense_type text,                          -- tipo bienes/servicios 606 ('01'..'11')
  add column if not exists itbis_amount numeric not null default 0,    -- ITBIS incluido en amount
  add column if not exists is_goods boolean not null default false,    -- true = bienes, false = servicios (casillas 8/9)
  add column if not exists payment_form text,                          -- forma de pago 606 ('01'..'07')
  add column if not exists user_name text;

-- El mismo comprobante de un mismo suplidor no se registra dos veces.
create unique index if not exists expenses_company_rnc_ncf_key
  on public.expenses (company_id, rnc, ncf)
  where ncf is not null;
