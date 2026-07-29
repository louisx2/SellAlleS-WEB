-- Cuanto dinero le queda al prestamista para seguir prestando.
--
-- Hasta ahora la pantalla decia cuanto hay en la calle, pero no cuanto queda
-- disponible. La forma simple — un numero fijo en configuracion — miente en
-- cuanto entra el primer abono: el dinero que volvio no se ve y hay que
-- corregir el numero a mano cada vez que se mete o se saca plata del negocio.
--
-- Aqui solo se guarda lo que el sistema NO puede deducir: los aportes (meti
-- dinero al negocio) y los retiros (saque ganancia). Lo demas ya esta
-- registrado, asi que el disponible sale de una resta:
--
--   disponible = aportes - retiros - capital desembolsado + cobrado
--
-- Con eso, lo que el cliente devuelve vuelve a estar disponible solo, sin que
-- nadie toque una configuracion. Es, literalmente, la caja del negocio de
-- prestamos.
--
-- La funcion es OPCIONAL: apagada, la app se comporta exactamente como antes.

-- ── Banderas de la empresa ──────────────────────────────────────────────────

alter table public.companies
  add column if not exists loan_fund_enabled boolean not null default false;

-- Que hacer cuando el prestamo pasa lo disponible. Por defecto avisa y deja
-- seguir: bloquear de entrada traba al que metio dinero y todavia no lo
-- registro, que es el olvido mas comun.
alter table public.companies
  add column if not exists loan_fund_block_overdraft boolean not null default false;

comment on column public.companies.loan_fund_enabled is
  'Lleva el capital disponible para prestar. Apagada, el modulo de prestamos no muestra nada de fondo.';

-- ── Movimientos del fondo ───────────────────────────────────────────────────

create table if not exists public.loan_fund_movements (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references public.companies(id) on delete cascade,
  -- Null = fondo de la empresa. La columna existe desde el principio para no
  -- tener que migrar el dia que alguien quiera separar el capital por sucursal;
  -- hoy el resumen suma todo.
  branch_id  uuid references public.branches(id),
  type       text not null check (type in ('aporte','retiro')),
  amount     numeric not null check (amount > 0),
  reason     text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  user_name  text,
  created_at timestamptz not null default now()
);

create index if not exists loan_fund_movements_company_idx on public.loan_fund_movements (company_id, created_at desc);

alter table public.loan_fund_movements enable row level security;

-- Solo administradores de la empresa: meter o sacar capital del negocio no es
-- una tarea de mostrador, y el numero que sale de aqui gobierna si se puede
-- prestar o no.
create policy loan_fund_movements_select on public.loan_fund_movements for select
  using ((company_id = current_company_id()) or is_super_admin());

create policy loan_fund_movements_insert on public.loan_fund_movements for insert
  with check ((company_id = current_company_id())
              and is_company_admin()
              and is_module_enabled(company_id, 'prestamos', false));

create policy loan_fund_movements_delete on public.loan_fund_movements for delete
  using (((company_id = current_company_id()) and is_company_admin()) or is_super_admin());

comment on table public.loan_fund_movements is
  'Aportes y retiros de capital del negocio de prestamos. Lo unico que no se puede deducir del resto de las tablas.';

-- ── El resumen ──────────────────────────────────────────────────────────────

-- Se calcula en el servidor y de un viaje. El navegador tiene los prestamos
-- cargados pero no los abonos de todos ellos, y traerlos solo para sumarlos
-- seria caro y se desincronizaria en cuanto alguien cobre en otra sucursal.
create or replace function public.loan_fund_summary(p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_company    uuid;
  v_aportes    numeric;
  v_retiros    numeric;
  v_prestado   numeric;
  v_cobrado    numeric;
begin
  v_company := current_company_id();
  if v_company is null then
    raise exception 'No hay empresa activa.';
  end if;

  select coalesce(sum(amount) filter (where type = 'aporte'), 0),
         coalesce(sum(amount) filter (where type = 'retiro'), 0)
    into v_aportes, v_retiros
    from loan_fund_movements
   where company_id = v_company
     and (p_branch_id is null or branch_id = p_branch_id or branch_id is null);

  -- Capital entregado. Los cancelados quedan fuera: si un prestamo se anulo, el
  -- dinero no llego a salir o ya volvio, y contarlo dejaria el fondo corto para
  -- siempre.
  select coalesce(sum(principal), 0)
    into v_prestado
    from loans
   where company_id = v_company
     and status <> 'cancelled'
     and (p_branch_id is null or branch_id = p_branch_id);

  -- Todo lo que entro por abonos: capital, interes y mora. Es dinero en la
  -- gaveta, y desde el punto de vista del fondo no se distingue. Quien quiera
  -- apartar la ganancia lo hace con un retiro.
  select coalesce(sum(p.amount), 0)
    into v_cobrado
    from loan_payments p
    join loans l on l.id = p.loan_id
   where p.company_id = v_company
     and (p_branch_id is null or l.branch_id = p_branch_id);

  return jsonb_build_object(
    'aportes',     v_aportes,
    'retiros',     v_retiros,
    'desembolsado', v_prestado,
    'cobrado',     v_cobrado,
    'disponible',  round(v_aportes - v_retiros - v_prestado + v_cobrado, 2)
  );
end;
$function$;

grant execute on function public.loan_fund_summary(uuid) to authenticated;
