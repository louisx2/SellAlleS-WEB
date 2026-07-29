-- El enlace corto del comprobante ahora tambien sirve prestamos.
--
-- receipt_links nacio atada a una venta. El comprobante del prestamo (el que
-- lleva el cronograma de cuotas y la firma del cliente) se comparte igual: se
-- sube el PDF a Storage y se manda un codigo corto que la funcion `c` resuelve
-- y firma en el momento. Todo eso ya funciona y no cambia; lo unico que hacia
-- falta era que la fila pudiera apuntar a un prestamo en vez de a una venta.
--
-- Ni `c` ni limpiar_comprobantes() se tocan: trabajan sobre storage_path y
-- expires_at, que siguen igual.

alter table public.receipt_links
  add column if not exists loan_id uuid references public.loans(id) on delete cascade;

-- Deja de ser obligatoria: las filas de prestamo no tienen venta.
alter table public.receipt_links
  alter column sale_id drop not null;

-- Uno u otro, nunca ambos ni ninguno. Sin esto una fila podria quedar sin
-- dueno y el enlace apuntaria a un PDF que nadie sabe de quien es.
alter table public.receipt_links
  drop constraint if exists receipt_links_venta_o_prestamo;
alter table public.receipt_links
  add constraint receipt_links_venta_o_prestamo
  check ((sale_id is not null) <> (loan_id is not null));

create index if not exists receipt_links_loan_id_idx on public.receipt_links (loan_id);

comment on column public.receipt_links.loan_id is
  'Prestamo al que pertenece el comprobante. Excluyente con sale_id.';
