-- Pruebas de la nota de crédito de la venta recuperada (Motopréstamos 4B). NO es una
-- migración: se corre contra producción dentro de una transacción que se revierte,
-- después del SQL de la migración (o sola, si ya está aplicada):
--
--   begin; <20261127120000_motos_nota_credito_recuperacion.sql> <este archivo> rollback;
--
-- Cada caso corre en su propio bloque y anota si pasó; al final, si alguno falló, se
-- detiene con la lista. Datos con UUID fijos (…e9XX) en la empresa demo (e-CF activo
-- en TesteCF), sucursal Principal (…0b1).

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

create function pg_temp.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- Venta de una moto (una línea) con los montos dados. p_metodo: credit | financing.
create function pg_temp.venta(p_vehicle uuid, p_precio numeric, p_itbis boolean, p_incluido boolean,
                              p_subtotal numeric, p_itbis_monto numeric, p_total numeric,
                              p_metodo text default 'credit') returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select s.id into v_id from create_sale_with_items(
    jsonb_build_object(
      'branch_id', '00000000-0000-0000-0000-0000000000b1', 'customer_id', '00000000-0000-0000-0000-00000000e9a1',
      'subtotal', p_subtotal, 'itbis_amount', p_itbis_monto, 'total', p_total, 'itbis_included', p_incluido,
      'payment_method', p_metodo,
      'payment_status', case when p_metodo = 'financing' then 'in_financing' else 'credit' end,
      'amount_paid', 0, 'ncf_requested', false,
      'financing_details', case when p_metodo = 'financing'
        then '{"interestRate":5,"installments":12,"frequency":"monthly","interestMode":"monthly_prorated"}'::jsonb end),
    jsonb_build_array(jsonb_build_object(
      'product_id', '00000000-0000-0000-0000-00000000e9a3', 'product_name', 'Moto de prueba', 'quantity', 1,
      'price', p_precio, 'itbis', p_itbis, 'unit', 'und', 'vehicle_id', p_vehicle))) s;
  return v_id;
end $$;

-- Pone a mano el NCF de la venta (el e-NCF necesita la marca de reemisión). Con e-CF
-- activo toda venta de la demo sale con su E32 y su documento por_enviar aunque no lo
-- pida: ese documento automático se borra para que cada caso decida el suyo.
create function pg_temp.con_ncf(p_sale uuid, p_ncf text) returns void
language plpgsql as $$
begin
  delete from ecf_documentos where sale_id = p_sale;
  perform set_config('sellalles.reemitiendo_ecf', 'on', true);
  update sales set ncf = p_ncf where id = p_sale;
  perform set_config('sellalles.reemitiendo_ecf', '', true);
end $$;

-- Documento e-CF de la venta en el estado dado.
create function pg_temp.ecf_de(p_sale uuid, p_encf text, p_estado text) returns void
language sql as $$
  insert into ecf_documentos (company_id, branch_id, sale_id, tipo_ecf, encf, ambiente, estado)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', p_sale, 32, p_encf, 'TesteCF', p_estado)
$$;

-- Recupera la moto de la venta (4A) con la devolución dada, por transferencia.
create function pg_temp.recuperar(p_vehicle uuid, p_devuelto numeric default 0) returns void
language sql as $$
  select motos_recuperar_venta(p_vehicle, company_today('00000000-0000-0000-0000-0000000000aa'), 'No paga',
                               null, 50000, p_devuelto, 'transfer', null)
$$;

create temp table nc_resultado (caso text, error text);

insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'motoprestamos', true)
on conflict (company_id, module_key) do update set enabled = true;
insert into customers (id, company_id, name) values
  ('00000000-0000-0000-0000-00000000e9a1', '00000000-0000-0000-0000-0000000000aa', 'Prueba nota de crédito');
insert into products (id, company_id, branch_id, name, price, cost, stock, is_vehicle) values
  ('00000000-0000-0000-0000-00000000e9a3', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', 'Prueba moto nota', 95000, 70000, 0, true);
insert into vehicles (id, company_id, branch_id, origin, product_id, brand, model, chassis, cost)
select ('00000000-0000-0000-0000-00000000e9b' || n)::uuid, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
       'inventario', '00000000-0000-0000-0000-00000000e9a3', 'Honda', 'XR', 'NC-' || n, 70000
  from generate_series(1, 9) n;
-- Serie B: una secuencia B04 propia de la prueba (la demo solo tiene las electrónicas).
insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, active, electronica)
values ('00000000-0000-0000-0000-0000000000aa', 'nota_credito', 'B04', 1, 100, 1, true, false);
-- El cajero cc56c633 entra a la demo (sin permiso de administrador).
insert into profile_companies (profile_id, company_id, role)
select 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa', 'cashier'
 where not exists (select 1 from profile_companies where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and company_id = '00000000-0000-0000-0000-0000000000aa');
