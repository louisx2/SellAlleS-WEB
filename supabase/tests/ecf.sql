-- Pruebas de la facturación electrónica (e-CF con MSeller). NO es una
-- migración: se corre contra producción dentro de una transacción que se
-- revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261030120000_ecf_esquema.sql>
--          <supabase/migrations/20261030130000_ecf_asignacion.sql>
--          <supabase/migrations/20261030140000_ecf_anulacion_reemision.sql>
--          <este archivo> rollback;
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

-- == Task 2: e-NCF al guardar la venta, corte de la serie B y bandeja de salida ==
-- Venta de la demo (sucursal b1 salvo que se diga otra) con lo que decide el NCF.
create function pg_temp.venta_ncf(p_id uuid, p_requested boolean, p_type text default 'consumer',
                                  p_created timestamptz default now(),
                                  p_branch uuid default '00000000-0000-0000-0000-0000000000b1') returns void
language sql as $$
  insert into sales (id, company_id, branch_id, subtotal, itbis_amount, total, payment_method,
                     payment_status, amount_paid, ncf_requested, ncf_type, created_at)
  values (p_id, '00000000-0000-0000-0000-0000000000aa', p_branch, 100, 0, 100, 'transfer', 'paid', 100,
          p_requested, p_type::ncf_type, p_created);
$$;

-- Secuencia de la demo; arranca en p_desde.
create function pg_temp.secuencia(p_tipo text, p_prefix text, p_electronica boolean,
                                  p_desde bigint default 1, p_hasta bigint default 100) returns void
language sql as $$
  insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica)
  values ('00000000-0000-0000-0000-0000000000aa', p_tipo, p_prefix, p_desde, p_hasta, p_desde, p_electronica);
$$;

-- Próximo número de la secuencia de la demo con ese prefijo.
create function pg_temp.sig(p_prefix text) returns bigint language sql as $$
  select current_val from ncf_sequences
   where company_id = '00000000-0000-0000-0000-0000000000aa' and prefix = p_prefix
$$;

create function pg_temp.ncf_de(p_sale uuid) returns text language sql as $$
  select ncf from sales where id = p_sale
$$;

create function pg_temp.docs_de(p_sale uuid) returns bigint language sql as $$
  select count(*) from ecf_documentos where sale_id = p_sale
$$;

-- Estado explícito de la sección: super admin; la demo formalizada y con
-- ncf_enabled; módulo `ecf` encendido y ecf_config activa; sin documentos ni
-- secuencias propias; serie B vigente (corte dentro de 30 días); y las
-- secuencias que hacen falta, con las B a la vista para ver que no se tocan.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
update companies set is_formalized = true, ncf_enabled = true where id = '00000000-0000-0000-0000-0000000000aa';
update branches set rnc = null where id = '00000000-0000-0000-0000-0000000000b1';
delete from company_modules where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'ecf', true);
delete from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
insert into ecf_config (company_id, estado, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-0000000000aa', 'activa', '101010101', 'Demo SRL', 'Calle 1, Santo Domingo');
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ncf_sequences where company_id = '00000000-0000-0000-0000-0000000000aa';
update platform_settings set ncf_b_fecha_corte = company_today('00000000-0000-0000-0000-0000000000aa') + 30;
select pg_temp.secuencia('consumer', 'E32', true);
select pg_temp.secuencia('fiscal', 'E31', true);
select pg_temp.secuencia('consumer', 'B02', false, 5, 100);
select pg_temp.secuencia('fiscal', 'B01', false);

do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'Task 2: el estado de partida debía tener e-CF activo en la demo';
  end if;
end $t$;

-- Con e-CF activo la venta recibe un E32 aunque no lo pida: 13 caracteres, y
-- su documento queda por enviar. Las B de la demo no se tocan.
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec40', false);
do $t$
declare s sales; d ecf_documentos;
begin
  select * into s from sales where id = '00000000-0000-0000-0000-00000000ec40';
  if s.ncf is distinct from 'E320000000001' or length(s.ncf) <> 13 then
    raise exception 'e-CF: la venta debía quedar con E320000000001 (13 caracteres), quedó %', s.ncf;
  end if;
  if s.ncf_requested is distinct from true then
    raise exception 'e-CF: set_sale_ncf debía marcar ncf_requested = true';
  end if;
  if pg_temp.docs_de(s.id) <> 1 then
    raise exception 'e-CF: la venta debía tener exactamente un documento, tiene %', pg_temp.docs_de(s.id);
  end if;
  select * into d from ecf_documentos where sale_id = s.id;
  if (d.company_id, d.branch_id, d.tipo_ecf, d.encf, d.ambiente, d.estado)
     is distinct from ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid,
                       32::smallint, 'E320000000001', 'TesteCF', 'por_enviar') then
    raise exception 'e-CF: documento inesperado: % % % % % %',
      d.company_id, d.branch_id, d.tipo_ecf, d.encf, d.ambiente, d.estado;
  end if;
  if (pg_temp.sig('E32'), pg_temp.sig('B02'), pg_temp.sig('B01')) is distinct from (2::bigint, 5::bigint, 1::bigint) then
    raise exception 'e-CF: E32 debía quedar en 2 y las B sin tocar (5 y 1), quedaron % % %',
      pg_temp.sig('E32'), pg_temp.sig('B02'), pg_temp.sig('B01');
  end if;
end $t$;

-- Crédito fiscal: E31, de su propia secuencia.
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec41', false, 'fiscal');
do $t$
declare d ecf_documentos;
begin
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec41') is distinct from 'E310000000001' then
    raise exception 'e-CF: la venta fiscal debía quedar con E310000000001, quedó %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec41');
  end if;
  select * into d from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec41';
  if (d.tipo_ecf, d.encf, d.estado) is distinct from (31::smallint, 'E310000000001', 'por_enviar') then
    raise exception 'e-CF: documento fiscal inesperado: % % %', d.tipo_ecf, d.encf, d.estado;
  end if;
  if (pg_temp.sig('E31'), pg_temp.sig('E32'), pg_temp.sig('B01'), pg_temp.sig('B02'))
     is distinct from (2::bigint, 2::bigint, 1::bigint, 5::bigint) then
    raise exception 'e-CF: la venta fiscal solo debía gastar un número de E31';
  end if;
end $t$;

-- El documento lleva el ambiente de ecf_config.
update ecf_config set ambiente = 'CerteCF' where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec42', false);
update ecf_config set ambiente = 'TesteCF' where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if (select ambiente from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec42') is distinct from 'CerteCF' then
    raise exception 'e-CF: el documento debía llevar el ambiente de ecf_config (CerteCF)';
  end if;
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec42') is distinct from 'E320000000002' then
    raise exception 'e-CF: la segunda venta debía quedar con E320000000002, quedó %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec42');
  end if;
end $t$;

