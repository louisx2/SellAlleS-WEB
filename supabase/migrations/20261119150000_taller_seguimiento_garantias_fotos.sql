-- =============================================================================
-- Taller, entregas 2 y 4 (lo que va en la base):
--   1. Seguimiento: cada caso tiene un código público (10 caracteres, imposible
--      de adivinar) y una función que devuelve lo que puede ver el cliente.
--   2. Garantías: un caso puede venir por garantía de otro caso o de una venta;
--      al entregar se calcula hasta cuándo cubre.
--   3. Fotos del equipo: tabla + bucket privado `taller`, por carpeta de empresa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Seguimiento
-- -----------------------------------------------------------------------------

-- Mismo alfabeto que los enlaces de comprobantes (sin 0/O, 1/l/I). Los bytes
-- salen de gen_random_uuid (122 bits aleatorios del generador criptográfico).
create or replace function public.taller_codigo_seguimiento()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alfabeto constant text := '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_codigo text := '';
begin
  for i in 0..9 loop
    v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % 56) + 1, 1);
  end loop;
  return v_codigo;
end;
$$;
revoke execute on function public.taller_codigo_seguimiento() from public, anon;
grant execute on function public.taller_codigo_seguimiento() to authenticated, service_role;

alter table public.services add column tracking_code text;
update public.services set tracking_code = public.taller_codigo_seguimiento() where tracking_code is null;
alter table public.services alter column tracking_code set default public.taller_codigo_seguimiento();
alter table public.services alter column tracking_code set not null;
create unique index services_tracking_code_uq on public.services(tracking_code);

-- Lo que ve el cliente con el código: el negocio, el caso y su avance. Nada de
-- IMEI, clave, notas internas ni nombres del personal. SECURITY DEFINER y abierta
-- a `anon` a propósito: la página /seguimiento no tiene sesión, y lo que protege
-- el caso es el código (56^10 combinaciones), igual que los enlaces de factura.
create or replace function public.taller_seguimiento_publico(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_srv public.services%rowtype;
  v_res jsonb;
begin
  if p_code is null or length(p_code) <> 10 then
    return null;
  end if;

  select * into v_srv from public.services where tracking_code = p_code;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'negocio', jsonb_build_object(
      'nombre', coalesce(nullif(btrim(b.display_name), ''), c.name),
      'telefono', coalesce(nullif(btrim(b.phone), ''), c.phone),
      'direccion', coalesce(nullif(btrim(b.address), ''), c.address),
      'logo', coalesce(b.ticket_logo_url, b.logo_url, c.ticket_logo_url, c.logo_url)
    ),
    'caso', jsonb_build_object(
      'numero', v_srv.number,
      'estado', v_srv.status,
      'equipo', nullif(btrim(concat_ws(' ', v_srv.equipment_brand, v_srv.equipment_model)), ''),
      'tipo_equipo', (select name from public.service_equipment_types where id = v_srv.equipment_type_id),
      'cliente', split_part(coalesce(cu.name, v_srv.brought_by_name, ''), ' ', 1),
      'ingreso', v_srv.created_at,
      'prometido', v_srv.promised_at,
      'listo', v_srv.ready_at,
      'entregado', v_srv.delivered_at,
      'total', v_srv.total,
      'cobrado', v_srv.payment_status = 'paid',
      'garantia_hasta', v_srv.warranty_until
    ),
    -- Las notas de los cambios de estado solo salen si se marcaron para el cliente.
    'avance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'estado', e.to_status,
               'nota', case when e.visible_to_customer then e.note end,
               'fecha', e.created_at) order by e.created_at)
        from public.service_events e
       where e.service_id = v_srv.id and e.kind in ('created', 'status')
    ), '[]'::jsonb),
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object('nota', e.note, 'fecha', e.created_at) order by e.created_at)
        from public.service_events e
       where e.service_id = v_srv.id and e.kind = 'note' and e.visible_to_customer
    ), '[]'::jsonb)
  ) into v_res
  from public.branches b
  join public.companies c on c.id = b.company_id
  left join public.customers cu on cu.id = v_srv.customer_id
  where b.id = v_srv.branch_id;

  return v_res;
