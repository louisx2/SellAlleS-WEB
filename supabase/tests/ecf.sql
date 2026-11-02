-- Pruebas de la facturación electrónica (e-CF con MSeller). NO es una
-- migración: se corre contra producción dentro de una transacción que se
-- revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261030120000_ecf_esquema.sql> <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`; si una aserción falla, la llamada
-- devuelve el error con su mensaje. Antes de que exista la parte de la
-- migración que se prueba se corre solo `begin; <este archivo> rollback;` para
-- ver las pruebas en rojo. Cada sección deja explícito el estado que necesita
-- (rol, claims), usa UUID fijos (…ecXX) en la empresa demo y no depende de las
-- demás. Cada tarea de base amplía este archivo con su propia sección.
--
-- Las pruebas corren como `postgres` (que se salta la RLS); las secciones de
-- permisos cambian a `authenticated` con `set local role` para probar de
-- verdad las políticas y los `grant`.

select set_config('request.jwt.claims', '{"sub":"92381752-13b2-4f43-8b09-612647754599","role":"authenticated"}', true);

-- Comprueba que una sentencia falla con el mensaje esperado (sus efectos se
-- revierten con el subbloque).
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

-- Cambia el usuario de las llamadas siguientes.
create function pg_temp.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- Venta pagada, sin cliente ni NCF. Con p_branch null queda sin sucursal.
create function pg_temp.venta(p_id uuid, p_company uuid, p_branch uuid) returns void
language sql as $$
  insert into sales (id, company_id, branch_id, subtotal, itbis_amount, total,
                     payment_method, payment_status, amount_paid)
  values (p_id, p_company, p_branch, 100, 0, 100, 'transfer', 'paid', 100);
$$;

-- == Task 1: esquema base, módulo y RLS ==
-- Estado explícito de la sección: super admin de la demo (que es del equipo de
-- la plataforma); la demo formalizada y sin módulo `ecf` ni `ecf_config`.
update companies set is_formalized = true where id = '00000000-0000-0000-0000-0000000000aa';
delete from company_modules where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';

-- ecf_activa: hacen falta las cuatro cosas a la vez.
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ecf_activa: sin módulo ni configuración debía ser false (y no null), dio %',
      ecf_activa('00000000-0000-0000-0000-0000000000aa');
  end if;
  if ecf_activa(gen_random_uuid()) is distinct from false then
    raise exception 'ecf_activa: una empresa que no existe debía dar false (y no null)';
  end if;
end $t$;

-- Solo con el módulo encendido, sin configuración.
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'ecf', true);
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ecf_activa: con módulo pero sin ecf_config debía ser false';
  end if;
end $t$;

-- Con módulo y configuración en preparación.
insert into ecf_config (company_id, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-0000000000aa', '101010101', 'Demo SRL', 'Calle 1, Santo Domingo');
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ecf_activa: con módulo pero estado = preparacion debía ser false';
  end if;
end $t$;

-- Activa y formalizada, pero con el módulo apagado.
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';
update company_modules set enabled = false
 where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ecf_activa: con el módulo apagado debía ser false';
  end if;
end $t$;

-- Módulo y estado activa, pero la empresa no está formalizada.
update company_modules set enabled = true
 where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
update companies set is_formalized = false where id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ecf_activa: con is_formalized = false debía ser false';
  end if;
end $t$;

-- Las tres condiciones: ahora sí.
update companies set is_formalized = true where id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'ecf_activa: con módulo, formalizada y activa debía ser true';
  end if;
end $t$;

-- Suspendida deja de estar activa.
update ecf_config set estado = 'suspendida' where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ecf_activa: suspendida debía ser false';
  end if;
end $t$;

-- ecf_config: valores por omisión y reglas de cada columna. La fila de la demo
-- se creó con solo lo obligatorio, así que los defaults se ven en ella.
do $t$
declare c ecf_config;
begin
  select * into c from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
  if (c.ambiente, c.plan, c.cupo_comprobantes, c.cupo_requests, c.minutos_entre_consultas)
     is distinct from ('TesteCF', 'gratis', 250, 1000, 60) then
    raise exception 'ecf_config: defaults inesperados: % % % % %',
      c.ambiente, c.plan, c.cupo_comprobantes, c.cupo_requests, c.minutos_entre_consultas;
  end if;
  if c.conexion_probada_at is not null or c.activada_at is not null or c.certificado_vence is not null then
    raise exception 'ecf_config: las fechas de conexión, activación y certificado debían empezar vacías';
  end if;
end $t$;

do $t$
declare e text;
begin
  -- RNC de 9 y cédula de 11 dígitos entran; 8, 10, 12 y con letras o espacios no.
  update ecf_config set rnc_emisor = '12345678901' where company_id = '00000000-0000-0000-0000-0000000000aa';
  update ecf_config set rnc_emisor = '123456789' where company_id = '00000000-0000-0000-0000-0000000000aa';
  foreach e in array array['12345678', '1234567890', '123456789012', '12345678A', ' 123456789'] loop
    perform pg_temp.debe_fallar(
      format($q$update ecf_config set rnc_emisor = %L where company_id = '00000000-0000-0000-0000-0000000000aa'$q$, e),
      '%ecf_config_rnc_emisor_check%');
  end loop;

  foreach e in array array['premium', 'Gratis', ''] loop
    perform pg_temp.debe_fallar(
      format($q$update ecf_config set plan = %L where company_id = '00000000-0000-0000-0000-0000000000aa'$q$, e),
      '%ecf_config_plan_check%');
  end loop;
  foreach e in array array['gratis', 'emprende', 'basico', 'negocio', 'avanzado', 'empresa'] loop
    update ecf_config set plan = e where company_id = '00000000-0000-0000-0000-0000000000aa';
  end loop;

  perform pg_temp.debe_fallar(
    $q$update ecf_config set estado = 'borrador' where company_id = '00000000-0000-0000-0000-0000000000aa'$q$,
    '%ecf_config_estado_check%');
  perform pg_temp.debe_fallar(
    $q$update ecf_config set ambiente = 'produccion' where company_id = '00000000-0000-0000-0000-0000000000aa'$q$,
    '%ecf_config_ambiente_check%');
  foreach e in array array['TesteCF', 'CerteCF', 'eCF'] loop
    update ecf_config set ambiente = e where company_id = '00000000-0000-0000-0000-0000000000aa';
  end loop;

  -- El emisor se identifica con razón social y dirección: no pueden faltar.
  perform pg_temp.debe_fallar(
    $q$update ecf_config set razon_social = null where company_id = '00000000-0000-0000-0000-0000000000aa'$q$,
    '%null value%razon_social%');
  perform pg_temp.debe_fallar(
    $q$update ecf_config set direccion = null where company_id = '00000000-0000-0000-0000-0000000000aa'$q$,
    '%null value%direccion%');
end $t$;

-- updated_at lo pone el trigger, aunque quien actualiza intente fijarlo.
do $t$
declare v timestamptz;
begin
  update ecf_config set updated_at = '2020-01-01', cupo_comprobantes = 500
   where company_id = '00000000-0000-0000-0000-0000000000aa';
  select updated_at into v from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
  if v is distinct from now() then
    raise exception 'ecf_config: el trigger debía poner updated_at = now(), quedó %', v;
  end if;
end $t$;

-- ecf_config, ecf_credenciales y ecf_uso se borran con la empresa.
do $t$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text as tabla, c.confdeltype
      from pg_constraint c
     where c.contype = 'f'
       and c.conrelid in ('public.ecf_config'::regclass, 'public.ecf_credenciales'::regclass, 'public.ecf_uso'::regclass)
       and c.confrelid = 'public.companies'::regclass
  loop
    if r.confdeltype <> 'c' then
      raise exception '% debía borrarse en cascada con la empresa', r.tabla;
    end if;
  end loop;
  if (select count(*) from pg_constraint
       where contype = 'f' and confrelid = 'public.companies'::regclass
         and conrelid in ('public.ecf_config'::regclass, 'public.ecf_credenciales'::regclass, 'public.ecf_uso'::regclass)) <> 3 then
    raise exception 'ecf_config, ecf_credenciales y ecf_uso debían tener una clave foránea a companies cada una';
  end if;
end $t$;

-- ecf_credenciales: una fila por empresa y ambiente, con el correo obligatorio.
do $t$
begin
  insert into ecf_credenciales (company_id, ambiente, email)
  values ('00000000-0000-0000-0000-0000000000aa', 'TesteCF', 'demo-teste@example.com');
  insert into ecf_credenciales (company_id, ambiente, email)
  values ('00000000-0000-0000-0000-0000000000aa', 'CerteCF', 'demo-certe@example.com');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_credenciales (company_id, ambiente, email)
       values ('00000000-0000-0000-0000-0000000000aa', 'TesteCF', 'otro@example.com')$q$,
    '%duplicate key%');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_credenciales (company_id, ambiente, email)
       values ('00000000-0000-0000-0000-0000000000aa', 'eCF', null)$q$,
    '%null value%email%');
end $t$;

-- ncf_sequences: una secuencia electrónica solo puede tener el prefijo de su tipo.
do $t$
declare t record;
begin
  perform pg_temp.debe_fallar(
    $q$insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica)
       values ('00000000-0000-0000-0000-0000000000aa', 'consumer', 'E31', 1, 10, 1, true)$q$,
    '%ncf_sequences_prefijo_e_check%');
  perform pg_temp.debe_fallar(
    $q$insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica)
       values ('00000000-0000-0000-0000-0000000000aa', 'consumer', 'B02', 1, 10, 1, true)$q$,
    '%ncf_sequences_prefijo_e_check%');
  -- Una electrónica sin prefijo tampoco vale (con NULL el check pasaría de largo).
  perform pg_temp.debe_fallar(
    $q$insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica)
       values ('00000000-0000-0000-0000-0000000000aa', 'consumer', null, 1, 10, 1, true)$q$,
    '%ncf_sequences_prefijo_e_check%');
  -- Cambiar a electrónica una B existente también se rechaza.
  insert into ncf_sequences (id, company_id, tipo, prefix, range_from, range_to, current_val)
  values ('00000000-0000-0000-0000-00000000ec10', '00000000-0000-0000-0000-0000000000aa', 'fiscal', 'B01', 1, 10, 1);
  perform pg_temp.debe_fallar(
    $q$update ncf_sequences set electronica = true where id = '00000000-0000-0000-0000-00000000ec10'$q$,
    '%ncf_sequences_prefijo_e_check%');

  -- Las seis combinaciones válidas, y las B de siempre (electronica = false).
  for t in
    select * from (values ('consumer', 'E32'), ('fiscal', 'E31'), ('nota_credito', 'E34'),
                          ('nota_debito', 'E33'), ('regimen_especial', 'E44'), ('gubernamental', 'E45')) v(tipo, prefix)
  loop
    insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica)
    values ('00000000-0000-0000-0000-0000000000aa', t.tipo, t.prefix, 1, 10, 1, true);
  end loop;
  if (select electronica from ncf_sequences where id = '00000000-0000-0000-0000-00000000ec10') is distinct from false then
    raise exception 'ncf_sequences: electronica debía ser false por omisión';
  end if;
end $t$;

-- ecf_documentos: reglas de cada columna, sobre una venta y una nota de crédito.
select pg_temp.venta('00000000-0000-0000-0000-00000000ec01', '00000000-0000-0000-0000-0000000000aa',
                     '00000000-0000-0000-0000-0000000000b1');
insert into credit_notes (id, company_id, branch_id, sale_id, subtotal, itbis_amount, total)
values ('00000000-0000-0000-0000-00000000ec02', '00000000-0000-0000-0000-0000000000aa',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000ec01', 10, 0, 10);

do $t$
declare d ecf_documentos;
begin
  insert into ecf_documentos (id, company_id, branch_id, sale_id, tipo_ecf, encf, ambiente)
  values ('00000000-0000-0000-0000-00000000ec20', '00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000ec01',
          32, 'E320000000001', 'TesteCF');
  select * into d from ecf_documentos where id = '00000000-0000-0000-0000-00000000ec20';
  if (d.estado, d.intentos, d.mensajes_dgii) is distinct from ('por_enviar', 0, '[]'::jsonb) then
    raise exception 'ecf_documentos: defaults inesperados: % % %', d.estado, d.intentos, d.mensajes_dgii;
  end if;
  if d.proximo_intento_at is null or d.created_at is null or d.updated_at is null then
    raise exception 'ecf_documentos: proximo_intento_at, created_at y updated_at debían tener valor por omisión';
  end if;
  if d.reservado_hasta is not null or d.reemplazado_por is not null or d.credit_note_id is not null then
    raise exception 'ecf_documentos: reservado_hasta, reemplazado_por y credit_note_id debían empezar vacíos';
  end if;
end $t$;

-- El mismo e-NCF dos veces en la misma empresa.
do $t$
begin
  perform pg_temp.debe_fallar(
    $q$insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente)
       values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec01', 32, 'E320000000001', 'TesteCF')$q$,
    '%duplicate key%');
end $t$;

-- El e-NCF es la E y 12 dígitos: 12 caracteres, minúscula o con letras no valen.
do $t$
declare e text;
begin
  foreach e in array array['E32000000001', 'E3200000000011', 'e320000000002', 'B0200000001', 'E32000000000A', ''] loop
    perform pg_temp.debe_fallar(
      format($q$insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente)
                values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec01', 32, %L, 'TesteCF')$q$, e),
      '%ecf_documentos_encf_check%');
  end loop;
end $t$;

-- tipo_ecf y estado salen de listas cerradas.
do $t$
declare x int; e text;
begin
  foreach x in array array[0, 30, 35, 41, 43, 46, 99] loop
    perform pg_temp.debe_fallar(
      format($q$insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente)
                values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec01', %s, 'E320000000003', 'TesteCF')$q$, x),
      '%ecf_documentos_tipo_ecf_check%');
  end loop;
  foreach x in array array[31, 32, 33, 34, 44, 45] loop
    insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente)
    values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec01', x,
            'E' || x::text || '0000000100', 'TesteCF');
  end loop;

  perform pg_temp.debe_fallar(
    $q$insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente, estado)
       values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec01', 32, 'E320000000004', 'TesteCF', 'pendiente')$q$,
    '%ecf_documentos_estado_check%');
  foreach e in array array['por_enviar', 'enviando', 'recibido', 'aceptado', 'aceptado_condicional',
                           'rechazado', 'error_datos', 'sin_cupo'] loop
    update ecf_documentos set estado = e where id = '00000000-0000-0000-0000-00000000ec20';
  end loop;
end $t$;

-- Cada documento pertenece a una venta o a una nota de crédito, no a las dos ni a ninguna.
do $t$
begin
  perform pg_temp.debe_fallar(
    $q$insert into ecf_documentos (company_id, tipo_ecf, encf, ambiente)
       values ('00000000-0000-0000-0000-0000000000aa', 32, 'E320000000005', 'TesteCF')$q$,
    '%ecf_documentos_origen_check%');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_documentos (company_id, sale_id, credit_note_id, tipo_ecf, encf, ambiente)
       values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec01',
               '00000000-0000-0000-0000-00000000ec02', 34, 'E340000000005', 'TesteCF')$q$,
    '%ecf_documentos_origen_check%');
  insert into ecf_documentos (id, company_id, credit_note_id, tipo_ecf, encf, ambiente)
  values ('00000000-0000-0000-0000-00000000ec21', '00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-00000000ec02', 34, 'E340000000006', 'TesteCF');
end $t$;

-- Los documentos fiscales no se van con la venta ni con la nota de crédito. La
-- clave foránea de la venta se llama ecf_documentos_sale_id_fkey (la tarea 2
-- la usa para traer el documento junto a la venta desde PostgREST). La venta
-- ec04 no tiene nota de crédito, para que el único que la frene sea el e-CF.
select pg_temp.venta('00000000-0000-0000-0000-00000000ec04', '00000000-0000-0000-0000-0000000000aa',
                     '00000000-0000-0000-0000-0000000000b1');
insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec04', 32, 'E320000000008', 'TesteCF');
do $t$
begin
  perform pg_temp.debe_fallar(
    $q$delete from sales where id = '00000000-0000-0000-0000-00000000ec04'$q$,
    '%ecf_documentos_sale_id_fkey%');
  perform pg_temp.debe_fallar(
    $q$delete from credit_notes where id = '00000000-0000-0000-0000-00000000ec02'$q$,
    '%ecf_documentos_credit_note_id_fkey%');
  if (select count(*) from pg_constraint
       where conname in ('ecf_documentos_sale_id_fkey', 'ecf_documentos_credit_note_id_fkey')
         and conrelid = 'public.ecf_documentos'::regclass and contype = 'f' and confdeltype = 'r') <> 2 then
    raise exception 'ecf_documentos: las claves a sales y credit_notes debían ser on delete restrict';
  end if;
end $t$;

-- Un documento rechazado puede apuntar al que lo reemplaza.
do $t$
begin
  insert into ecf_documentos (id, company_id, sale_id, tipo_ecf, encf, ambiente)
  values ('00000000-0000-0000-0000-00000000ec22', '00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-00000000ec01', 32, 'E320000000007', 'TesteCF');
  update ecf_documentos set estado = 'rechazado', reemplazado_por = '00000000-0000-0000-0000-00000000ec22'
   where id = '00000000-0000-0000-0000-00000000ec20';
  perform pg_temp.debe_fallar(
    $q$update ecf_documentos set reemplazado_por = gen_random_uuid() where id = '00000000-0000-0000-0000-00000000ec20'$q$,
    '%violates foreign key%');
end $t$;

-- Índices: por venta, por nota de crédito y el parcial de los que aún no terminan.
do $t$
declare def text;
begin
  select indexdef into def from pg_indexes
   where schemaname = 'public' and tablename = 'ecf_documentos' and indexname = 'ecf_documentos_sale_id_idx';
  if def is null or def not like '%(sale_id)%' then
    raise exception 'falta el índice de ecf_documentos por sale_id: %', def;
  end if;
  select indexdef into def from pg_indexes
   where schemaname = 'public' and tablename = 'ecf_documentos' and indexname = 'ecf_documentos_credit_note_id_idx';
  if def is null or def not like '%(credit_note_id)%' then
    raise exception 'falta el índice de ecf_documentos por credit_note_id: %', def;
  end if;
  select indexdef into def from pg_indexes
   where schemaname = 'public' and tablename = 'ecf_documentos' and indexname = 'ecf_documentos_pendientes_idx';
  if def is null or def not like '%(estado)%' or def not like '%WHERE%por_enviar%enviando%recibido%'
     or def like '%aceptado%' or def like '%rechazado%' then
    raise exception 'el índice parcial de ecf_documentos debía ser por estado solo para por_enviar, enviando y recibido: %', def;
  end if;
end $t$;

-- ecf_uso: un renglón por empresa y mes, con los contadores en cero.
do $t$
declare u ecf_uso;
begin
  insert into ecf_uso (company_id, periodo) values ('00000000-0000-0000-0000-0000000000aa', '2026-11-01');
  select * into u from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa' and periodo = '2026-11-01';
  if (u.comprobantes, u.requests) is distinct from (0, 0) then
    raise exception 'ecf_uso: los contadores debían empezar en 0, quedaron % y %', u.comprobantes, u.requests;
  end if;
  perform pg_temp.debe_fallar(
    $q$insert into ecf_uso (company_id, periodo) values ('00000000-0000-0000-0000-0000000000aa', '2026-11-01')$q$,
    '%duplicate key%');
  -- El patrón de la tarea 3: sumar con on conflict.
  insert into ecf_uso (company_id, periodo, comprobantes, requests)
  values ('00000000-0000-0000-0000-0000000000aa', '2026-11-01', 1, 2)
  on conflict (company_id, periodo) do update
    set comprobantes = ecf_uso.comprobantes + excluded.comprobantes,
        requests = ecf_uso.requests + excluded.requests;
  select * into u from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa' and periodo = '2026-11-01';
  if (u.comprobantes, u.requests) is distinct from (1, 2) then
    raise exception 'ecf_uso: el on conflict debía sumar, quedó % y %', u.comprobantes, u.requests;
  end if;
end $t$;

-- Columnas nuevas en tablas que ya existían.
do $t$
declare col record;
begin
  select * into col from information_schema.columns
   where table_schema = 'public' and table_name = 'platform_settings' and column_name = 'ncf_b_fecha_corte';
  if col.data_type is distinct from 'date' or col.is_nullable <> 'NO' or col.column_default not like '%2026-11-15%' then
    raise exception 'platform_settings.ncf_b_fecha_corte debía ser date not null default 2026-11-15, es % % %',
      col.data_type, col.is_nullable, col.column_default;
  end if;
  if (select ncf_b_fecha_corte from platform_settings limit 1) is null then
    raise exception 'platform_settings.ncf_b_fecha_corte debía tener valor en la fila existente';
  end if;

  select * into col from information_schema.columns
   where table_schema = 'public' and table_name = 'products' and column_name = 'es_servicio';
  if col.data_type is distinct from 'boolean' or col.is_nullable <> 'NO' or col.column_default <> 'false' then
    raise exception 'products.es_servicio debía ser boolean not null default false, es % % %',
      col.data_type, col.is_nullable, col.column_default;
  end if;
  insert into products (id, company_id, branch_id, name)
  values ('00000000-0000-0000-0000-00000000ec30', '00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-0000000000b1', 'Prueba e-CF');
  if (select es_servicio from products where id = '00000000-0000-0000-0000-00000000ec30') is distinct from false then
    raise exception 'products.es_servicio debía ser false para un producto nuevo';
  end if;
end $t$;

-- Permisos: nada para anon; credenciales cerradas; ecf_documentos y ecf_uso
-- solo se leen; ecf_config la modifica quien pase la RLS (el super admin).
do $t$
declare t text;
begin
  foreach t in array array['ecf_config', 'ecf_credenciales', 'ecf_documentos', 'ecf_uso'] loop
    if has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete') then
      raise exception 'anon no debía tener ningún permiso sobre %', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'RLS apagada en %', t;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.ecf_credenciales', 'select')
     or has_table_privilege('authenticated', 'public.ecf_credenciales', 'insert')
     or has_table_privilege('authenticated', 'public.ecf_credenciales', 'update')
     or has_table_privilege('authenticated', 'public.ecf_credenciales', 'delete') then
    raise exception 'authenticated no debía tener permisos sobre ecf_credenciales';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ecf_credenciales') then
    raise exception 'ecf_credenciales no debía tener ninguna política';
  end if;
  if not (has_table_privilege('service_role', 'public.ecf_credenciales', 'select')
          and has_table_privilege('service_role', 'public.ecf_credenciales', 'insert')
          and has_table_privilege('service_role', 'public.ecf_credenciales', 'update')) then
    raise exception 'service_role debía poder usar ecf_credenciales';
  end if;
  foreach t in array array['ecf_documentos', 'ecf_uso'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception 'authenticated debía poder leer %', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert, update, delete') then
      raise exception 'authenticated no debía poder escribir en %', t;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ecf_documentos' and cmd <> 'SELECT') then
    raise exception 'ecf_documentos solo debía tener política de lectura';
  end if;

  if has_function_privilege('anon', 'public.ecf_activa(uuid)', 'execute') then
    raise exception 'anon no debía poder ejecutar ecf_activa';
  end if;
  if not has_function_privilege('authenticated', 'public.ecf_activa(uuid)', 'execute') then
    raise exception 'authenticated debía poder ejecutar ecf_activa';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.ecf_activa(uuid)'::regprocedure) then
    raise exception 'ecf_activa debía ser security definer';
  end if;
  if exists (select 1 from pg_proc p join pg_trigger g on g.tgfoid = p.oid
              where g.tgrelid = 'public.ecf_config'::regclass and not g.tgisinternal
                and (has_function_privilege('anon', p.oid, 'execute')
                     or has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'la función del trigger de ecf_config no debía ser ejecutable por anon ni authenticated';
  end if;
end $t$;

-- RLS: tres actores sobre dos empresas.
--   * super admin (equipo de la plataforma): ve y cambia todo, menos credenciales.
--   * cc56c633…, admin normal de la empresa b463…: solo lo suyo, y de solo lectura.
-- Datos: configuración, uso, documento y credenciales de la demo ya existen
-- (secciones de arriba); se agregan los de la empresa del admin normal.
do $t$
declare otra uuid := 'b463d8b5-b589-4194-b0c3-2a912b58b7c9';
begin
  insert into ecf_config (company_id, rnc_emisor, razon_social, direccion)
  values (otra, '202020202', 'Otra SRL', 'Calle 2');
  insert into ecf_uso (company_id, periodo) values (otra, '2026-11-01');
  perform pg_temp.venta('00000000-0000-0000-0000-00000000ec03', otra, null);
  insert into ecf_documentos (id, company_id, sale_id, tipo_ecf, encf, ambiente)
  values ('00000000-0000-0000-0000-00000000ec23', otra, '00000000-0000-0000-0000-00000000ec03', 32, 'E320000000001', 'TesteCF');
end $t$;

-- Super admin, ya como `authenticated`.
set local role authenticated;
do $t$
declare otra uuid := 'b463d8b5-b589-4194-b0c3-2a912b58b7c9';
begin
  if (select count(*) from ecf_config where company_id in ('00000000-0000-0000-0000-0000000000aa', otra)) <> 2 then
    raise exception 'RLS: el super admin debía ver la ecf_config de las dos empresas';
  end if;
  if (select count(*) from ecf_uso where company_id in ('00000000-0000-0000-0000-0000000000aa', otra)) <> 2 then
    raise exception 'RLS: el super admin debía ver el uso de las dos empresas';
  end if;
  if (select count(*) from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa') < 4 then
    raise exception 'RLS: el super admin debía ver los documentos de la demo (ventas y notas de crédito)';
  end if;
  if (select count(*) from ecf_documentos where company_id = otra) <> 1 then
    raise exception 'RLS: el super admin debía ver el documento de la otra empresa';
  end if;
  -- Puede escribir en ecf_config, no en el resto.
  update ecf_config set nombre_comercial = 'Demo' where company_id = '00000000-0000-0000-0000-0000000000aa';
  if (select nombre_comercial from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa') is distinct from 'Demo' then
    raise exception 'RLS: el super admin debía poder actualizar ecf_config';
  end if;
  perform pg_temp.debe_fallar($q$select * from ecf_credenciales$q$, '%permission denied%');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente)
       values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec01', 32, 'E320000000099', 'TesteCF')$q$,
    '%permission denied%');
  perform pg_temp.debe_fallar(
    $q$update ecf_documentos set estado = 'aceptado' where id = '00000000-0000-0000-0000-00000000ec20'$q$,
    '%permission denied%');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_uso (company_id, periodo) values ('00000000-0000-0000-0000-0000000000aa', '2026-12-01')$q$,
    '%permission denied%');
end $t$;
reset role;

-- Admin normal de otra empresa.
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
set local role authenticated;
do $t$
declare otra uuid := 'b463d8b5-b589-4194-b0c3-2a912b58b7c9';
begin
  -- Con la demo: nada.
  if (select count(*) from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa') <> 0 then
    raise exception 'RLS: un admin de otra empresa no debía ver la ecf_config de la demo';
  end if;
  if (select count(*) from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa') <> 0 then
    raise exception 'RLS: un admin de otra empresa no debía ver los documentos de la demo';
  end if;
  if (select count(*) from ecf_uso) <> 0 then
    raise exception 'RLS: ecf_uso es solo del super admin, el admin normal vio filas';
  end if;
  perform pg_temp.debe_fallar($q$select * from ecf_credenciales$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select email from ecf_credenciales$q$, '%permission denied%');

  -- Con lo suyo: lee, no escribe.
  if (select count(*) from ecf_config where company_id = otra) <> 1 then
    raise exception 'RLS: el admin debía ver la ecf_config de su empresa';
  end if;
  if (select count(*) from ecf_documentos where company_id = otra) <> 1 then
    raise exception 'RLS: el admin debía ver el documento de la venta de su empresa';
  end if;
  update ecf_config set estado = 'activa', plan = 'empresa' where company_id = otra;
  if (select estado from ecf_config where company_id = otra) <> 'preparacion' then
    raise exception 'RLS: el admin normal no debía poder cambiar su ecf_config';
  end if;
  delete from ecf_config where company_id = otra;
  if (select count(*) from ecf_config where company_id = otra) <> 1 then
    raise exception 'RLS: el admin normal no debía poder borrar su ecf_config';
  end if;
  perform pg_temp.debe_fallar(
    $q$insert into ecf_config (company_id, rnc_emisor, razon_social, direccion)
       values ('00000000-0000-0000-0000-0000000000aa', '303030303', 'Intento', 'Calle 3')$q$,
    '%row-level security%');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente)
       values ('b463d8b5-b589-4194-b0c3-2a912b58b7c9', '00000000-0000-0000-0000-00000000ec03', 32, 'E320000000098', 'TesteCF')$q$,
    '%permission denied%');

  -- ecf_activa se puede preguntar: da solo un booleano.
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ecf_activa: la demo está suspendida, debía dar false';
  end if;
end $t$;
reset role;

-- Vuelve el super admin: nada de lo anterior debió cambiar los datos.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
do $t$
begin
  if (select estado from ecf_config where company_id = 'b463d8b5-b589-4194-b0c3-2a912b58b7c9') <> 'preparacion' then
    raise exception 'la ecf_config de la otra empresa cambió pese a la RLS';
  end if;
end $t$;

select 'ok';
