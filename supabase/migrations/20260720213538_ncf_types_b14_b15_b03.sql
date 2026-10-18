-- Tipos de NCF adicionales (Norma 06-2018/07-2018):
--   B15 gubernamental (ventas al Estado), B14 regímenes especiales (zonas
--   francas/exentos) como tipos de comprobante del cliente y la venta;
--   B03 nota de débito solo como secuencia registrable (la emisión de notas
--   de débito es un flujo aparte, pendiente).

-- El enum ncf_type lo comparten sales.ncf_type y customers.ncf_type.
alter type public.ncf_type add value if not exists 'gubernamental';
alter type public.ncf_type add value if not exists 'regimen_especial';

-- ncf_sequences.tipo es text con check: se amplía el catálogo.
alter table public.ncf_sequences drop constraint if exists ncf_sequences_tipo_check;
alter table public.ncf_sequences
  add constraint ncf_sequences_tipo_check
  check (tipo in ('consumer', 'fiscal', 'nota_credito', 'gubernamental', 'regimen_especial', 'nota_debito'));
