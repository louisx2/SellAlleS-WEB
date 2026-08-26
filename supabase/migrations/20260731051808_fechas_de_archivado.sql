-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Cuándo se archivó y cuándo se restauró un producto. Las pone un trigger para
-- que la app no pueda mentir con la fecha.

alter table public.products
  add column archived_at timestamptz,
  add column restored_at timestamptz;

comment on column public.products.archived_at is
  'Cuándo se archivó por última vez (is_active pasó a false). La pone un trigger, no la app.';
comment on column public.products.restored_at is
  'Cuándo se restauró por última vez (is_active volvió a true). La pone un trigger, no la app.';

create or replace function public.marcar_archivado_producto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.is_active is not distinct from OLD.is_active then
    return NEW;
  end if;

  if NEW.is_active then
    NEW.restored_at := now();
  else
    NEW.archived_at := now();
  end if;

  return NEW;
end;
$function$;

revoke all on function public.marcar_archivado_producto() from public, anon, authenticated;

drop trigger if exists trg_marcar_archivado_producto on public.products;
create trigger trg_marcar_archivado_producto
before update of is_active on public.products
for each row execute function public.marcar_archivado_producto();
