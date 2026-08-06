-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Archivar en vez de borrar: un producto que ya se vendió no se puede eliminar
-- sin llevarse el historial por delante.

alter table public.products
  add column is_active boolean not null default true;

comment on column public.products.is_active is
  'false = archivado: no aparece en el POS ni en el inventario, pero conserva su historial de ventas. Los artículos sin historial se borran de verdad, no se archivan.';

create index if not exists products_branch_activos_idx
  on public.products (branch_id)
  where is_active;
