-- Un código de artículo no puede repetirse dentro de la misma sucursal.
--
-- Dos productos con el mismo código rompen el escaneo en el POS: el lector
-- encuentra uno cualquiera y se vende (y descuenta stock) del equivocado.
--
-- No es un índice único porque en producción ya hay códigos repetidos de antes
-- (Pujols, Michelle, Comercial GP...) y el índice no se podría crear sin tocar
-- datos de clientes. El trigger solo mira la fila que se inserta o cuyo código
-- cambia, así que lo viejo sigue funcionando y no entra nada repetido nuevo.
--
-- Reglas:
--   * Se compara sin mayúsculas ni espacios de los lados ('ABC ' = 'abc').
--   * Los códigos vacíos o nulos no cuentan (artículos sin código).
--   * Un archivado también ocupa su código: lo correcto es restaurarlo, no crear
--     otro igual. Y al restaurar uno, se bloquea si ya hay un activo con ese
--     código.
--   * Tampoco puede coincidir con el código de una presentación de la sucursal.
--   * Editar un artículo sin cambiarle el código no se valida, para no impedir
--     cambiarle el precio a uno de los repetidos viejos.

create or replace function public.impedir_codigo_producto_repetido()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_code text := lower(btrim(coalesce(new.code, '')));
  v_otro record;
  v_restaurando boolean := false;
begin
  if v_code = '' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_restaurando := not old.is_active and new.is_active;
    if lower(btrim(coalesce(old.code, ''))) = v_code
       and old.branch_id = new.branch_id
       and not v_restaurando then
      return new;
    end if;
  end if;

  -- Serializa dos altas simultáneas con el mismo código en la misma sucursal.
  perform pg_advisory_xact_lock(hashtextextended(new.branch_id::text || '|' || v_code, 0));

  select p.name, p.is_active into v_otro
    from products p
   where p.branch_id = new.branch_id
     and lower(btrim(p.code)) = v_code
     and p.id <> new.id
     and (not v_restaurando or p.is_active)
   order by p.is_active desc
   limit 1;

  if found then
    if v_otro.is_active then
      raise exception 'Ya existe un artículo con el código «%»: %.', btrim(new.code), v_otro.name
        using errcode = '23505', hint = 'codigo_duplicado';
    else
      raise exception 'El código «%» es de un artículo archivado (%). Restáuralo desde Archivados en lugar de crear otro.', btrim(new.code), v_otro.name
        using errcode = '23505', hint = 'codigo_duplicado_archivado';
    end if;
  end if;

  -- El mismo código en una presentación (caja, fardo...) también choca: al
  -- escanear no se sabría cuál de los dos es. Es la otra mitad de la regla que
  -- ya aplica product_presentations_before_write.
  select p.name into v_otro
    from product_presentations x
    join products p on p.id = x.product_id
   where x.branch_id = new.branch_id
     and x.code is not null and btrim(x.code) <> ''
     and lower(btrim(x.code)) = v_code
   limit 1;

  if found then
    raise exception 'El código «%» ya lo usa una presentación de «%» en esta sucursal.', btrim(new.code), v_otro.name
      using errcode = '23505', hint = 'codigo_duplicado';
  end if;

  return new;
end;
$$;

create or replace trigger trg_impedir_codigo_producto_repetido
  before insert or update of code, branch_id, is_active on public.products
  for each row execute function public.impedir_codigo_producto_repetido();

-- La búsqueda del trigger, y la del POS al escanear.
create index if not exists products_branch_code_norm_idx
  on public.products (branch_id, lower(btrim(code)))
  where code is not null and btrim(code) <> '';