update profiles set company_id = '00000000-0000-0000-0000-0000000000aa' where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';

-- A. Crédito exenta, serie B, 20,000 abonados y 1,000 devueltos: nota de 76,000.
do $$
declare s uuid; r jsonb; n credit_notes%rowtype;
begin
  begin
    perform pg_temp.igual((select count(*)::int from credit_notes where kind <> 'anulacion'), 0, 'las notas vivas son anulaciones');
    s := pg_temp.venta('00000000-0000-0000-0000-00000000e9b1', 95000, false, false, 95000, 0, 95000);
    perform pg_temp.con_ncf(s, 'B0200000777');
    perform register_sale_payment(s, 20000, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, 'T-A');
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b1', 1000);
    r := motos_nota_credito_recuperacion(s, null);
    select * into n from credit_notes where id = (r->>'credit_note_id')::uuid;
    perform pg_temp.igual(n.total, 76000.00::numeric, 'total de la nota');
    perform pg_temp.igual(n.itbis_amount, 0::numeric, 'ITBIS de la nota');
    perform pg_temp.igual(n.subtotal, 76000.00::numeric, 'subtotal de la nota');
    perform pg_temp.igual(n.kind, 'recuperacion', 'tipo de la nota');
    perform pg_temp.igual(n.ncf, 'B0400000001', 'B04 asignado');
    perform pg_temp.igual(n.ncf_modified, 'B0200000777', 'NCF que modifica');
    perform pg_temp.igual(jsonb_array_length(n.items), 1, 'una línea');
    perform pg_temp.igual((n.items->0->>'precio')::numeric, 76000::numeric, 'precio de la línea');
    perform pg_temp.igual((n.items->0->>'cantidad')::numeric, 1::numeric, 'cantidad de la línea');
    perform pg_temp.igual((n.items->0->>'itbis')::boolean, false, 'línea exenta');
    perform pg_temp.igual((r->>'total')::numeric, 76000::numeric, 'total devuelto por la RPC');
    perform pg_temp.debe_fallar(format('select motos_nota_credito_recuperacion(%L)', s), '%ya tiene una nota de crédito%');
    insert into nc_resultado values ('A crédito exenta', null);
  exception when others then
    insert into nc_resultado values ('A crédito exenta', sqlerrm);
  end;
end $$;

-- B. Gravada con ITBIS aparte: 118,000 con 18,000 abonados → nota de 100,000.
do $$
declare s uuid; r jsonb; n credit_notes%rowtype;
begin
  begin
    s := pg_temp.venta('00000000-0000-0000-0000-00000000e9b2', 100000, true, false, 100000, 18000, 118000);
    perform pg_temp.con_ncf(s, 'B0200000778');
    perform register_sale_payment(s, 18000, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, 'T-B');
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b2');
    r := motos_nota_credito_recuperacion(s, 'Recuperación');
    select * into n from credit_notes where id = (r->>'credit_note_id')::uuid;
    perform pg_temp.igual((n.items->0->>'precio')::numeric, 84745.76::numeric, 'línea gravada');
    perform pg_temp.igual(n.itbis_amount, 15254.24::numeric, 'ITBIS');
    perform pg_temp.igual(n.total, 100000.00::numeric, 'total');
    perform pg_temp.igual(n.subtotal, 84745.76::numeric, 'subtotal');
    insert into nc_resultado values ('B ITBIS aparte', null);
  exception when others then
    insert into nc_resultado values ('B ITBIS aparte', sqlerrm);
  end;
end $$;

-- C. Gravada con ITBIS incluido: 118,000 con 18,000 abonados → nota de 100,000.
do $$
declare s uuid; r jsonb; n credit_notes%rowtype;
begin
  begin
    s := pg_temp.venta('00000000-0000-0000-0000-00000000e9b3', 118000, true, true, 100000, 18000, 118000);
    perform pg_temp.con_ncf(s, 'B0200000779');
    perform register_sale_payment(s, 18000, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, 'T-C');
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b3');
    r := motos_nota_credito_recuperacion(s, null);
    select * into n from credit_notes where id = (r->>'credit_note_id')::uuid;
    perform pg_temp.igual((n.items->0->>'precio')::numeric, 100000.00::numeric, 'línea con ITBIS incluido');
    perform pg_temp.igual(n.itbis_amount, 15254.24::numeric, 'ITBIS');
    perform pg_temp.igual(n.total, 100000.00::numeric, 'total');
    perform pg_temp.igual(n.subtotal, 84745.76::numeric, 'subtotal');
    insert into nc_resultado values ('C ITBIS incluido', null);
  exception when others then
    insert into nc_resultado values ('C ITBIS incluido', sqlerrm);
  end;
end $$;