-- Con e-CF activo se emite e-NCF aunque la empresa no tenga ncf_enabled.
update companies set ncf_enabled = false where id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec43', false);
update companies set ncf_enabled = true where id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec43') is distinct from 'E320000000003'
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec43') <> 1 then
    raise exception 'e-CF: con ecf_activa y sin ncf_enabled debía emitir E320000000003 con su documento, dio %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec43');
  end if;
end $t$;

-- Sin secuencia E que sirva, la venta falla: no hay secuencia, o está
-- inactiva, agotada o vencida. Las B01/B02 que sí existen no la reemplazan.
do $t$
declare v text;
begin
  delete from ncf_sequences
   where company_id = '00000000-0000-0000-0000-0000000000aa' and prefix = 'E31';
  perform pg_temp.debe_fallar(
    $q$select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec44', false, 'fiscal')$q$,
    'No hay una secuencia de e-CF (E31) activa con números disponibles. Agrégala en Perfil → Facturación fiscal.');
  perform pg_temp.debe_fallar(
    $q$select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec44', false, 'gubernamental')$q$,
    'No hay una secuencia de e-CF (E45)%');
  perform pg_temp.debe_fallar(
    $q$select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec44', false, 'regimen_especial')$q$,
    'No hay una secuencia de e-CF (E44)%');

  foreach v in array array['active = false', 'current_val = range_to + 1', 'expires_at = company_today(company_id) - 1'] loop
    perform pg_temp.secuencia('fiscal', 'E31', true);
    execute format('update ncf_sequences set %s where company_id = %L and prefix = %L',
                   v, '00000000-0000-0000-0000-0000000000aa', 'E31');
    perform pg_temp.debe_fallar(
      $q$select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec44', false, 'fiscal')$q$,
      'No hay una secuencia de e-CF (E31)%');
    delete from ncf_sequences
     where company_id = '00000000-0000-0000-0000-0000000000aa' and prefix = 'E31';
  end loop;

  if exists (select 1 from sales where id = '00000000-0000-0000-0000-00000000ec44') then
    raise exception 'e-CF: la venta sin secuencia no debía guardarse';
  end if;
  if (pg_temp.sig('B01'), pg_temp.sig('B02')) is distinct from (1::bigint, 5::bigint) then
    raise exception 'e-CF: las B no debían usarse de reemplazo de la E que falta';
  end if;
end $t$;

-- Sucursal con otro RNC que el de la empresa: no emite, y no gasta el número.
do $t$
declare antes bigint; r record;
begin
  update branches set rnc = '101010101' where id = '00000000-0000-0000-0000-0000000000b1';
  update ecf_config set rnc_emisor = '130000001' where company_id = '00000000-0000-0000-0000-0000000000aa';
  antes := pg_temp.sig('E32');

  perform pg_temp.debe_fallar(
    $q$select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec47', false)$q$,
    'Esta sucursal tiene un RNC distinto al de la empresa; no puede emitir e-CF con el de la empresa.');
  if pg_temp.sig('E32') <> antes or exists (select 1 from sales where id = '00000000-0000-0000-0000-00000000ec47') then
    raise exception 'e-CF: con RNC distinto no debía guardarse la venta ni gastarse un número';
  end if;

  -- Una venta de días anteriores no pide comprobante: no hay nada que comparar.
  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec48', false, 'consumer', now() - interval '3 days');
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec48') is not null or pg_temp.sig('E32') <> antes then
    raise exception 'e-CF: la venta de días anteriores no debía recibir número';
  end if;

  -- Una venta sin sucursal no tiene RNC que comparar.
  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec49', false, 'consumer', now(), null);
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec49') is distinct from 'E32' || lpad(antes::text, 10, '0')
     or (select branch_id from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec49') is not null then
    raise exception 'e-CF: la venta sin sucursal debía emitir con su documento sin sucursal, dio %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec49');
  end if;

  -- El RNC de la sucursal es texto libre: igual al de la empresa (con o sin
  -- guiones y espacios) o vacío, emite.
  update ecf_config set rnc_emisor = '101010101' where company_id = '00000000-0000-0000-0000-0000000000aa';
  for r in
    select * from (values
      ('00000000-0000-0000-0000-00000000ec4a'::uuid, '101010101'),
      ('00000000-0000-0000-0000-00000000ec4b'::uuid, '1-01-01010-1'),
      ('00000000-0000-0000-0000-00000000ec4c'::uuid, ' 101 010 101 '),
      ('00000000-0000-0000-0000-00000000ec4d'::uuid, ''),
      ('00000000-0000-0000-0000-00000000ec4e'::uuid, '   ')
    ) v(id, rnc)
  loop
    update branches set rnc = r.rnc where id = '00000000-0000-0000-0000-0000000000b1';
    perform pg_temp.venta_ncf(r.id, false);
    if pg_temp.ncf_de(r.id) is null or pg_temp.docs_de(r.id) <> 1 then
      raise exception 'e-CF: con el RNC de sucursal "%" igual o vacío debía emitir', r.rnc;
    end if;
  end loop;
  update branches set rnc = null where id = '00000000-0000-0000-0000-0000000000b1';
end $t$;

-- Una venta de días anteriores (cargada después) no pide comprobante: queda
-- sin NCF y sin documento.
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec55', false, 'consumer', now() - interval '3 days');
do $t$
declare s sales;
begin
  select * into s from sales where id = '00000000-0000-0000-0000-00000000ec55';
  if s.ncf is not null or s.ncf_requested is distinct from false or pg_temp.docs_de(s.id) <> 0 then
    raise exception 'e-CF: la venta de hace 3 días debía quedar sin NCF y sin documento, dio % % %',
      s.ncf, s.ncf_requested, pg_temp.docs_de(s.id);
  end if;
end $t$;

-- La fecha de corte solo afecta a la serie B: con e-CF activo se sigue emitiendo.
update platform_settings set ncf_b_fecha_corte = company_today('00000000-0000-0000-0000-0000000000aa') - 1;
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec56', false);
update platform_settings set ncf_b_fecha_corte = company_today('00000000-0000-0000-0000-0000000000aa') + 30;
do $t$
begin
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec56') !~ '^E32\d{10}$'
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec56') <> 1 then
    raise exception 'e-CF: con el corte vencido y e-CF activo debía emitir un E32, dio %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec56');
  end if;
end $t$;

-- Una venta que ya trae NCF no se toca. Si es un e-NCF entra a la bandeja
-- (tipo_ecf sale de sus dos dígitos); una B no.
insert into sales (id, company_id, branch_id, subtotal, itbis_amount, total, payment_method, payment_status, amount_paid, ncf)
values ('00000000-0000-0000-0000-00000000ec57', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
        100, 0, 100, 'transfer', 'paid', 100, 'B0100000009'),
       ('00000000-0000-0000-0000-00000000ec58', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
        100, 0, 100, 'transfer', 'paid', 100, 'E450000000007');
