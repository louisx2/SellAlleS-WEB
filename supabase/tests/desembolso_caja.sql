-- Pruebas del desembolso de préstamos por caja. NO es una migración: se corre
-- contra producción dentro de una transacción que se revierte, después de las
-- dos migraciones de la entrega 1:
--
--   begin; <20261124120000_cobro_diario_y_mas_cuotas.sql> <20261124130000_desembolso_por_caja.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Datos con UUID fijos (…d2XX) en la
-- empresa demo; enciende la caja de la empresa y de la sucursal demo solo
-- dentro de la transacción.

select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);

create function pg_temp.debe_fallar(p_sql text, p_like text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like then
      raise exception 'falló con otro mensaje: % (esperaba %)', sqlerrm, p_like;
    end if;
    return;
  end;
  raise exception 'debió fallar: %', p_sql;
end $$;

create function pg_temp.igual(p_real anyelement, p_esperado anyelement, p_que text) returns void
language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception '%: dio %, esperaba %', p_que, p_real, p_esperado;
  end if;
end $$;

-- Préstamo mensual de prueba en la sucursal demo, con la forma de entrega dada.
create function pg_temp.prestamo(p_id uuid, p_principal numeric, p_method text, p_ref text default null) returns void
language sql as $$
  insert into loans (id, company_id, branch_id, customer_id, principal, interest_rate, installments_count,
                     payment_frequency, disbursement_method, disbursement_reference)
  values (p_id, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000000d2', p_principal, 5, 12, 'monthly', p_method, p_ref);
$$;

create function pg_temp.movimientos(p_loan uuid) returns int
language sql as $$ select count(*)::int from caja_movements where loan_id = p_loan $$;

-- Caja encendida en la empresa y en la sucursal, con una sesión abierta nuestra.
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'caja', true)
on conflict (company_id, module_key) do update set enabled = true;
update branches set caja_enabled = true where id = '00000000-0000-0000-0000-0000000000b1';
update caja_sessions set status = 'closed'
 where branch_id = '00000000-0000-0000-0000-0000000000b1' and status = 'open';
insert into caja_sessions (id, company_id, branch_id, opening_amount)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000aa',
        '00000000-0000-0000-0000-0000000000b1', 1000);

insert into customers (id, company_id, name)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000aa', 'Prueba desembolso');

-- En efectivo con caja abierta: una salida por el monto prestado.
select pg_temp.prestamo('00000000-0000-0000-0000-0000000000d3', 5000, 'cash');
select pg_temp.igual(pg_temp.movimientos('00000000-0000-0000-0000-0000000000d3'), 1, 'movimientos del efectivo');
select pg_temp.igual((select type from caja_movements where loan_id = '00000000-0000-0000-0000-0000000000d3'), 'out'::text, 'tipo');
select pg_temp.igual((select amount from caja_movements where loan_id = '00000000-0000-0000-0000-0000000000d3'), 5000::numeric, 'monto');
select pg_temp.igual((select session_id from caja_movements where loan_id = '00000000-0000-0000-0000-0000000000d3'),
                     '00000000-0000-0000-0000-0000000000d1'::uuid, 'sesión');
select pg_temp.igual((select reason from caja_movements where loan_id = '00000000-0000-0000-0000-0000000000d3'),
                     'Desembolso de préstamo: Prueba desembolso'::text, 'motivo');

-- Por transferencia: queda la referencia, no toca la caja.
select pg_temp.prestamo('00000000-0000-0000-0000-0000000000d4', 5000, 'transfer', 'TRX-1');
select pg_temp.igual(pg_temp.movimientos('00000000-0000-0000-0000-0000000000d4'), 0, 'movimientos de la transferencia');
select pg_temp.igual((select disbursement_reference from loans where id = '00000000-0000-0000-0000-0000000000d4'), 'TRX-1'::text, 'referencia');

-- Sin forma de entrega (el front viejo que sirve el SW): sin error y sin movimiento.
select pg_temp.prestamo('00000000-0000-0000-0000-0000000000d5', 5000, null);
select pg_temp.igual(pg_temp.movimientos('00000000-0000-0000-0000-0000000000d5'), 0, 'movimientos sin forma');