-- D. Financiada sin abonos: el factor se topa en 1 y la nota es el total facturado.
do $$
declare s uuid; r jsonb;
begin
  begin
    s := pg_temp.venta('00000000-0000-0000-0000-00000000e9b4', 95000, false, false, 95000, 0, 95000, 'financing');
    perform pg_temp.con_ncf(s, 'B0200000780');
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b4');
    r := motos_nota_credito_recuperacion(s, null);
    perform pg_temp.igual((select total from credit_notes where id = (r->>'credit_note_id')::uuid), 95000.00::numeric, 'nota de la financiada');
    insert into nc_resultado values ('D financiada', null);
  exception when others then
    insert into nc_resultado values ('D financiada', sqlerrm);
  end;
end $$;

-- E. e-CF: con la E32 aceptada sale una E34 encolada; rechazada o sin enviar, no.
do $$
declare s uuid; r jsonb; n credit_notes%rowtype;
begin
  begin
    s := pg_temp.venta('00000000-0000-0000-0000-00000000e9b5', 95000, false, false, 95000, 0, 95000);
    perform pg_temp.con_ncf(s, 'E320000900001');
    perform pg_temp.ecf_de(s, 'E320000900001', 'aceptado');
    perform register_sale_payment(s, 20000, 'transfer', '00000000-0000-0000-0000-0000000000b1', null, 'T-E');
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b5');
    r := motos_nota_credito_recuperacion(s, null);
    select * into n from credit_notes where id = (r->>'credit_note_id')::uuid;
    perform pg_temp.igual(n.ncf ~ '^E34\d{10}$', true, 'E34 asignada');
    perform pg_temp.igual((select row(tipo_ecf, estado)::text from ecf_documentos where credit_note_id = n.id),
                          row(34, 'por_enviar')::text, 'E34 encolada');

    s := pg_temp.venta('00000000-0000-0000-0000-00000000e9b6', 95000, false, false, 95000, 0, 95000);
    perform pg_temp.con_ncf(s, 'E320000900002');
    perform pg_temp.ecf_de(s, 'E320000900002', 'rechazado');
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b6');
    perform pg_temp.debe_fallar(format('select motos_nota_credito_recuperacion(%L)', s), '%rechazado%');

    s := pg_temp.venta('00000000-0000-0000-0000-00000000e9b7', 95000, false, false, 95000, 0, 95000);
    perform pg_temp.con_ncf(s, 'E320000900003');
    perform pg_temp.ecf_de(s, 'E320000900003', 'por_enviar');
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b7');
    perform pg_temp.debe_fallar(format('select motos_nota_credito_recuperacion(%L)', s), '%sin enviar%');
    insert into nc_resultado values ('E e-CF', null);
  exception when others then
    insert into nc_resultado values ('E e-CF', sqlerrm);
  end;
end $$;

-- F. Guardas.
do $$
declare s uuid; s2 uuid;
begin
  begin
    s := pg_temp.venta('00000000-0000-0000-0000-00000000e9b8', 95000, false, false, 95000, 0, 95000);
    perform pg_temp.con_ncf(s, 'B0200000781');
    perform pg_temp.debe_fallar(format('select motos_nota_credito_recuperacion(%L)', s), '%no está recuperada%');
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b8');
    perform pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
    perform pg_temp.debe_fallar(format('select motos_nota_credito_recuperacion(%L)', s), '%Solo un administrador%');
    perform pg_temp.como('92381752-13b2-4f43-8b09-612647754599');

    s2 := pg_temp.venta('00000000-0000-0000-0000-00000000e9b9', 95000, false, false, 95000, 0, 95000);
    perform pg_temp.con_ncf(s2, null);
    perform pg_temp.recuperar('00000000-0000-0000-0000-00000000e9b9');
    perform pg_temp.debe_fallar(format('select motos_nota_credito_recuperacion(%L)', s2), '%no lleva comprobante%');

    perform pg_temp.igual(has_function_privilege('anon', 'public.motos_nota_credito_recuperacion(uuid, text)', 'EXECUTE'), false, 'anon y la nota');
    perform pg_temp.igual(has_function_privilege('authenticated', 'public.motos_nota_credito_recuperacion(uuid, text)', 'EXECUTE'), true, 'authenticated y la nota');
    insert into nc_resultado values ('F guardas', null);
  exception when others then
    insert into nc_resultado values ('F guardas', sqlerrm);
  end;
end $$;

do $$
declare f text;
begin
  select string_agg(caso || ': ' || error, ' | ' order by caso) into f from nc_resultado where error is not null;
  if f is not null then raise exception 'FALLAN: %', f; end if;
  if (select count(*) from nc_resultado) <> 6 then raise exception 'corrieron % casos de 6', (select count(*) from nc_resultado); end if;
end $$;

select 'ok';