do $t$
declare d ecf_documentos;
begin
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec57') is distinct from 'B0100000009'
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec57') <> 0 then
    raise exception 'e-CF: una venta con B ya asignada debía quedar igual y sin documento';
  end if;
  select * into d from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec58';
  if (d.tipo_ecf, d.encf, d.estado) is distinct from (45::smallint, 'E450000000007', 'por_enviar') then
    raise exception 'e-CF: una venta con E450000000007 debía crear su documento tipo 45, dio % % %',
      d.tipo_ecf, d.encf, d.estado;
  end if;
end $t$;

-- La bandeja la llena el servidor: la venta de un usuario con rol `authenticated`
-- (que solo puede leer ecf_documentos) también crea su documento.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
declare d ecf_documentos;
begin
  insert into sales (id, company_id, branch_id, subtotal, itbis_amount, total, payment_method, payment_status, amount_paid)
  values ('00000000-0000-0000-0000-00000000ec60', '00000000-0000-0000-0000-0000000000aa',
          '00000000-0000-0000-0000-0000000000b1', 100, 0, 100, 'transfer', 'paid', 100);
  select * into d from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec60';
  if d.id is null then
    raise exception 'e-CF: la venta hecha como authenticated debía crear su documento';
  end if;
  if d.encf is distinct from (select ncf from sales where id = '00000000-0000-0000-0000-00000000ec60')
     or d.encf !~ '^E32\d{10}$' or d.estado <> 'por_enviar' then
    raise exception 'e-CF: documento de la venta como authenticated inesperado: % %', d.encf, d.estado;
  end if;
end $t$;
reset role;