-- Una sucursal de otra empresa se rechaza antes de tocar su caja.
select pg_temp.debe_fallar(format($q$insert into loans (company_id, branch_id, customer_id, principal, interest_rate, installments_count, payment_frequency, disbursement_method)
  values ('00000000-0000-0000-0000-0000000000aa', %L, '00000000-0000-0000-0000-0000000000d2', 5000, 5, 12, 'monthly', 'transfer')$q$,
  (select id from branches where company_id <> '00000000-0000-0000-0000-0000000000aa' limit 1)), '%Sucursal no válida%');

-- Forma no válida.
select pg_temp.debe_fallar($$select pg_temp.prestamo('00000000-0000-0000-0000-0000000000d6', 5000, 'cheque')$$,
                           '%disbursement_method%');

-- Caja cerrada: el efectivo se rechaza, la transferencia pasa.
update caja_sessions set status = 'closed' where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.debe_fallar($$select pg_temp.prestamo('00000000-0000-0000-0000-0000000000d6', 5000, 'cash')$$,
                           '%Abre caja antes de entregar el préstamo en efectivo%');
select pg_temp.prestamo('00000000-0000-0000-0000-0000000000d7', 5000, 'transfer');

-- Caja encendida en la empresa pero apagada en la sucursal: efectivo sin caja.
update branches set caja_enabled = false where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.prestamo('00000000-0000-0000-0000-0000000000d8', 5000, 'cash');
select pg_temp.igual(pg_temp.movimientos('00000000-0000-0000-0000-0000000000d8'), 0, 'movimientos sin caja en la sucursal');

-- Refinanciación con dinero adicional en efectivo: sale solo lo adicional, y
-- queda enlazado al préstamo nuevo. Sin adicional no hay salida.
update branches set caja_enabled = true where id = '00000000-0000-0000-0000-0000000000b1';
update caja_sessions set status = 'open' where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.prestamo('00000000-0000-0000-0000-0000000000d9', 10000, 'transfer');

select pg_temp.debe_fallar($$select refinance_loan('00000000-0000-0000-0000-0000000000d9', 'capital', null, 3000, 5, 12,
                                                   'weekly', null, 'prueba', null, null, 'cheque', null)$$,
                           '%Forma de entrega%');

do $$
declare
  r jsonb;
  v_nuevo uuid;
begin
  r := refinance_loan('00000000-0000-0000-0000-0000000000d9', 'capital', null, 3000, 5, 12,
                      'weekly', null, 'prueba', null, null, 'cash', null);
  v_nuevo := (r->>'new_loan_id')::uuid;
  perform pg_temp.igual(pg_temp.movimientos(v_nuevo), 1, 'movimientos de la refinanciación');
  perform pg_temp.igual((select amount from caja_movements where loan_id = v_nuevo), 3000::numeric, 'monto adicional');
  perform pg_temp.igual((select disbursement_method from loans where id = v_nuevo), 'cash'::text, 'forma en el préstamo nuevo');

  r := refinance_loan(v_nuevo, 'capital', null, 0, 5, 12, 'weekly', null, 'prueba sin adicional', null, null, 'cash', null);
  perform pg_temp.igual(pg_temp.movimientos((r->>'new_loan_id')::uuid), 0, 'movimientos sin adicional');
  perform pg_temp.igual((select disbursement_method from loans where id = (r->>'new_loan_id')::uuid), null::text, 'forma sin adicional');
end $$;

-- La firma vieja ya no existe y la nueva no la puede ejecutar anon.
select pg_temp.igual(to_regprocedure('public.refinance_loan(uuid,text,text,numeric,numeric,integer,text,date,text,numeric,numeric)'),
                     null::regprocedure, 'firma vieja');
select pg_temp.igual(has_function_privilege('anon',
  'public.refinance_loan(uuid,text,text,numeric,numeric,integer,text,date,text,numeric,numeric,text,text)', 'EXECUTE'),
  false, 'anon refinancia');

select 'ok' as resultado;
