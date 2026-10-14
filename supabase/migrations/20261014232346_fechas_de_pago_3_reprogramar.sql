-- Fechas de pago de los financiamientos (3 de 4): la bitácora de cambios de
-- fecha y la RPC para reprogramar las cuotas pendientes.

create table if not exists public.financing_schedule_changes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  sale_id         uuid not null references public.sales(id) on delete cascade,
  reason          text,
  -- [{ "installment": 1, "before": "2026-03-10", "after": "2026-03-30" }, ...]
  changes         jsonb not null,
  changed_by      uuid references public.profiles(id),
  changed_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists financing_schedule_changes_sale_idx
  on public.financing_schedule_changes (sale_id, created_at desc);
create index if not exists financing_schedule_changes_company_idx
  on public.financing_schedule_changes (company_id, created_at desc);

comment on table public.financing_schedule_changes is
  'Bitácora de cambios de fecha en las cuotas de un financiamiento: qué cuota, de qué fecha a cuál, quién y por qué. Solo la escribe reschedule_financing_installments.';

alter table public.financing_schedule_changes enable row level security;

-- Mismo criterio que `financing_amendments`: solo la lee quien puede hacer el
-- cambio, y solo la escribe la RPC, que es SECURITY DEFINER.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'financing_schedule_changes'
                    and policyname = 'financing_schedule_changes_select') then
    create policy financing_schedule_changes_select on public.financing_schedule_changes
      for select using (
        (company_id = current_company_id() and is_company_admin()) or is_super_admin()
      );
  end if;
end $$;

revoke all on table public.financing_schedule_changes from anon, authenticated;
grant select on table public.financing_schedule_changes to authenticated;

create or replace function public.reschedule_financing_installments(
  p_sale_id uuid,
  p_installment_number int,
  p_new_date date,
  p_shift_following boolean default true,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale      sales%rowtype;
  v_target    financing_installments%rowtype;
  v_freq      text;
  v_start     date;
  v_new       date;
  v_prev_due  date;
  v_prev_num  int;
  v_changes   jsonb := '[]'::jsonb;
  v_user_name text;
  r           record;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;
  -- SECURITY DEFINER: salta RLS para escribir las cuotas, así que el permiso
  -- se valida aquí. Mismo criterio que anular abonos o corregir el plan.
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede cambiar las fechas de pago.';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta está anulada.';
  end if;
  if p_new_date is null then
    raise exception 'Indica la nueva fecha.';
  end if;

  -- Bloquea el plan completo: un abono que entre a la vez no puede pagar una
  -- cuota entre que se valida y se mueve.
  perform 1 from financing_installments where sale_id = p_sale_id for update;

  select * into v_target
    from financing_installments
   where sale_id = p_sale_id and installment_number = p_installment_number;
  if not found then
    raise exception 'Esa cuota no existe en este financiamiento.';
  end if;
  if v_target.status = 'paid' then
    raise exception 'La cuota % ya está pagada: no se puede mover.', p_installment_number;
  end if;

  v_start := sale_local_date(v_sale.company_id, v_sale.created_at);
  if p_new_date < v_start then
    raise exception 'La cuota no puede vencer antes de la venta (%).', to_char(v_start, 'DD/MM/YYYY');
  end if;

  v_freq := coalesce(nullif(v_sale.financing_details->>'frequency', ''), 'monthly');

  -- Las siguientes se cuentan desde la fecha nueva (no se corren N días), así
  -- una mensual movida al 31 sigue cayendo a fin de mes. Las pagadas no se
  -- tocan; por el orden en que se aplican los abonos no debería haber una
  -- pagada después de una pendiente, pero si la hay, el chequeo de orden la
  -- defiende.
  for r in
    select id, installment_number, due_date, status
      from financing_installments
     where sale_id = p_sale_id
     order by installment_number
  loop
    v_new := case
      when r.installment_number = p_installment_number then p_new_date
      when p_shift_following and r.installment_number > p_installment_number and r.status <> 'paid'
        then financing_due_date(p_new_date, v_freq, r.installment_number - p_installment_number)
      else r.due_date
    end;

    if v_prev_due is not null and v_new <= v_prev_due then
      raise exception 'Las fechas tienen que quedar en orden: la cuota % tiene que vencer después de la cuota % (%).',
        r.installment_number, v_prev_num, to_char(v_prev_due, 'DD/MM/YYYY');
    end if;

    if v_new <> r.due_date then
      -- El recordatorio era para la fecha vieja: que vuelva a salir para la nueva.
      update financing_installments
         set due_date = v_new, reminder_sent_at = null
       where id = r.id;
      v_changes := v_changes || jsonb_build_object(
        'installment', r.installment_number, 'before', r.due_date, 'after', v_new);
    end if;

    v_prev_due := v_new;
    v_prev_num := r.installment_number;
  end loop;

  if jsonb_array_length(v_changes) = 0 then
    raise exception 'Las fechas quedarían iguales: no hay nada que cambiar.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into financing_schedule_changes
    (company_id, sale_id, reason, changes, changed_by, changed_by_name)
  values
    (v_sale.company_id, v_sale.id, nullif(btrim(coalesce(p_reason, '')), ''), v_changes,
     auth.uid(), v_user_name);

  return jsonb_build_object('sale_id', v_sale.id, 'changes', v_changes);
end;
$function$;

comment on function public.reschedule_financing_installments(uuid, int, date, boolean, text) is
  'Mueve la fecha de una cuota sin pagar de un financiamiento y, si se pide, recalcula las siguientes desde ahí con la frecuencia del plan. Las fechas tienen que quedar en orden y no antes de la venta. Deja rastro en financing_schedule_changes. Solo administradores.';

revoke all on function public.reschedule_financing_installments(uuid, int, date, boolean, text) from public, anon;
grant execute on function public.reschedule_financing_installments(uuid, int, date, boolean, text) to authenticated, service_role;