-- ncf_b_vigente: verdadera hasta el día anterior al corte, según el día local de
-- la empresa. Un usuario autenticado la puede consultar.
update platform_settings set ncf_b_fecha_corte = company_today('00000000-0000-0000-0000-0000000000aa') + 1;
set local role authenticated;
do $t$
begin
  if ncf_b_vigente('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'ncf_b_vigente: con el corte mañana debía ser true para un usuario autenticado';
  end if;
end $t$;
reset role;
do $t$
declare hoy date := company_today('00000000-0000-0000-0000-0000000000aa');
begin
  update platform_settings set ncf_b_fecha_corte = hoy;
  if ncf_b_vigente('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ncf_b_vigente: el día del corte ya no es válida la B';
  end if;
  update platform_settings set ncf_b_fecha_corte = hoy - 1;
  if ncf_b_vigente('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'ncf_b_vigente: con el corte ayer debía ser false';
  end if;
  update platform_settings set ncf_b_fecha_corte = hoy + 30;
  if ncf_b_vigente('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'ncf_b_vigente: con el corte dentro de 30 días debía ser true';
  end if;
end $t$;

-- Permisos de las funciones: las nuevas cerradas a anon; la bandeja, solo del
-- servidor; assign_ncf y set_sale_ncf siguen sin ser llamables desde la API.
do $t$
begin
  if has_function_privilege('anon', 'public.ncf_b_vigente(uuid)', 'execute') then
    raise exception 'anon no debía poder ejecutar ncf_b_vigente';
  end if;
  if not has_function_privilege('authenticated', 'public.ncf_b_vigente(uuid)', 'execute') then
    raise exception 'authenticated debía poder ejecutar ncf_b_vigente';
  end if;
  if not (select prosecdef and provolatile = 's' from pg_proc where oid = 'public.ncf_b_vigente(uuid)'::regprocedure) then
    raise exception 'ncf_b_vigente debía ser stable y security definer';
  end if;
  if has_function_privilege('anon', 'public.ecf_encolar_venta()', 'execute')
     or has_function_privilege('authenticated', 'public.ecf_encolar_venta()', 'execute') then
    raise exception 'ecf_encolar_venta no debía ser ejecutable por anon ni authenticated';
  end if;
  if not coalesce((select prosecdef and proconfig @> array['search_path=public']
                     from pg_proc where oid = 'public.ecf_encolar_venta()'::regprocedure), false) then
    raise exception 'ecf_encolar_venta debía ser security definer con search_path = public';
  end if;
  if has_function_privilege('anon', 'public.assign_ncf(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.assign_ncf(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.set_sale_ncf()', 'execute')
     or has_function_privilege('authenticated', 'public.set_sale_ncf()', 'execute') then
    raise exception 'assign_ncf y set_sale_ncf no debían ser ejecutables por anon ni authenticated';
  end if;
  if not (select bool_and(prosecdef) from pg_proc
           where oid in ('public.assign_ncf(uuid,text)'::regprocedure, 'public.set_sale_ncf()'::regprocedure)) then
    raise exception 'assign_ncf y set_sale_ncf debían seguir siendo security definer';
  end if;
end $t$;

-- Sin e-CF (ecf_config suspendida) todo sigue como hoy: solo las B, con 8
-- dígitos. Las E (aquí una E32 y una E31) ni se usan ni cuentan. La E32 arranca
-- en 500 para no repetir un e-NCF que ya tiene documento en la bandeja.
update ecf_config set estado = 'suspendida' where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ncf_sequences where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.secuencia('consumer', 'E32', true, 500, 600);
select pg_temp.secuencia('consumer', 'B02', false);
update platform_settings set ncf_b_fecha_corte = company_today('00000000-0000-0000-0000-0000000000aa') + 30;
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'Task 2: el estado de partida debía tener e-CF inactivo en la demo';
  end if;

  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec70', true);
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec70') is distinct from 'B0200000001'
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec70') <> 0
     or pg_temp.sig('E32') <> 500 then
    raise exception 'B: la venta con ncf_requested debía quedar con B0200000001, sin documento y sin gastar la E32; dio %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec70');
  end if;

  -- Sin pedir comprobante, sin NCF (como hoy).
  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec71', false);
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec71') is not null then
    raise exception 'B: la venta sin ncf_requested no debía recibir NCF';
  end if;

  -- El RNC de la sucursal solo importa para el e-CF.
  update branches set rnc = '101010101' where id = '00000000-0000-0000-0000-0000000000b1';
  update ecf_config set rnc_emisor = '130000001' where company_id = '00000000-0000-0000-0000-0000000000aa';
  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec72', true);
  update branches set rnc = null where id = '00000000-0000-0000-0000-0000000000b1';
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec72') is distinct from 'B0200000002' then
    raise exception 'B: un RNC de sucursal distinto no debía frenar la serie B, dio %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec72');
  end if;

  -- Una E31 no hace de B01; y como solo cuentan las B, no hay B01 registrada.
  perform pg_temp.secuencia('fiscal', 'E31', true);
  perform pg_temp.debe_fallar(
    $q$select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec73', true, 'fiscal')$q$,
    'No hay secuencia de Crédito Fiscal (B01) registrada%');
  if pg_temp.sig('E31') <> 1 then
    raise exception 'B: la E31 no debía usarse en lugar de la B01';
  end if;
  if ncf_b_vigente('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'B: con el corte dentro de 30 días ncf_b_vigente debía ser true';
  end if;
end $t$;

-- Empresa que no emite comprobantes y sin e-CF: sin NCF, igual que hoy.
update companies set ncf_enabled = false where id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec79', true);
update companies set ncf_enabled = true where id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec79') is not null
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec79') <> 0
     or pg_temp.sig('B02') <> 3 then
    raise exception 'sin ncf_enabled y sin e-CF: la venta debía quedar sin NCF, sin documento y sin gastar la B02';
  end if;
end $t$;

-- Corte de la serie B: desde el día de corte (inclusive) ya no se emite B.
do $t$
declare hoy date := company_today('00000000-0000-0000-0000-0000000000aa'); corte date;
begin
  foreach corte in array array[hoy - 1, hoy] loop
    update platform_settings set ncf_b_fecha_corte = corte;
    perform pg_temp.debe_fallar(
      $q$select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec74', true)$q$,
      format('La serie B dejó de ser válida el %s. Para emitir comprobantes hay que activar la facturación electrónica.',
             to_char(corte, 'DD/MM/YYYY')));
    if ncf_b_vigente('00000000-0000-0000-0000-0000000000aa') is distinct from false then
      raise exception 'ncf_b_vigente: con el corte en % debía ser false', corte;
    end if;
  end loop;
  if exists (select 1 from sales where id = '00000000-0000-0000-0000-00000000ec74') or pg_temp.sig('B02') <> 3 then
    raise exception 'corte B: la venta rechazada no debía guardarse ni gastar un número';
  end if;

  -- Una venta que no pide comprobante no se afecta.
  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec76', false);
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec76') is not null then
    raise exception 'corte B: la venta sin ncf_requested debía seguir sin NCF';
  end if;

  -- Una empresa que no emite comprobantes tampoco recibe el error: sin NCF.
  update companies set ncf_enabled = false where id = '00000000-0000-0000-0000-0000000000aa';
  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec77', true);
  update companies set ncf_enabled = true where id = '00000000-0000-0000-0000-0000000000aa';
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec77') is not null then
    raise exception 'corte B: sin ncf_enabled debía devolver NCF null, no el error del corte';
  end if;

  -- Con e-CF activo el corte no estorba.
  update ecf_config set estado = 'activa', rnc_emisor = '101010101'
   where company_id = '00000000-0000-0000-0000-0000000000aa';
  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec78', true);
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec78') is distinct from 'E320000000500'
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec78') <> 1 then
    raise exception 'corte B: con e-CF activo debía emitir E320000000500, dio %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec78');
  end if;
  update ecf_config set estado = 'suspendida' where company_id = '00000000-0000-0000-0000-0000000000aa';

  -- Un día antes del corte la B sigue saliendo: B0200000003.
  update platform_settings set ncf_b_fecha_corte = hoy + 1;
  perform pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec75', true);
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec75') is distinct from 'B0200000003'
     or ncf_b_vigente('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'corte B: con el corte mañana la B debía seguir saliendo (B0200000003), dio %',
      pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec75');
  end if;
end $t$;

-- == Task 3: anulación con E34, reemisión y reintento ==
-- Estado explícito de la sección: super admin; la demo formalizada, con
-- ncf_enabled, módulo `ecf` y ecf_config activa en CerteCF; sin documentos ni
-- secuencias propias; serie B vigente (corte dentro de 30 días). Secuencias:
-- E32 desde 7000 (no repite los e-NCF de ventas de secciones anteriores), E34 y
-- B04 desde 1, y una B02. La E34 se crea un día antes que la B04: si la
-- anulación de una venta B no excluyera las secuencias electrónicas, la tomaría.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
update companies set is_formalized = true, ncf_enabled = true where id = '00000000-0000-0000-0000-0000000000aa';
update branches set rnc = null where id = '00000000-0000-0000-0000-0000000000b1';
delete from company_modules where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'ecf', true);
delete from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-0000000000aa', 'activa', 'CerteCF', '101010101', 'Demo SRL', 'Calle 1, Santo Domingo');
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ncf_sequences where company_id = '00000000-0000-0000-0000-0000000000aa';
update platform_settings set ncf_b_fecha_corte = company_today('00000000-0000-0000-0000-0000000000aa') + 30;
select pg_temp.secuencia('nota_credito', 'E34', true);
update ncf_sequences set created_at = now() - interval '1 day'
 where company_id = '00000000-0000-0000-0000-0000000000aa' and prefix = 'E34';
select pg_temp.secuencia('consumer', 'E32', true, 7000, 7100);
select pg_temp.secuencia('nota_credito', 'B04', false);
select pg_temp.secuencia('consumer', 'B02', false, 200, 300);

-- Venta con e-NCF (E32) y su documento en el estado dado.
create function pg_temp.venta_e(p_id uuid, p_estado text) returns void language plpgsql as $$
begin
  perform pg_temp.venta_ncf(p_id, false);
  update ecf_documentos set estado = p_estado where sale_id = p_id;
end $$;

-- Venta con una B ya asignada (de antes de activar el e-CF): sin documento.
create function pg_temp.venta_b(p_id uuid, p_ncf text) returns void language sql as $$
  insert into sales (id, company_id, branch_id, subtotal, itbis_amount, total, payment_method,
                     payment_status, amount_paid, ncf)
  values (p_id, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
          100, 0, 100, 'transfer', 'paid', 100, p_ncf);
$$;

-- Id del documento vigente de la venta. Security definer para poder pedirlo
-- también bajo `authenticated`, sin depender de la RLS.
create function pg_temp.doc_vigente(p_sale uuid) returns uuid language sql security definer as $$
  select id from ecf_documentos where sale_id = p_sale and reemplazado_por is null
   order by created_at desc limit 1
$$;

-- Cajero o administrador de la demo: usa el perfil cc56c633… (admin de otra
-- empresa) agregándole una membresía en la demo con ese rol y cambiando su
-- empresa activa. Deja los claims de esa persona; melany_fuera_de_demo() deshace
-- todo y devuelve los del super admin.
create function pg_temp.melany_en_demo(p_rol text) returns void language plpgsql as $$
begin
  perform pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
  delete from profile_companies
   where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and company_id = '00000000-0000-0000-0000-0000000000aa';
  insert into profile_companies (profile_id, company_id, role)
  values ('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566', '00000000-0000-0000-0000-0000000000aa', p_rol::user_role);
  update profiles set company_id = '00000000-0000-0000-0000-0000000000aa'
   where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
  perform pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
end $$;

create function pg_temp.melany_fuera_de_demo() returns void language plpgsql as $$
begin
  perform pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
  update profiles set company_id = 'b463d8b5-b589-4194-b0c3-2a912b58b7c9'
   where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566';
  delete from profile_companies
   where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and company_id = '00000000-0000-0000-0000-0000000000aa';
end $$;

do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'Task 3: el estado de partida debía tener e-CF activo en la demo';
  end if;
end $t$;

-- Anulación de una venta con e-CF aceptado, hecha como `authenticated` (super
-- admin): la nota de crédito lleva una E34 de 10 dígitos de la secuencia
-- electrónica, apunta al e-NCF de la venta y la bandeja crea su documento tipo
-- 34 por enviar aunque `authenticated` no pueda escribir en ecf_documentos.
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec80', 'aceptado');
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
declare r jsonb;
begin
  r := annul_sale('00000000-0000-0000-0000-00000000ec80', 'prueba e-CF', null);
  perform set_config('ecf.t3_anulacion', r::text, true);
end $t$;
reset role;
do $t$
declare r jsonb := current_setting('ecf.t3_anulacion')::jsonb; s sales; n credit_notes; d ecf_documentos;
begin
  select * into s from sales where id = '00000000-0000-0000-0000-00000000ec80';
  select * into n from credit_notes where sale_id = '00000000-0000-0000-0000-00000000ec80';
  select * into d from ecf_documentos where credit_note_id = n.id;
  if s.cancelled_at is null or s.ncf !~ '^E32\d{10}$' then
    raise exception 'anulación e-CF: la venta debía quedar anulada y conservar su E32, dio % %', s.cancelled_at, s.ncf;
  end if;
  if n.ncf is distinct from 'E340000000001' or n.ncf_modified is distinct from s.ncf then
    raise exception 'anulación e-CF: la nota debía llevar E340000000001 y modificar %, dio % modifica %',
      s.ncf, n.ncf, n.ncf_modified;
  end if;
  if (r->>'credit_note_id') is distinct from n.id::text or (r->>'ncf') is distinct from n.ncf
     or (r->>'ncf_modified') is distinct from s.ncf then
    raise exception 'anulación e-CF: el JSON de respuesta no coincide con la nota: %', r;
  end if;
  if (d.tipo_ecf, d.encf, d.estado, d.ambiente) is distinct from (34::smallint, n.ncf, 'por_enviar', 'CerteCF')
     or d.sale_id is not null or d.branch_id is distinct from n.branch_id or d.company_id <> n.company_id then
    raise exception 'anulación e-CF: documento de la nota inesperado: % % % % %',
      d.tipo_ecf, d.encf, d.estado, d.ambiente, d.sale_id;
  end if;
  if (select count(*) from ecf_documentos where sale_id = s.id and estado = 'aceptado') <> 1
     or (select count(*) from ecf_documentos where sale_id = s.id) <> 1 then
    raise exception 'anulación e-CF: el documento de la venta no debía cambiar';
  end if;
  if pg_temp.sig('E34') <> 2 or pg_temp.sig('B04') <> 1 then
    raise exception 'anulación e-CF: debía gastar solo la E34 (sig E34 = %, B04 = %)', pg_temp.sig('E34'), pg_temp.sig('B04');
  end if;
end $t$;

-- Recibido (firmado, sin respuesta de la DGII) y aceptado condicional también
-- se anulan: la E34 sale igual.
do $t$
declare x record; n credit_notes; d ecf_documentos;
begin
  for x in
    select * from (values
      ('00000000-0000-0000-0000-00000000ec81'::uuid, 'recibido', 'E340000000002'),
      ('00000000-0000-0000-0000-00000000ec82'::uuid, 'aceptado_condicional', 'E340000000003')
    ) v(id, estado, esperado)
  loop
    perform pg_temp.venta_e(x.id, x.estado);
    perform annul_sale(x.id, 'prueba e-CF', null);
    select * into n from credit_notes where sale_id = x.id;
    select * into d from ecf_documentos where credit_note_id = n.id;
    if n.ncf is distinct from x.esperado
       or n.ncf_modified is distinct from (select ncf from sales where id = x.id)
       or (d.tipo_ecf, d.estado) is distinct from (34::smallint, 'por_enviar') then
      raise exception 'anulación e-CF con el documento %: debía salir % con su documento 34, dio % %',
        x.estado, x.esperado, n.ncf, d.estado;
    end if;
  end loop;
end $t$;

-- Sin enviar a la DGII no se puede anular: la venta, el número y la bandeja
-- quedan como estaban.
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec83', 'por_enviar');
do $t$
declare e text; antes bigint := pg_temp.sig('E34');
begin
  foreach e in array array['por_enviar', 'enviando', 'error_datos', 'sin_cupo'] loop
    update ecf_documentos set estado = e where sale_id = '00000000-0000-0000-0000-00000000ec83';
    perform pg_temp.debe_fallar(
      $q$select annul_sale('00000000-0000-0000-0000-00000000ec83', 'prueba e-CF', null)$q$,
      'Esta venta tiene su e-CF todavía sin enviar a la DGII. Espera a que salga o reintenta el envío antes de anularla.');
    if (select cancelled_at from sales where id = '00000000-0000-0000-0000-00000000ec83') is not null
       or exists (select 1 from credit_notes where sale_id = '00000000-0000-0000-0000-00000000ec83')
       or pg_temp.sig('E34') <> antes
       or (select count(*) from ecf_documentos where tipo_ecf = 34) <> 3 then
      raise exception 'anulación e-CF con el documento %: no debía anular, gastar la E34 ni crear documentos', e;
    end if;
  end loop;
end $t$;

-- Rechazado: se anula sin nota de crédito (ncf null), sin gastar la E34 y sin
-- documento 34; el rechazado queda como está.
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec84', 'rechazado');
do $t$
declare r jsonb; s sales; n credit_notes; antes bigint := pg_temp.sig('E34');
begin
  r := annul_sale('00000000-0000-0000-0000-00000000ec84', 'rechazada por la DGII', null);
  select * into s from sales where id = '00000000-0000-0000-0000-00000000ec84';
  select * into n from credit_notes where sale_id = s.id;
  if s.cancelled_at is null then
    raise exception 'anulación de un rechazado: la venta debía quedar anulada';
  end if;
  if n.id is null or n.ncf is not null or n.ncf_modified is distinct from s.ncf
     or (r->>'ncf') is not null or (r->>'credit_note_id') is distinct from n.id::text then
    raise exception 'anulación de un rechazado: la nota debía existir sin ncf y modificar %, dio % / %', s.ncf, n.ncf, r;
  end if;
  if pg_temp.sig('E34') <> antes
     or exists (select 1 from ecf_documentos where credit_note_id = n.id)
     or (select count(*) from ecf_documentos where tipo_ecf = 34) <> 3
     or (select estado from ecf_documentos where sale_id = s.id) is distinct from 'rechazado' then
    raise exception 'anulación de un rechazado: no debía gastar la E34 ni crear documento 34';
  end if;
end $t$;

-- Una venta con B (de antes de activar el e-CF) sigue sacando un B04 de 8
-- dígitos aunque haya una E34 más vieja en la tabla: la anulación de una B no
-- toca las secuencias electrónicas.
select pg_temp.venta_b('00000000-0000-0000-0000-00000000ec85', 'B0200000009');
do $t$
declare r jsonb;
begin
  r := annul_sale('00000000-0000-0000-0000-00000000ec85', 'prueba B', null);
  if (r->>'ncf') is distinct from 'B0400000001' or (r->>'ncf_modified') is distinct from 'B0200000009' then
    raise exception 'anulación de una B con e-CF activo: debía salir B0400000001, dio %', r;
  end if;
  if pg_temp.sig('B04') <> 2 or pg_temp.sig('E34') <> 4
     or exists (select 1 from ecf_documentos where credit_note_id = (r->>'credit_note_id')::uuid) then
    raise exception 'anulación de una B con e-CF activo: solo debía gastar la B04 y no crear documento';
  end if;
end $t$;

-- Sin e-CF (suspendida), igual: B04 de 8 dígitos.
update ecf_config set estado = 'suspendida' where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.venta_b('00000000-0000-0000-0000-00000000ec86', 'B0200000010');
do $t$
declare r jsonb;
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'Task 3: la demo debía estar sin e-CF en esta prueba';
  end if;
  r := annul_sale('00000000-0000-0000-0000-00000000ec86', 'prueba B', null);
  if (r->>'ncf') is distinct from 'B0400000002' or (r->>'ncf') !~ '^B04\d{8}$' then
    raise exception 'anulación de una B sin e-CF: debía salir B0400000002, dio %', r;
  end if;
  if pg_temp.sig('B04') <> 3 or pg_temp.sig('E34') <> 4 then
    raise exception 'anulación de una B sin e-CF: solo debía gastar la B04';
  end if;
end $t$;
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';

-- Una venta sin NCF se anula sin nota de crédito, como hoy (la E34 no se gasta).
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec8f', false, 'consumer', now() - interval '3 days');
do $t$
declare r jsonb;
begin
  r := annul_sale('00000000-0000-0000-0000-00000000ec8f', 'prueba sin NCF', null);
  if (r->>'ncf') is not null or (r->>'ncf_modified') is not null or pg_temp.sig('E34') <> 4 then
    raise exception 'anulación sin NCF: no debía llevar nota de crédito ni gastar la E34, dio %', r;
  end if;
end $t$;

-- El trigger de la bandeja de notas de crédito solo reacciona a una E34 de 10
-- dígitos: una B04, una E32, una E34 corta o larga, en minúscula o sin NCF no
-- crean nada. La que sí vale crea su documento sin venta. Cada venta lleva una
-- sola nota de crédito (credit_notes.sale_id es único), así que cada nota tiene
-- su venta de hace tres días (sin e-NCF) con el mismo id.
do $t$
declare x record; d ecf_documentos;
begin
  for x in
    select * from (values
      ('00000000-0000-0000-0000-00000000ec91'::uuid, 'E340000009991', 1),
      ('00000000-0000-0000-0000-00000000ec92'::uuid, 'B0400000099', 0),
      ('00000000-0000-0000-0000-00000000ec93'::uuid, 'E34000000999', 0),
      ('00000000-0000-0000-0000-00000000ec94'::uuid, 'E320000009994', 0),
      ('00000000-0000-0000-0000-00000000ec95'::uuid, 'E3400000099955', 0),
      ('00000000-0000-0000-0000-00000000ec96'::uuid, 'e340000009996', 0),
      ('00000000-0000-0000-0000-00000000ec97'::uuid, null, 0)
    ) v(id, ncf, esperados)
  loop
    perform pg_temp.venta_ncf(x.id, false, 'consumer', now() - interval '3 days');
    insert into credit_notes (id, company_id, branch_id, sale_id, ncf, subtotal, itbis_amount, total)
    values (x.id, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
            x.id, x.ncf, 10, 0, 10);
    if (select count(*) from ecf_documentos where credit_note_id = x.id) <> x.esperados then
      raise exception 'ecf_encolar_nota_credito: con ncf % debía crear % documento(s)', x.ncf, x.esperados;
    end if;
  end loop;
  select * into d from ecf_documentos where credit_note_id = '00000000-0000-0000-0000-00000000ec91';
  if (d.tipo_ecf, d.encf, d.estado, d.ambiente, d.branch_id)
       is distinct from (34::smallint, 'E340000009991', 'por_enviar', 'CerteCF', '00000000-0000-0000-0000-0000000000b1'::uuid)
     or d.sale_id is not null then
    raise exception 'ecf_encolar_nota_credito: documento inesperado: % % % % %',
      d.tipo_ecf, d.encf, d.estado, d.ambiente, d.branch_id;
  end if;
end $t$;

-- reemitir_ecf: con el documento rechazado y como `authenticated` (super
-- admin) la venta pasa al siguiente E32, hay dos documentos y el viejo apunta
-- al nuevo.
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec87', 'rechazado');
select set_config('ecf.t3_sig_e32', pg_temp.sig('E32')::text, true);
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
declare r jsonb;
begin
  r := reemitir_ecf('00000000-0000-0000-0000-00000000ec87');
  perform set_config('ecf.t3_reemision', r::text, true);
end $t$;
reset role;
do $t$
declare
  r jsonb := current_setting('ecf.t3_reemision')::jsonb;
  sg bigint := current_setting('ecf.t3_sig_e32')::bigint;
  s sales; viejo ecf_documentos; nuevo ecf_documentos;
begin
  select * into s from sales where id = '00000000-0000-0000-0000-00000000ec87';
  select * into viejo from ecf_documentos where sale_id = s.id and encf = 'E32' || lpad((sg - 1)::text, 10, '0');
  select * into nuevo from ecf_documentos where sale_id = s.id and encf = 'E32' || lpad(sg::text, 10, '0');
  if s.ncf is distinct from 'E32' || lpad(sg::text, 10, '0') or s.cancelled_at is not null then
    raise exception 'reemitir_ecf: la venta debía pasar a % sin anularse, dio %', 'E32' || lpad(sg::text, 10, '0'), s.ncf;
  end if;
  if (select count(*) from ecf_documentos where sale_id = s.id) <> 2 or viejo.id is null or nuevo.id is null then
    raise exception 'reemitir_ecf: debía haber dos documentos, el viejo y el nuevo';
  end if;
  if viejo.reemplazado_por is distinct from nuevo.id or viejo.estado <> 'rechazado' then
    raise exception 'reemitir_ecf: el viejo debía seguir rechazado y apuntar al nuevo, dio % %', viejo.estado, viejo.reemplazado_por;
  end if;
  if (nuevo.tipo_ecf, nuevo.estado, nuevo.ambiente, nuevo.branch_id, nuevo.company_id, nuevo.intentos)
       is distinct from (32::smallint, 'por_enviar', 'CerteCF', '00000000-0000-0000-0000-0000000000b1'::uuid,
                         '00000000-0000-0000-0000-0000000000aa'::uuid, 0)
     or nuevo.reemplazado_por is not null or nuevo.credit_note_id is not null then
    raise exception 'reemitir_ecf: documento nuevo inesperado: % % % %', nuevo.tipo_ecf, nuevo.estado, nuevo.ambiente, nuevo.reemplazado_por;
  end if;
  if (r->>'documento_id') is distinct from nuevo.id::text or (r->>'encf') is distinct from nuevo.encf then
    raise exception 'reemitir_ecf: el JSON debía traer documento_id y encf del nuevo, dio %', r;
  end if;
  if pg_temp.sig('E32') <> sg + 1 then
    raise exception 'reemitir_ecf: debía gastar un solo número';
  end if;
end $t$;

-- Una vez reemitido, el documento vigente es el nuevo: no se puede reemitir
-- otra vez ni anular mientras no salga; el rechazado viejo no cuenta. Cuando el
-- nuevo se acepta, la anulación saca la E34 y modifica el e-NCF nuevo.
do $t$
declare nuevo uuid := pg_temp.doc_vigente('00000000-0000-0000-0000-00000000ec87'); n credit_notes; s sales;
begin
  perform pg_temp.debe_fallar(
    $q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec87')$q$,
    'Solo se puede reemitir un comprobante rechazado por la DGII.');
  perform pg_temp.debe_fallar(
    $q$select annul_sale('00000000-0000-0000-0000-00000000ec87', 'prueba', null)$q$,
    'Esta venta tiene su e-CF todavía sin enviar a la DGII%');
  update ecf_documentos set estado = 'aceptado' where id = nuevo;
  perform annul_sale('00000000-0000-0000-0000-00000000ec87', 'prueba', null);
  select * into s from sales where id = '00000000-0000-0000-0000-00000000ec87';
  select * into n from credit_notes where sale_id = s.id;
  if n.ncf !~ '^E34\d{10}$' or n.ncf_modified is distinct from s.ncf
     or n.ncf_modified = (select encf from ecf_documentos where sale_id = s.id and estado = 'rechazado') then
    raise exception 'anulación tras reemitir: la E34 debía modificar el e-NCF nuevo %, dio % modifica %', s.ncf, n.ncf, n.ncf_modified;
  end if;
  -- Y una venta ya anulada no se reemite, aunque su documento esté rechazado.
  perform pg_temp.debe_fallar(
    $q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec84')$q$,
    'Esta venta ya fue anulada.');
end $t$;

-- reemitir_ecf solo con el documento rechazado: cualquier otro estado, una
-- venta sin documento (B) o una que no existe se rechazan sin tocar nada. Se
-- prueba como `authenticated`; fijar_estado (security definer) cambia el estado
-- del documento desde dentro del mismo bloque, que no puede escribir en la tabla.
create function pg_temp.fijar_estado(p_sale uuid, p_estado text) returns void language sql security definer as $$
  update ecf_documentos set estado = p_estado where sale_id = p_sale and reemplazado_por is null
$$;

select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec88', 'aceptado');
select pg_temp.venta_b('00000000-0000-0000-0000-00000000ec8c', 'B0200000011');
select set_config('ecf.t3_sig_e32_b', pg_temp.sig('E32')::text, true);
select set_config('ecf.t3_ncf_ec88', pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec88'), true);
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
declare e text;
begin
  foreach e in array array['por_enviar', 'enviando', 'recibido', 'aceptado', 'aceptado_condicional', 'error_datos', 'sin_cupo'] loop
    perform pg_temp.fijar_estado('00000000-0000-0000-0000-00000000ec88', e);
    perform pg_temp.debe_fallar(
      $q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec88')$q$,
      'Solo se puede reemitir un comprobante rechazado por la DGII.');
  end loop;
  perform pg_temp.debe_fallar(
    $q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec8c')$q$,
    'Solo se puede reemitir un comprobante rechazado por la DGII.');
  perform pg_temp.debe_fallar($q$select reemitir_ecf(gen_random_uuid())$q$, 'Venta no encontrada.');
end $t$;
reset role;
do $t$
begin
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec88') is distinct from current_setting('ecf.t3_ncf_ec88')
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec88') <> 1
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec8c') <> 0
     or pg_temp.sig('E32') <> current_setting('ecf.t3_sig_e32_b')::bigint then
    raise exception 'reemitir_ecf: las reemisiones rechazadas no debían cambiar la venta, los documentos ni gastar números';
  end if;
end $t$;

-- Sin e-CF activo no se reemite (assign_ncf daría una B), y si la secuencia E32
-- no tiene números no cambia nada: ni la venta, ni el documento, ni el contador.
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec8b', 'rechazado');
do $t$
declare sg bigint := pg_temp.sig('E32'); ncf0 text := pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec8b');
begin
  update ecf_config set estado = 'suspendida' where company_id = '00000000-0000-0000-0000-0000000000aa';
  perform pg_temp.debe_fallar(
    $q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec8b')$q$,
    'La facturación electrónica no está activa para esta empresa.');
  update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';

  update ncf_sequences set current_val = range_to + 1
   where company_id = '00000000-0000-0000-0000-0000000000aa' and prefix = 'E32';
  perform pg_temp.debe_fallar(
    $q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec8b')$q$,
    'No hay una secuencia de e-CF (E32) activa con números disponibles%');
  update ncf_sequences set current_val = sg
   where company_id = '00000000-0000-0000-0000-0000000000aa' and prefix = 'E32';

  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec8b') is distinct from ncf0
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec8b') <> 1
     or (select estado from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec8b') <> 'rechazado'
     or (select reemplazado_por from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec8b') is not null
     or pg_temp.sig('E32') <> sg then
    raise exception 'reemitir_ecf: sin e-CF activo o sin secuencia no debía cambiar nada';
  end if;
end $t$;

-- ecf_reintentar: error_datos y sin_cupo vuelven a por_enviar con el próximo
-- intento en este momento; cualquier otro estado se rechaza sin cambiar nada.
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec8e', 'error_datos');
do $t$
declare e text; d uuid := pg_temp.doc_vigente('00000000-0000-0000-0000-00000000ec8e'); x ecf_documentos;
begin
  foreach e in array array['error_datos', 'sin_cupo'] loop
    update ecf_documentos
       set estado = e, proximo_intento_at = now() + interval '1 hour', intentos = 3, ultimo_error = 'dato inválido'
     where id = d;
    perform ecf_reintentar(d);
    select * into x from ecf_documentos where id = d;
    if x.estado <> 'por_enviar' or x.proximo_intento_at is distinct from now() then
      raise exception 'ecf_reintentar desde %: debía quedar por_enviar para ahora, dio % %', e, x.estado, x.proximo_intento_at;
    end if;
  end loop;

  foreach e in array array['por_enviar', 'enviando', 'recibido', 'aceptado', 'aceptado_condicional', 'rechazado'] loop
    update ecf_documentos set estado = e where id = d;
    perform pg_temp.debe_fallar(
      format($q$select ecf_reintentar(%L)$q$, d),
      'Solo se puede reintentar un comprobante con error o sin cupo.');
    if (select estado from ecf_documentos where id = d) <> e then
      raise exception 'ecf_reintentar desde %: no debía cambiar el estado', e;
    end if;
  end loop;
  perform pg_temp.debe_fallar($q$select ecf_reintentar(gen_random_uuid())$q$, 'Comprobante no encontrado.');
end $t$;

-- Cajero de la demo (como `authenticated`): ni reemite, ni reintenta, ni anula,
-- y lo de otra empresa ni lo ve. Nada cambia.
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec8a', 'rechazado');
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec8d', 'error_datos');
select set_config('ecf.t3_ncf_ec8a', pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec8a'), true);
select pg_temp.melany_en_demo('cashier');
set local role authenticated;
do $t$
begin
  if is_company_admin() then
    raise exception 'Task 3: la persona de prueba debía ser cajera de la demo, no administradora';
  end if;
  perform pg_temp.debe_fallar(
    $q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec8a')$q$,
    'Solo un administrador puede reemitir comprobantes.');
  perform pg_temp.debe_fallar(
    format($q$select ecf_reintentar(%L)$q$, pg_temp.doc_vigente('00000000-0000-0000-0000-00000000ec8d')),
    'Solo un administrador puede reintentar comprobantes.');
  perform pg_temp.debe_fallar(
    $q$select annul_sale('00000000-0000-0000-0000-00000000ec8a', 'prueba', null)$q$,
    'Solo un administrador puede anular ventas.');
  -- Una venta y un documento de otra empresa: ni existen para ella.
  perform pg_temp.debe_fallar($q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec03')$q$, 'Venta no encontrada.');
  perform pg_temp.debe_fallar($q$select ecf_reintentar('00000000-0000-0000-0000-00000000ec23')$q$, 'Comprobante no encontrado.');
end $t$;
reset role;

-- Administrador de la demo que no es super admin (como `authenticated`): reemite
-- y reintenta lo de su empresa, y lo de otra empresa sigue sin existir para él.
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec89', 'rechazado');
select set_config('ecf.t3_sig_e32_c', pg_temp.sig('E32')::text, true);
select pg_temp.melany_en_demo('admin');
set local role authenticated;
do $t$
declare r jsonb;
begin
  if not is_company_admin() or is_super_admin() then
    raise exception 'Task 3: la persona de prueba debía ser administradora de la demo sin ser super admin';
  end if;
  r := reemitir_ecf('00000000-0000-0000-0000-00000000ec89');
  perform set_config('ecf.t3_admin', r::text, true);
  perform ecf_reintentar(pg_temp.doc_vigente('00000000-0000-0000-0000-00000000ec8d'));
  perform pg_temp.debe_fallar($q$select reemitir_ecf('00000000-0000-0000-0000-00000000ec03')$q$, 'Venta no encontrada.');
  perform pg_temp.debe_fallar($q$select ecf_reintentar('00000000-0000-0000-0000-00000000ec23')$q$, 'Comprobante no encontrado.');
end $t$;
reset role;
select pg_temp.melany_fuera_de_demo();
do $t$
declare
  r jsonb := current_setting('ecf.t3_admin')::jsonb;
  sg bigint := current_setting('ecf.t3_sig_e32_c')::bigint;
begin
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec89') is distinct from 'E32' || lpad(sg::text, 10, '0')
     or (r->>'encf') is distinct from 'E32' || lpad(sg::text, 10, '0')
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec89') <> 2
     or (r->>'documento_id') is distinct from pg_temp.doc_vigente('00000000-0000-0000-0000-00000000ec89')::text then
    raise exception 'administrador sin ser super admin: debía poder reemitir su venta, dio %', r;
  end if;
  if (select estado from ecf_documentos where id = pg_temp.doc_vigente('00000000-0000-0000-0000-00000000ec8d')) <> 'por_enviar' then
    raise exception 'administrador sin ser super admin: debía poder reintentar el documento de su empresa';
  end if;

  -- Lo que intentó el cajero y lo de la otra empresa no cambió.
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec8a') is distinct from current_setting('ecf.t3_ncf_ec8a')
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec8a') <> 1
     or (select estado from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec8a') <> 'rechazado'
     or (select cancelled_at from sales where id = '00000000-0000-0000-0000-00000000ec8a') is not null then
    raise exception 'el cajero no debía poder cambiar nada';
  end if;
  if (select estado from ecf_documentos where id = '00000000-0000-0000-0000-00000000ec23') <> 'por_enviar'
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec03') <> 1 then
    raise exception 'lo de la otra empresa no debía cambiar';
  end if;

  -- La persona de prueba vuelve a su empresa y a su rol.
  if (select company_id from profiles where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566')
       is distinct from 'b463d8b5-b589-4194-b0c3-2a912b58b7c9'
     or (select role::text from profiles where id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566') <> 'admin'
     or exists (select 1 from profile_companies
                 where profile_id = 'cc56c633-4b6c-4a8e-a7e8-6ee3a1934566' and company_id = '00000000-0000-0000-0000-0000000000aa') then
    raise exception 'Task 3: el perfil de prueba no volvió a su empresa y su rol';
  end if;
end $t$;

-- Permisos de las funciones: las nuevas cerradas a anon y a PUBLIC, abiertas a
-- authenticated (ellas validan el rol adentro); el trigger de la bandeja de
-- notas, solo del servidor; annul_sale sigue igual.
do $t$
declare f text;
begin
  foreach f in array array['public.reemitir_ecf(uuid)', 'public.ecf_reintentar(uuid)', 'public.annul_sale(uuid,text,text)'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'anon no debía poder ejecutar %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'authenticated debía poder ejecutar %', f;
    end if;
    if (select proacl is null from pg_proc where oid = f::regprocedure)
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                   where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '% no debía ser ejecutable por PUBLIC', f;
    end if;
    if not coalesce((select prosecdef and proconfig @> array['search_path=public']
                       from pg_proc where oid = f::regprocedure), false) then
      raise exception '% debía ser security definer con search_path = public', f;
    end if;
  end loop;

  f := 'public.ecf_encolar_nota_credito()';
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
    raise exception 'ecf_encolar_nota_credito no debía ser ejecutable por anon ni authenticated';
  end if;
  if (select proacl is null from pg_proc where oid = f::regprocedure)
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                 where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'ecf_encolar_nota_credito no debía ser ejecutable por PUBLIC';
  end if;
  if not coalesce((select prosecdef and proconfig @> array['search_path=public']
                     from pg_proc where oid = f::regprocedure), false) then
    raise exception 'ecf_encolar_nota_credito debía ser security definer con search_path = public';
  end if;
end $t$;

select 'ok';