end;
$$;
revoke execute on function public.taller_seguimiento_publico(text) from public;
grant execute on function public.taller_seguimiento_publico(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Garantías
-- -----------------------------------------------------------------------------

alter table public.services
  add column warranty_of_service_id uuid references public.services(id) on delete set null,
  add column warranty_sale_id       uuid references public.sales(id) on delete set null,
  add column warranty_until         date;

create index services_warranty_of_idx on public.services(warranty_of_service_id) where warranty_of_service_id is not null;

-- Entregar ahora también calcula hasta cuándo cubre la garantía: los días del
-- servicio del catálogo que más da, o los del taller por defecto. Solo si se
-- entregó reparado y el caso no es él mismo una garantía (no se encadena).
create or replace function public.taller_entregar(
  p_service_id uuid, p_picked_up_by text default null, p_note text default null)
returns public.services
language plpgsql
set search_path = public
as $$
declare
  v_srv    public.services%rowtype;
  v_nombre text;
  v_dias   integer;
begin
  select * into v_srv from public.services where id = p_service_id;
  if not found then
    raise exception 'Caso no encontrado.';
  end if;
  if v_srv.status not in ('ready', 'not_repaired') then
    raise exception 'El caso #% no está listo para entregar.', v_srv.number;
  end if;
  if v_srv.sale_id is null and coalesce(v_srv.total, 0) > 0 then
    raise exception 'El caso #% tiene RD$% por cobrar: cóbralo en el POS antes de entregarlo.',
      v_srv.number, to_char(v_srv.total, 'FM999,999,990.00');
  end if;

  select name into v_nombre from public.profiles where id = auth.uid();

  if v_srv.status = 'ready' and v_srv.warranty_of_service_id is null and v_srv.warranty_sale_id is null then
    select coalesce(
             (select max(st.warranty_days)
                from public.service_items si
                join public.service_types st on st.id = si.service_type_id
               where si.service_id = v_srv.id and si.kind = 'labor'),
             (select ts.default_warranty_days from public.taller_settings ts where ts.branch_id = v_srv.branch_id))
      into v_dias;
  end if;

  perform set_config('taller.entregar', 'si', true);
  perform set_config('taller.nota', coalesce(p_note, ''), true);

  update public.services
     set status = 'delivered',
         delivered_at = now(),
         delivered_by = auth.uid(),
         delivered_by_name = v_nombre,
         picked_up_by_name = nullif(btrim(coalesce(p_picked_up_by, '')), ''),
         outcome = case when v_srv.status = 'not_repaired' then 'not_repaired' else 'repaired' end,
         completed_at = coalesce(completed_at, now()),
         warranty_until = case when coalesce(v_dias, 0) > 0
                               then public.company_today(v_srv.company_id) + v_dias end
   where id = p_service_id;
  if not found then
    raise exception 'No tienes permiso para entregar este caso.';
  end if;

  perform set_config('taller.entregar', '', true);
  select * into v_srv from public.services where id = p_service_id;
  return v_srv;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Fotos del equipo
-- -----------------------------------------------------------------------------

create table public.service_photos (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  service_id  uuid not null references public.services(id) on delete cascade,
  -- taller/<empresa>/<caso>/<uuid>.<ext>
  path        text not null,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index service_photos_service_idx on public.service_photos(service_id, created_at);

alter table public.service_photos enable row level security;

-- Ver y agregar fotos = ver el caso (la subconsulta hereda la RLS de services).
create policy service_photos_select on public.service_photos
  for select using (exists (select 1 from public.services s where s.id = service_photos.service_id));
create policy service_photos_insert on public.service_photos
  for insert with check (
    company_id = public.current_company_id()
    and exists (select 1 from public.services s where s.id = service_photos.service_id and s.company_id = service_photos.company_id)
  );
create policy service_photos_delete on public.service_photos
  for delete using (
    exists (select 1 from public.services s
             where s.id = service_photos.service_id
               and public.taller_tiene_permiso(s.branch_id, 'services', 'edit'))
  );

grant select, insert, delete on public.service_photos to authenticated;
grant select, insert, update, delete on public.service_photos to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('taller', 'taller', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy taller_fotos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'taller'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
  );
create policy taller_fotos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'taller'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
  );
create policy taller_fotos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'taller'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
  );
