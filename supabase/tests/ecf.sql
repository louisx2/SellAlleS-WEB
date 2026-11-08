-- Pruebas de la facturación electrónica (e-CF con MSeller). NO es una
-- migración: se corre contra producción dentro de una transacción que se
-- revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261030120000_ecf_esquema.sql>
--          <supabase/migrations/20261030130000_ecf_asignacion.sql>
--          <supabase/migrations/20261030140000_ecf_anulacion_reemision.sql>
--          <supabase/migrations/20261030150000_ecf_servidor.sql>
--          <supabase/migrations/20261030160000_ecf_avisos.sql>
--          <supabase/migrations/20261030170000_ecf_admin.sql>
--          <supabase/migrations/20261030180000_ecf_ajustes_revision_final.sql>
--          <supabase/migrations/20261107120000_ecf_credenciales_rechazadas.sql>
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
--
-- Nunca escribe filas de una empresa real ni toca credenciales o secretos que
-- ya existan: la "otra empresa" y todas las credenciales (con sus secretos de
-- Vault) son de empresas de prueba que se crean aquí mismo y se van con el
-- rollback. Así la suite sigue pasando cuando la demo tenga sus credenciales
-- reales de TesteCF.

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

-- Empresas de prueba (el rollback las quita):
--   …ec0a  la "otra empresa" de las pruebas de RLS y de las funciones del servidor;
--   …ec0b  credenciales de Task 1 (solo la tabla, sin Vault);
--   …ec0c  credenciales y secretos de Vault de Task 4;
--   …ec0d  credenciales y secretos de Vault de Task 9;
--   …ec0e  credenciales y secretos de Vault de la revisión final.
insert into companies (id, name) values
  ('00000000-0000-0000-0000-00000000ec0a', 'Prueba e-CF: otra empresa'),
  ('00000000-0000-0000-0000-00000000ec0b', 'Prueba e-CF: credenciales T1'),
  ('00000000-0000-0000-0000-00000000ec0c', 'Prueba e-CF: credenciales T4'),
  ('00000000-0000-0000-0000-00000000ec0d', 'Prueba e-CF: credenciales T9'),
  ('00000000-0000-0000-0000-00000000ec0e', 'Prueba e-CF: credenciales RF');

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
-- En la empresa de prueba …ec0b, no en la demo (que puede tener las suyas).
do $t$
begin
  insert into ecf_credenciales (company_id, ambiente, email)
  values ('00000000-0000-0000-0000-00000000ec0b', 'TesteCF', 'demo-teste@example.com');
  insert into ecf_credenciales (company_id, ambiente, email)
  values ('00000000-0000-0000-0000-00000000ec0b', 'CerteCF', 'demo-certe@example.com');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_credenciales (company_id, ambiente, email)
       values ('00000000-0000-0000-0000-00000000ec0b', 'TesteCF', 'otro@example.com')$q$,
    '%duplicate key%');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_credenciales (company_id, ambiente, email)
       values ('00000000-0000-0000-0000-00000000ec0b', 'eCF', null)$q$,
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
  -- Todas menos E32 y E34 llevan vencimiento (lo prueba la revisión final).
  for t in
    select * from (values ('consumer', 'E32'), ('fiscal', 'E31'), ('nota_credito', 'E34'),
                          ('nota_debito', 'E33'), ('regimen_especial', 'E44'), ('gubernamental', 'E45')) v(tipo, prefix)
  loop
    insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica, expires_at)
    values ('00000000-0000-0000-0000-0000000000aa', t.tipo, t.prefix, 1, 10, 1, true,
            case when t.prefix not in ('E32', 'E34') then current_date + 365 end);
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

-- Índices: por venta, por nota de crédito, por sucursal, por reemplazo y el
-- parcial de los que aún no terminan (con los sin cupo, que el worker revisa).
do $t$
declare def text; col text;
begin
  foreach col in array array['branch_id', 'reemplazado_por'] loop
    select indexdef into def from pg_indexes
     where schemaname = 'public' and tablename = 'ecf_documentos' and indexname = 'ecf_documentos_' || col || '_idx';
    if def is null or def not like '%(' || col || ')%' then
      raise exception 'falta el índice de ecf_documentos por %: %', col, def;
    end if;
  end loop;
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
  if def is null or def not like '%(estado)%' or def not like '%WHERE%por_enviar%enviando%recibido%sin_cupo%'
     or def like '%aceptado%' or def like '%rechazado%' or def like '%error_datos%' then
    raise exception 'el índice parcial de ecf_documentos debía ser por estado solo para por_enviar, enviando, recibido y sin_cupo: %', def;
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
--   * super admin (equipo de la plataforma): ve todo y cambia los datos de
--     ecf_config (no su estado ni sus marcas), menos credenciales.
--   * cc56c633…, como administradora de la demo sin ser super admin
--     (pg_temp.melany_en_demo): solo lo suyo, y de solo lectura.
--   * la otra empresa es la de prueba …ec0a (ninguna empresa real).
-- Datos: configuración, uso, documentos y ventas de la demo ya existen
-- (secciones de arriba); se agregan los de la otra empresa.
do $t$
declare otra uuid := '00000000-0000-0000-0000-00000000ec0a';
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
declare otra uuid := '00000000-0000-0000-0000-00000000ec0a';
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
  -- Puede escribir los datos de ecf_config, no el resto.
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

-- Administradora de la demo, sin ser super admin.
select pg_temp.melany_en_demo('admin');
set local role authenticated;
do $t$
declare
  demo  uuid := '00000000-0000-0000-0000-0000000000aa';
  otra  uuid := '00000000-0000-0000-0000-00000000ec0a';
  plan0 text;
begin
  if is_super_admin() or not is_company_admin() then
    raise exception 'RLS: la persona de prueba debía ser administradora de la demo sin ser super admin';
  end if;

  -- Con la otra empresa: nada.
  if (select count(*) from ecf_config where company_id = otra) <> 0 then
    raise exception 'RLS: una admin de otra empresa no debía ver la ecf_config de la otra';
  end if;
  if (select count(*) from ecf_documentos where company_id = otra) <> 0 then
    raise exception 'RLS: una admin de otra empresa no debía ver los documentos de la otra';
  end if;
  if (select count(*) from ecf_uso) <> 0 then
    raise exception 'RLS: ecf_uso es solo del super admin, la admin normal vio filas';
  end if;
  perform pg_temp.debe_fallar($q$select * from ecf_credenciales$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select email from ecf_credenciales$q$, '%permission denied%');

  -- Con lo suyo: lee, no escribe.
  if (select count(*) from ecf_config where company_id = demo) <> 1 then
    raise exception 'RLS: la admin debía ver la ecf_config de su empresa';
  end if;
  if (select count(*) from ecf_documentos where company_id = demo) = 0 then
    raise exception 'RLS: la admin debía ver los documentos de las ventas de su empresa';
  end if;
  -- El estado ni siquiera es una columna que authenticated pueda escribir.
  perform pg_temp.debe_fallar(
    $q$update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa'$q$,
    '%permission denied%');
  -- Las de datos sí, pero la RLS solo deja al super admin.
  select plan into plan0 from ecf_config where company_id = demo;
  update ecf_config set plan = case when plan0 = 'gratis' then 'basico' else 'gratis' end where company_id = demo;
  if (select plan from ecf_config where company_id = demo) is distinct from plan0 then
    raise exception 'RLS: la admin normal no debía poder cambiar su ecf_config';
  end if;
  delete from ecf_config where company_id = demo;
  if (select count(*) from ecf_config where company_id = demo) <> 1 then
    raise exception 'RLS: la admin normal no debía poder borrar su ecf_config';
  end if;
  perform pg_temp.debe_fallar(
    $q$insert into ecf_config (company_id, rnc_emisor, razon_social, direccion)
       values ('00000000-0000-0000-0000-00000000ec0b', '303030303', 'Intento', 'Calle 3')$q$,
    '%row-level security%');
  perform pg_temp.debe_fallar(
    $q$insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente)
       values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec01', 32, 'E320000000098', 'TesteCF')$q$,
    '%permission denied%');

  -- ecf_activa se puede preguntar: da solo un booleano.
  if ecf_activa(demo) is distinct from false then
    raise exception 'ecf_activa: la demo está suspendida, debía dar false';
  end if;
end $t$;
reset role;
select pg_temp.melany_fuera_de_demo();

-- Vuelve el super admin: nada de lo anterior debió cambiar los datos.
do $t$
begin
  if (select estado from ecf_config where company_id = '00000000-0000-0000-0000-00000000ec0a') <> 'preparacion'
     or (select estado from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa') <> 'suspendida' then
    raise exception 'una ecf_config cambió pese a la RLS';
  end if;
  if exists (select 1 from ecf_config where company_id = '00000000-0000-0000-0000-00000000ec0b') then
    raise exception 'la admin normal no debía poder crear una ecf_config';
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

-- Secuencia de la demo; arranca en p_desde. Las E que no son E32 ni E34 llevan
-- vencimiento (dentro de un año si no se dice otro).
create function pg_temp.secuencia(p_tipo text, p_prefix text, p_electronica boolean,
                                  p_desde bigint default 1, p_hasta bigint default 100) returns void
language sql as $$
  insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica, expires_at)
  values ('00000000-0000-0000-0000-0000000000aa', p_tipo, p_prefix, p_desde, p_hasta, p_desde, p_electronica,
          case when p_electronica and p_prefix not in ('E32', 'E34')
               then company_today('00000000-0000-0000-0000-0000000000aa') + 365 end);
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

-- El documento lleva el ambiente de ecf_config. Con la empresa activa el
-- ambiente no se cambia: se pasa a preparación, se cambia y se vuelve a activar.
update ecf_config set estado = 'preparacion' where company_id = '00000000-0000-0000-0000-0000000000aa';
update ecf_config set ambiente = 'CerteCF' where company_id = '00000000-0000-0000-0000-0000000000aa';
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec42', false);
update ecf_config set estado = 'preparacion' where company_id = '00000000-0000-0000-0000-0000000000aa';
update ecf_config set ambiente = 'TesteCF' where company_id = '00000000-0000-0000-0000-0000000000aa';
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';
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

-- Una venta que ya trae una B no se toca (y no entra a la bandeja). Una que
-- trae un e-NCF escrito se rechaza (I3): no sale de ninguna secuencia y la
-- bandeja lo mandaría a la DGII. El e-NCF solo lo asigna el sistema.
insert into sales (id, company_id, branch_id, subtotal, itbis_amount, total, payment_method, payment_status, amount_paid, ncf)
values ('00000000-0000-0000-0000-00000000ec57', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1',
        100, 0, 100, 'transfer', 'paid', 100, 'B0100000009');
do $t$
declare e text;
begin
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec57') is distinct from 'B0100000009'
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec57') <> 0 then
    raise exception 'e-CF: una venta con B ya asignada debía quedar igual y sin documento';
  end if;
  -- Bien formado, mal formado o de cualquier tipo: si empieza por E, no.
  foreach e in array array['E450000000007', 'E320000000001', 'E31', 'Exyz'] loop
    perform pg_temp.debe_fallar(
      format($q$insert into sales (id, company_id, branch_id, subtotal, itbis_amount, total,
                                   payment_method, payment_status, amount_paid, ncf)
                values ('00000000-0000-0000-0000-00000000ec58', '00000000-0000-0000-0000-0000000000aa',
                        '00000000-0000-0000-0000-0000000000b1', 100, 0, 100, 'transfer', 'paid', 100, %L)$q$, e),
      'El número de comprobante electrónico lo asigna el sistema.');
  end loop;
  if exists (select 1 from sales where id = '00000000-0000-0000-0000-00000000ec58')
     or exists (select 1 from ecf_documentos where encf = 'E450000000007') then
    raise exception 'e-CF: la venta con un e-NCF escrito no debía guardarse ni entrar a la bandeja';
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

-- (pg_temp.melany_en_demo y melany_fuera_de_demo están al principio del archivo.)

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

-- Una venta con e-NCF necesita el e-CF activo para anularse (la venta ec98 se
-- crea ahora, con el e-CF todavía activo; la prueba está más abajo).
select pg_temp.venta_e('00000000-0000-0000-0000-00000000ec98', 'aceptado');

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

-- Con el e-CF suspendido una venta con e-NCF no se anula: ni E34 ni B04. No se
-- escribe nada (sin nota de crédito, sin documento 34, secuencias intactas),
-- sea cual sea el estado de su documento.
do $t$
declare e text; b04 bigint := pg_temp.sig('B04'); e34 bigint := pg_temp.sig('E34');
begin
  foreach e in array array['aceptado', 'recibido', 'rechazado', 'por_enviar'] loop
    update ecf_documentos set estado = e where sale_id = '00000000-0000-0000-0000-00000000ec98';
    perform pg_temp.debe_fallar(
      $q$select annul_sale('00000000-0000-0000-0000-00000000ec98', 'prueba', null)$q$,
      'La facturación electrónica de esta empresa no está activa; no se puede anular una venta con comprobante electrónico hasta reactivarla.');
  end loop;
  if exists (select 1 from credit_notes where sale_id = '00000000-0000-0000-0000-00000000ec98')
     or (select cancelled_at from sales where id = '00000000-0000-0000-0000-00000000ec98') is not null
     or (select count(*) from ecf_documentos where sale_id = '00000000-0000-0000-0000-00000000ec98') <> 1
     or pg_temp.sig('B04') <> b04 or pg_temp.sig('E34') <> e34 then
    raise exception 'anulación con e-CF suspendido: no debía crear nota, anular la venta ni gastar B04 ni E34';
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

-- == Task 4: credenciales en Vault, reserva, cupo y cron ==
-- Estado explícito de la sección: super admin; la demo formalizada, sin
-- ncf_enabled, con el módulo `ecf` y su ecf_config en preparación (así las
-- ventas de prueba no reciben e-NCF; se activa después de crearlas); sin
-- documentos ni uso. La otra empresa (la de prueba …ec0a) con su ecf_config en
-- preparación, para ver que las funciones solo trabajan con empresas activas.
--
-- Las credenciales son de la empresa de prueba …ec0c (creada al principio, sin
-- credenciales ni secretos): esta sección nunca lee, cambia ni borra las de la
-- demo ni ningún secreto que ya exista en Vault (tampoco la service_role_key).
-- Los secretos que agrega se van con el rollback. Tampoco toca los documentos
-- de empresas distintas a la demo y a la otra: las listas que se comprueban se
-- limitan a los documentos de la prueba.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
update companies set is_formalized = true, ncf_enabled = false where id = '00000000-0000-0000-0000-0000000000aa';
delete from company_modules where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'ecf', true);
delete from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-0000000000aa', 'preparacion', 'TesteCF', '101010101', 'Demo SRL', 'Calle 1, Santo Domingo');
insert into ecf_config (company_id, estado, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-00000000ec0a', 'preparacion', '202020202', 'Otra SRL', 'Calle 2')
on conflict (company_id) do update set estado = excluded.estado;
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if exists (select 1 from ecf_credenciales where company_id = '00000000-0000-0000-0000-00000000ec0c')
     or exists (select 1 from vault.secrets where name like 'ecf/00000000-0000-0000-0000-00000000ec0c/%') then
    raise exception 'Task 4: la empresa de prueba …ec0c debía empezar sin credenciales ni secretos';
  end if;
end $t$;
select pg_temp.venta('00000000-0000-0000-0000-00000000eca0', '00000000-0000-0000-0000-0000000000aa',
                     '00000000-0000-0000-0000-0000000000b1');
select pg_temp.venta('00000000-0000-0000-0000-00000000eca1', '00000000-0000-0000-0000-00000000ec0a', null);
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';

-- Documento de la demo (venta eca0) por defecto, creado hace una hora para que
-- pase la regla de "más de un minuto". p_n arma el e-NCF: E32 + 10 dígitos.
create function pg_temp.doc_t4(p_id uuid, p_n int, p_estado text, p_ambiente text default 'TesteCF',
                               p_company uuid default '00000000-0000-0000-0000-0000000000aa',
                               p_sale uuid default '00000000-0000-0000-0000-00000000eca0') returns void
language sql as $$
  insert into ecf_documentos (id, company_id, sale_id, tipo_ecf, encf, ambiente, estado, created_at)
  values (p_id, p_company, p_sale, 32, 'E32' || lpad(p_n::text, 10, '0'), p_ambiente, p_estado,
          now() - interval '1 hour');
$$;

create function pg_temp.estado_de(p_id uuid) returns text language sql as $$
  select estado from ecf_documentos where id = p_id
$$;

-- Reserva el documento y resume el resultado: filas:intentos:estado.
create function pg_temp.reservar(p_id uuid) returns text language plpgsql as $$
declare d ecf_documentos; n int := 0;
begin
  for d in select * from ecf_reservar_documento(p_id) loop
    n := n + 1;
  end loop;
  return n || ':' || coalesce(d.intentos::text, '-') || ':' || coalesce(d.estado, '-');
end $$;

create function pg_temp.en_cola() returns bigint language sql as $$
  select count(*) from net.http_request_queue
$$;

do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'Task 4: el estado de partida debía tener e-CF activo en la demo';
  end if;
  if ecf_activa('00000000-0000-0000-0000-00000000ec0a') is distinct from false then
    raise exception 'Task 4: el estado de partida debía tener la otra empresa sin e-CF activo';
  end if;
end $t$;

-- Guardar las credenciales: la contraseña y la api key van a Vault; la tabla
-- solo apunta a ellas.
select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF',
                                'ecf+demo@sellalles.com', 'clave-x', 'key-y');
do $t$
declare c jsonb; n text := 'ecf/00000000-0000-0000-0000-00000000ec0c/TesteCF/';
begin
  c := ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF');
  if (c->>'email', c->>'password', c->>'api_key') is distinct from ('ecf+demo@sellalles.com', 'clave-x', 'key-y') then
    raise exception 'credenciales: la lectura no devolvió el correo, la contraseña y la api key guardados';
  end if;
  if c->>'refresh_token' is not null or c->>'sub' is not null
     or c->>'id_token' is not null or c->>'id_token_vence' is not null then
    raise exception 'credenciales: recién guardadas no debían traer sesión: %', c - 'password' - 'api_key';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(c) k)
     is distinct from array['api_key', 'email', 'id_token', 'id_token_vence', 'password', 'refresh_token', 'sub'] then
    raise exception 'credenciales: el JSON debía traer siete llaves, trae %',
      (select array_agg(k order by k) from jsonb_object_keys(c) k);
  end if;
  if exists (select 1 from ecf_credenciales t where t::text like '%clave-x%' or t::text like '%key-y%') then
    raise exception 'credenciales: la contraseña o la api key quedaron escritas en ecf_credenciales';
  end if;
  if (select count(*) from vault.secrets where name = n || 'password') <> 1
     or (select count(*) from vault.secrets where name = n || 'api_key') <> 1 then
    raise exception 'credenciales: debía haber un secreto de contraseña y uno de api key en Vault';
  end if;
  if (select password_secret_id from ecf_credenciales where company_id = '00000000-0000-0000-0000-00000000ec0c' and ambiente = 'TesteCF')
       is distinct from (select id from vault.secrets where name = n || 'password')
     or (select api_key_secret_id from ecf_credenciales where company_id = '00000000-0000-0000-0000-00000000ec0c' and ambiente = 'TesteCF')
       is distinct from (select id from vault.secrets where name = n || 'api_key') then
    raise exception 'credenciales: la tabla debía apuntar a los secretos de Vault';
  end if;
  perform set_config('ecf.t4_pass_id', (select id::text from vault.secrets where name = n || 'password'), true);
end $t$;

-- Guardar otra vez no crea secretos nuevos: se actualiza el que ya hay.
select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF',
                                'ecf+demo@sellalles.com', 'clave-z', 'key-y');
do $t$
declare n text := 'ecf/00000000-0000-0000-0000-00000000ec0c/TesteCF/';
begin
  if ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF')->>'password' is distinct from 'clave-z' then
    raise exception 'credenciales: al guardar otra vez la lectura debía dar la contraseña nueva';
  end if;
  if (select count(*) from vault.secrets where name = n || 'password') <> 1
     or (select count(*) from vault.secrets where name like 'ecf/00000000-0000-0000-0000-00000000ec0c/%') <> 2 then
    raise exception 'credenciales: guardar dos veces debía dejar un solo secreto por nombre';
  end if;
  if (select id::text from vault.secrets where name = n || 'password') is distinct from current_setting('ecf.t4_pass_id') then
    raise exception 'credenciales: el secreto de la contraseña debía conservar su id al actualizarse';
  end if;
end $t$;

-- Cada ambiente tiene sus propios secretos.
select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'CerteCF',
                                'ecf+certe@sellalles.com', 'clave-certe', 'key-certe');
do $t$
begin
  if (ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'CerteCF')->>'password') is distinct from 'clave-certe'
     or (ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF')->>'password') is distinct from 'clave-z' then
    raise exception 'credenciales: los dos ambientes debían guardarse por separado';
  end if;
  if (select count(*) from vault.secrets where name like 'ecf/00000000-0000-0000-0000-00000000ec0c/%') <> 4 then
    raise exception 'credenciales: dos ambientes debían tener cuatro secretos';
  end if;
  -- Sin credenciales guardadas no hay nada que leer.
  if ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'eCF') is not null then
    raise exception 'credenciales: sin fila guardada la lectura debía dar null';
  end if;
end $t$;

-- Datos que faltan o ambiente que no existe: se rechazan sin tocar Vault.
do $t$
begin
  perform pg_temp.debe_fallar(
    $q$select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'produccion', 'a@b.com', 'x', 'y')$q$,
    '%ambiente%');
  perform pg_temp.debe_fallar(
    $q$select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'eCF', 'a@b.com', '', 'y')$q$,
    '%Faltan%');
  perform pg_temp.debe_fallar(
    $q$select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'eCF', 'a@b.com', 'x', null)$q$,
    '%Faltan%');
  perform pg_temp.debe_fallar(
    $q$select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'eCF', '  ', 'x', 'y')$q$,
    '%Faltan%');
  if exists (select 1 from vault.secrets where name like 'ecf/00000000-0000-0000-0000-00000000ec0c/eCF/%') then
    raise exception 'credenciales: un guardado rechazado no debía dejar secretos';
  end if;
end $t$;

-- La sesión: el idToken, su vencimiento, el refresh token (en Vault) y el sub.
select ecf_guardar_sesion('00000000-0000-0000-0000-00000000ec0c', 'TesteCF', 'tok', now() + interval '1 hour', 'ref', 'sub-1');
do $t$
declare c jsonb := ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF');
begin
  if (c->>'id_token', c->>'refresh_token', c->>'sub') is distinct from ('tok', 'ref', 'sub-1')
     or (c->>'id_token_vence')::timestamptz is distinct from now() + interval '1 hour' then
    raise exception 'sesión: la lectura debía devolver el idToken, su vencimiento, el refresh token y el sub guardados';
  end if;
  if (c->>'password', c->>'api_key') is distinct from ('clave-z', 'key-y') then
    raise exception 'sesión: guardar la sesión no debía tocar la contraseña ni la api key';
  end if;
  if exists (select 1 from ecf_credenciales t where t::text ~ '[(,"]ref[,")]') then
    raise exception 'sesión: el refresh token quedó escrito en ecf_credenciales';
  end if;
  if (select count(*) from vault.secrets where name = 'ecf/00000000-0000-0000-0000-00000000ec0c/TesteCF/refresh_token') <> 1 then
    raise exception 'sesión: el refresh token debía quedar en Vault';
  end if;
end $t$;

-- Con refresh token null se conserva el que había (y el sub, que MSeller no
-- repite al renovar el idToken).
select ecf_guardar_sesion('00000000-0000-0000-0000-00000000ec0c', 'TesteCF', 'tok2', now() + interval '2 hours', null, null);
do $t$
declare c jsonb := ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF');
begin
  if (c->>'id_token', c->>'refresh_token', c->>'sub') is distinct from ('tok2', 'ref', 'sub-1')
     or (c->>'id_token_vence')::timestamptz is distinct from now() + interval '2 hours' then
    raise exception 'sesión: con refresh token null debía cambiar el idToken y conservar el refresh token y el sub';
  end if;
end $t$;

-- Con uno nuevo se reemplaza, en el mismo secreto.
select ecf_guardar_sesion('00000000-0000-0000-0000-00000000ec0c', 'TesteCF', 'tok3', now() + interval '3 hours', 'ref2', 'sub-1');
do $t$
begin
  if (ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF')->>'refresh_token') is distinct from 'ref2'
     or (select count(*) from vault.secrets where name = 'ecf/00000000-0000-0000-0000-00000000ec0c/TesteCF/refresh_token') <> 1 then
    raise exception 'sesión: un refresh token nuevo debía reemplazar al anterior en un solo secreto';
  end if;
  -- La otra cuenta no se enteró.
  if (ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'CerteCF')->>'id_token') is not null then
    raise exception 'sesión: la sesión de TesteCF no debía aparecer en CerteCF';
  end if;
  -- Sin credenciales guardadas no hay a dónde escribir la sesión.
  perform pg_temp.debe_fallar(
    $q$select ecf_guardar_sesion('00000000-0000-0000-0000-00000000ec0c', 'eCF', 't', now(), 'r', 's')$q$,
    '%No hay credenciales%');
end $t$;

-- Cambiar la cuenta (nuevas credenciales) borra la sesión: idToken, sub y el
-- refresh token, también de Vault.
select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF',
                                'ecf+demo2@sellalles.com', 'clave-w', 'key-y');
do $t$
declare c jsonb := ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF');
begin
  if (c->>'email', c->>'password') is distinct from ('ecf+demo2@sellalles.com', 'clave-w') then
    raise exception 'credenciales: al cambiar de cuenta debía leerse el correo y la contraseña nuevos';
  end if;
  if c->>'id_token' is not null or c->>'id_token_vence' is not null or c->>'sub' is not null
     or c->>'refresh_token' is not null then
    raise exception 'credenciales: al cambiar de cuenta la sesión debía borrarse: %', c - 'password' - 'api_key';
  end if;
  if exists (select 1 from ecf_credenciales
              where company_id = '00000000-0000-0000-0000-00000000ec0c' and ambiente = 'TesteCF'
                and refresh_token_secret_id is not null)
     or exists (select 1 from vault.secrets where name = 'ecf/00000000-0000-0000-0000-00000000ec0c/TesteCF/refresh_token') then
    raise exception 'credenciales: al cambiar de cuenta el refresh token debía desaparecer también de Vault';
  end if;
end $t$;

-- Reservar un documento: una sola sentencia, la gana quien llegue primero.
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000eca2', 9001, 'por_enviar');
do $t$
declare d ecf_documentos; r text := pg_temp.reservar('00000000-0000-0000-0000-00000000eca2');
begin
  if r is distinct from '1:1:enviando' then
    raise exception 'reserva: la primera debía dar 1 fila con intentos = 1 (1:1:enviando), dio %', r;
  end if;
  select * into d from ecf_documentos where id = '00000000-0000-0000-0000-00000000eca2';
  if (d.estado, d.intentos) is distinct from ('enviando', 1) or d.reservado_hasta is distinct from now() + interval '2 minutes' then
    raise exception 'reserva: debía quedar enviando, 1 intento y reservado 2 minutos, quedó % % %',
      d.estado, d.intentos, d.reservado_hasta;
  end if;
end $t$;
do $t$
declare e text;
begin
  if pg_temp.reservar('00000000-0000-0000-0000-00000000eca2') is distinct from '0:-:-' then
    raise exception 'reserva: la segunda, con la reserva vigente, debía dar 0 filas';
  end if;
  if (select intentos from ecf_documentos where id = '00000000-0000-0000-0000-00000000eca2') <> 1 then
    raise exception 'reserva: la segunda no debía sumar un intento';
  end if;

  -- Reserva vencida: se puede reservar otra vez (segundo intento).
  update ecf_documentos set reservado_hasta = now() - interval '1 minute' where id = '00000000-0000-0000-0000-00000000eca2';
  if pg_temp.reservar('00000000-0000-0000-0000-00000000eca2') is distinct from '1:2:enviando' then
    raise exception 'reserva: con la reserva vencida debía poder reservarse otra vez (intentos = 2)';
  end if;

  -- Por enviar, pero el próximo intento es en el futuro: todavía no.
  update ecf_documentos set estado = 'por_enviar', reservado_hasta = null, proximo_intento_at = now() + interval '10 minutes'
   where id = '00000000-0000-0000-0000-00000000eca2';
  if pg_temp.reservar('00000000-0000-0000-0000-00000000eca2') is distinct from '0:-:-'
     or pg_temp.estado_de('00000000-0000-0000-0000-00000000eca2') <> 'por_enviar' then
    raise exception 'reserva: un documento con el próximo intento en el futuro no debía reservarse';
  end if;
  update ecf_documentos set proximo_intento_at = now() - interval '1 minute' where id = '00000000-0000-0000-0000-00000000eca2';
  if pg_temp.reservar('00000000-0000-0000-0000-00000000eca2') is distinct from '1:3:enviando' then
    raise exception 'reserva: con el próximo intento ya cumplido debía reservarse (intentos = 3)';
  end if;

  -- Los demás estados no se reservan, y un id que no existe tampoco.
  foreach e in array array['recibido', 'aceptado', 'aceptado_condicional', 'rechazado', 'error_datos', 'sin_cupo'] loop
    update ecf_documentos set estado = e, reservado_hasta = now() - interval '1 hour'
     where id = '00000000-0000-0000-0000-00000000eca2';
    if pg_temp.reservar('00000000-0000-0000-0000-00000000eca2') is distinct from '0:-:-' then
      raise exception 'reserva: un documento en % no debía reservarse', e;
    end if;
  end loop;
  if pg_temp.reservar(gen_random_uuid()) is distinct from '0:-:-' then
    raise exception 'reserva: un id que no existe debía dar 0 filas';
  end if;
  if (select intentos from ecf_documentos where id = '00000000-0000-0000-0000-00000000eca2') <> 3 then
    raise exception 'reserva: los intentos debían quedar en 3';
  end if;
end $t$;

-- El contador de uso: una fila por empresa y mes, sumando.
select ecf_sumar_uso('00000000-0000-0000-0000-0000000000aa', 2, 1);
select ecf_sumar_uso('00000000-0000-0000-0000-0000000000aa', 2, 1);
do $t$
declare u ecf_uso; antes int;
begin
  if (select count(*) from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa') <> 1 then
    raise exception 'uso: dos sumas en el mismo mes debían dejar una sola fila';
  end if;
  select * into u from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa';
  if (u.requests, u.comprobantes) is distinct from (4, 2) then
    raise exception 'uso: debía sumar 4 requests y 2 comprobantes, quedó % y %', u.requests, u.comprobantes;
  end if;
  if u.periodo is distinct from date_trunc('month', now() at time zone 'utc')::date then
    raise exception 'uso: el periodo debía ser el día 1 del mes en UTC (%), quedó %',
      date_trunc('month', now() at time zone 'utc')::date, u.periodo;
  end if;
  -- Otra empresa lleva su propia cuenta (se suma sobre lo que ya tuviera).
  select coalesce(sum(requests), 0) into antes from ecf_uso
   where company_id = '00000000-0000-0000-0000-00000000ec0a'
     and periodo = date_trunc('month', now() at time zone 'utc')::date;
  perform ecf_sumar_uso('00000000-0000-0000-0000-00000000ec0a', 7, 0);
  if (select requests from ecf_uso where company_id = '00000000-0000-0000-0000-00000000ec0a'
        and periodo = date_trunc('month', now() at time zone 'utc')::date) is distinct from antes + 7
     or (select requests from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa') <> 4 then
    raise exception 'uso: cada empresa debía llevar su propia cuenta';
  end if;
end $t$;

-- Consultas pendientes: por empresa y ambiente, con los e-NCF que siguen en
-- `recibido`.
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000eca5', 9011, 'recibido');
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000eca6', 9012, 'recibido');
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000eca7', 9013, 'recibido', 'CerteCF');
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000eca8', 9014, 'por_enviar');
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000eca9', 9015, 'aceptado');
do $t$
declare r record;
begin
  if (select count(*) from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa') <> 2 then
    raise exception 'consultas: la demo debía salir una vez por ambiente con recibidos (2 filas), salió % veces',
      (select count(*) from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa');
  end if;
  if (select encfs from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'TesteCF')
       is distinct from array['E320000009011', 'E320000009012'] then
    raise exception 'consultas: TesteCF debía traer solo sus dos e-NCF recibidos, trae %',
      (select encfs from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'TesteCF');
  end if;
  if (select encfs from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'CerteCF')
       is distinct from array['E320000009013'] then
    raise exception 'consultas: CerteCF debía traer su e-NCF recibido';
  end if;
  if exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-00000000ec0a') then
    raise exception 'consultas: una empresa sin documentos recibidos no debía salir';
  end if;

  -- Consultados hace un momento: ya no salen. Cuenta la consulta más reciente.
  update ecf_documentos set ultima_consulta_at = now() - interval '2 hours' where id = '00000000-0000-0000-0000-00000000eca5';
  update ecf_documentos set ultima_consulta_at = now() where id = '00000000-0000-0000-0000-00000000eca6';
  if exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'TesteCF') then
    raise exception 'consultas: con una consulta reciente en el lote, TesteCF no debía salir';
  end if;
  -- El intervalo es de la empresa (su último lote), no de cada ambiente (I6).
  if exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'CerteCF') then
    raise exception 'consultas: la empresa acaba de consultar: CerteCF también debía esperar';
  end if;
  -- Pasada la hora del plan gratis (60 minutos) vuelve a salir.
  update ecf_documentos set ultima_consulta_at = now() - interval '61 minutes' where id = '00000000-0000-0000-0000-00000000eca6';
  update ecf_documentos set ultima_consulta_at = now() - interval '2 hours' where id = '00000000-0000-0000-0000-00000000eca5';
  if not exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'TesteCF') then
    raise exception 'consultas: pasados 60 minutos TesteCF debía volver a salir';
  end if;
  -- El intervalo sale de la configuración de la empresa.
  update ecf_config set minutos_entre_consultas = 120 where company_id = '00000000-0000-0000-0000-0000000000aa';
  if exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'TesteCF') then
    raise exception 'consultas: con 120 minutos entre consultas y la última hace 61, no debía salir';
  end if;
  update ecf_config set minutos_entre_consultas = 30 where company_id = '00000000-0000-0000-0000-0000000000aa';
  update ecf_documentos set ultima_consulta_at = now() - interval '31 minutes' where id = '00000000-0000-0000-0000-00000000eca6';
  update ecf_documentos set ultima_consulta_at = now() - interval '45 minutes' where id = '00000000-0000-0000-0000-00000000eca5';
  if not exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'TesteCF') then
    raise exception 'consultas: con 30 minutos entre consultas y la última hace 31, debía salir';
  end if;
  update ecf_config set minutos_entre_consultas = 60 where company_id = '00000000-0000-0000-0000-0000000000aa';

  -- Todo consultado ahora mismo: la demo no sale.
  update ecf_documentos set ultima_consulta_at = now() where company_id = '00000000-0000-0000-0000-0000000000aa';
  if exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa') then
    raise exception 'consultas: con ultima_consulta_at = now() la demo no debía salir';
  end if;
end $t$;

-- Hasta 100 e-NCF por consulta: los más antiguos primero.
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente, estado, created_at)
select '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000eca0', 32,
       'E32' || lpad(n::text, 10, '0'), 'eCF', 'recibido', now() - interval '2 days' + n * interval '1 second'
  from generate_series(9500, 9604) n;
do $t$
declare e text[];
begin
  select encfs into e from ecf_consultas_pendientes()
   where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'eCF';
  if cardinality(e) is distinct from 100 or e[1] <> 'E320000009500' or e[100] <> 'E320000009599' then
    raise exception 'consultas: con 105 recibidos debía traer 100 (del 9500 al 9599), trajo % de % a %',
      cardinality(e), e[1], e[cardinality(e)];
  end if;
end $t$;
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';

-- Documentos por enviar. Cada uno con el motivo por el que sale o no:
--   b1 por enviar y viejo: sale.            b2 recién creado (menos de 1 minuto): no.
--   b3 próximo intento en el futuro: no.    b4 enviando con la reserva vencida: sale.
--   b5 enviando con la reserva vigente: no. b6 sin cupo del mes pasado: pasa a por enviar y sale.
--   b7 sin cupo de ahora: no.               b8 sin cupo anterior al último cambio de plan: sale.
--   b9 y ba, de una empresa sin e-CF activo (por enviar, y sin cupo del mes pasado): no, y ba no se toca.
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb1', 9101, 'por_enviar');
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb2', 9102, 'por_enviar');
update ecf_documentos set created_at = now() where id = '00000000-0000-0000-0000-00000000ecb2';
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb3', 9103, 'por_enviar');
update ecf_documentos set proximo_intento_at = now() + interval '1 hour' where id = '00000000-0000-0000-0000-00000000ecb3';
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb4', 9104, 'enviando');
update ecf_documentos set reservado_hasta = now() - interval '1 minute' where id = '00000000-0000-0000-0000-00000000ecb4';
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb5', 9105, 'enviando');
update ecf_documentos set reservado_hasta = now() + interval '1 minute' where id = '00000000-0000-0000-0000-00000000ecb5';
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb6', 9106, 'sin_cupo');
update ecf_documentos
   set estado_at = (date_trunc('month', now() at time zone 'utc') at time zone 'utc') - interval '1 day'
 where id = '00000000-0000-0000-0000-00000000ecb6';
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb7', 9107, 'sin_cupo');
update ecf_documentos set estado_at = now() where id = '00000000-0000-0000-0000-00000000ecb7';
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb8', 9108, 'sin_cupo');
-- Del mes en curso pero anterior a la última vez que se tocó ecf_config (el plan
-- cambió): ecf_config.updated_at es now() desde el estado de partida.
update ecf_documentos
   set estado_at = greatest(date_trunc('month', now() at time zone 'utc') at time zone 'utc', now() - interval '1 hour')
 where id = '00000000-0000-0000-0000-00000000ecb8';
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecb9', 9109, 'por_enviar', 'TesteCF',
                      '00000000-0000-0000-0000-00000000ec0a', '00000000-0000-0000-0000-00000000eca1');
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecba', 9110, 'sin_cupo', 'TesteCF',
                      '00000000-0000-0000-0000-00000000ec0a', '00000000-0000-0000-0000-00000000eca1');
update ecf_documentos
   set estado_at = (date_trunc('month', now() at time zone 'utc') at time zone 'utc') - interval '1 day'
 where id = '00000000-0000-0000-0000-00000000ecba';

do $t$
declare v uuid[]; esperado uuid[];
begin
  select array_agg(u order by u) into esperado from unnest(array[
    '00000000-0000-0000-0000-00000000ecb1', '00000000-0000-0000-0000-00000000ecb4',
    '00000000-0000-0000-0000-00000000ecb6', '00000000-0000-0000-0000-00000000ecb8']::uuid[]) u;
  select coalesce(array_agg(x order by x), '{}') into v from ecf_documentos_por_enviar() x
   where x in (select id from ecf_documentos
                where company_id in ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec0a'));
  if v is distinct from esperado then
    raise exception 'por enviar: debían salir b1, b4, b6 y b8, salieron %',
      (select array_agg(right(u::text, 4) order by u) from unnest(v) u);
  end if;
  -- Los sin cupo que tocaban volvieron a la fila; los demás no se movieron.
  if pg_temp.estado_de('00000000-0000-0000-0000-00000000ecb6') <> 'por_enviar'
     or pg_temp.estado_de('00000000-0000-0000-0000-00000000ecb8') <> 'por_enviar' then
    raise exception 'por enviar: los sin cupo de otro mes o de antes del cambio de plan debían pasar a por_enviar';
  end if;
  if (select estado_at from ecf_documentos where id = '00000000-0000-0000-0000-00000000ecb6') is distinct from now() then
    raise exception 'por enviar: al volver a la fila el documento debía estrenar estado_at';
  end if;
  if pg_temp.estado_de('00000000-0000-0000-0000-00000000ecb7') <> 'sin_cupo' then
    raise exception 'por enviar: el sin cupo de este mes no debía moverse';
  end if;
  if pg_temp.estado_de('00000000-0000-0000-0000-00000000ecba') <> 'sin_cupo'
     or pg_temp.estado_de('00000000-0000-0000-0000-00000000ecb9') <> 'por_enviar' then
    raise exception 'por enviar: los documentos de una empresa sin e-CF activo no debían tocarse';
  end if;
  if pg_temp.estado_de('00000000-0000-0000-0000-00000000ecb4') <> 'enviando'
     or pg_temp.estado_de('00000000-0000-0000-0000-00000000ecb5') <> 'enviando' then
    raise exception 'por enviar: listar no debía cambiar los que estaban enviando';
  end if;

  -- Llamarla otra vez da lo mismo (ya no hay nada que mover), y respeta el límite.
  select coalesce(array_agg(x order by x), '{}') into v from ecf_documentos_por_enviar() x
   where x in (select id from ecf_documentos
                where company_id in ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec0a'));
  if v is distinct from esperado then
    raise exception 'por enviar: la segunda llamada debía dar los mismos cuatro';
  end if;
  if (select count(*) from ecf_documentos_por_enviar(2)) <> 2 then
    raise exception 'por enviar: con límite 2 debían salir 2';
  end if;
end $t$;
delete from ecf_documentos where id in (
  '00000000-0000-0000-0000-00000000ecb1', '00000000-0000-0000-0000-00000000ecb2', '00000000-0000-0000-0000-00000000ecb3',
  '00000000-0000-0000-0000-00000000ecb4', '00000000-0000-0000-0000-00000000ecb5', '00000000-0000-0000-0000-00000000ecb6',
  '00000000-0000-0000-0000-00000000ecb7', '00000000-0000-0000-0000-00000000ecb8', '00000000-0000-0000-0000-00000000ecb9',
  '00000000-0000-0000-0000-00000000ecba');

-- Despacho a las Edge Functions (lo que hace el cron). En la transacción de la
-- prueba el pedido queda en la cola de pg_net y se va con el rollback. Usa la
-- service_role_key que ya está en Vault y nunca la borra ni la cambia (la
-- llave no se compara a la vista: solo dentro de la sentencia). Si el proyecto
-- no tuviera ninguna, agrega una de prueba (el rollback la quita). La rama de
-- "falta la llave" (un `raise warning` y `return`, sin encolar nada) no se
-- ejercita aquí porque exigiría quitar la llave real: se verifica leyendo
-- ecf_disparar_envios y ecf_disparar_consultas.
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecc0', 9301, 'por_enviar');
select pg_temp.doc_t4('00000000-0000-0000-0000-00000000ecc1', 9302, 'recibido');
do $t$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    perform vault.create_secret('llave-de-prueba', 'service_role_key', 'solo para la prueba de ecf.sql');
  end if;
end $t$;
do $t$
declare
  antes bigint := pg_temp.en_cola();
  q     record;
  v_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1);
begin
  perform ecf_disparar_envios();
  if pg_temp.en_cola() <> antes + 1 then
    raise exception 'despacho: ecf_disparar_envios con un documento pendiente debía encolar un pedido';
  end if;
  select url, headers, convert_from(body, 'utf8')::jsonb as body into q from net.http_request_queue order by id desc limit 1;
  if q.url is distinct from 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/ecf-emitir' then
    raise exception 'despacho: la función de envíos debía llamar a ecf-emitir, llamó a %', q.url;
  end if;
  if q.headers->>'Authorization' is distinct from 'Bearer ' || v_key
     or q.headers->>'Content-Type' is distinct from 'application/json' then
    raise exception 'despacho: debía mandar Authorization con la llave de Vault y Content-Type json';
  end if;
  if jsonb_typeof(q.body->'documentoIds') is distinct from 'array'
     or not (q.body->'documentoIds') @> '["00000000-0000-0000-0000-00000000ecc0"]'::jsonb then
    raise exception 'despacho: el cuerpo debía traer el documento por enviar en documentoIds, trae %', q.body;
  end if;

  perform ecf_disparar_consultas();
  if pg_temp.en_cola() <> antes + 2 then
    raise exception 'despacho: ecf_disparar_consultas con un recibido pendiente debía encolar un pedido';
  end if;
  select url, headers, convert_from(body, 'utf8')::jsonb as body into q from net.http_request_queue order by id desc limit 1;
  if q.url is distinct from 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/ecf-estado'
     or q.body is distinct from '{}'::jsonb
     or q.headers->>'Authorization' is distinct from 'Bearer ' || v_key then
    raise exception 'despacho: la función de consultas debía llamar a ecf-estado con cuerpo {} y la llave, mandó % %', q.url, q.body;
  end if;

  -- Sin nada pendiente no manda nada (solo se comprueba si en todo el sistema
  -- no queda trabajo de otras empresas).
  update ecf_documentos set estado = 'aceptado' where id in
    ('00000000-0000-0000-0000-00000000ecc0', '00000000-0000-0000-0000-00000000ecc1');
  if not exists (select 1 from ecf_documentos_por_enviar())
     and not exists (select 1 from ecf_consultas_pendientes()) then
    perform ecf_disparar_envios();
    perform ecf_disparar_consultas();
    if pg_temp.en_cola() <> antes + 2 then
      raise exception 'despacho: sin documentos pendientes no debía encolar nada';
    end if;
  end if;
end $t$;

-- Cron: una tarea para los envíos y otra para las consultas.
do $t$
begin
  if (select count(*) from cron.job where jobname in ('ecf-envios', 'ecf-consultas')) <> 2 then
    raise exception 'cron: debían existir las tareas ecf-envios y ecf-consultas';
  end if;
  if (select schedule from cron.job where jobname = 'ecf-envios') is distinct from '* * * * *'
     or (select command from cron.job where jobname = 'ecf-envios') is distinct from 'select public.ecf_disparar_envios()' then
    raise exception 'cron: ecf-envios debía correr cada minuto la función de envíos';
  end if;
  if (select schedule from cron.job where jobname = 'ecf-consultas') is distinct from '*/15 * * * *'
     or (select command from cron.job where jobname = 'ecf-consultas') is distinct from 'select public.ecf_disparar_consultas()' then
    raise exception 'cron: ecf-consultas debía correr cada 15 minutos la función de consultas';
  end if;
  if exists (select 1 from cron.job where jobname in ('ecf-envios', 'ecf-consultas') and not active) then
    raise exception 'cron: las tareas debían estar activas';
  end if;
end $t$;

-- Permisos: todas son del servidor. Ni PUBLIC, ni anon, ni authenticated;
-- sí service_role; security definer con search_path = public.
do $t$
declare f text;
begin
  foreach f in array array[
    'public._ecf_guardar_secreto(text,text,text)',
    'public.ecf_guardar_credenciales(uuid,text,text,text,text)',
    'public.ecf_leer_credenciales(uuid,text)',
    'public.ecf_guardar_sesion(uuid,text,text,timestamptz,text,text)',
    'public.ecf_reservar_documento(uuid)',
    'public.ecf_sumar_uso(uuid,int,int)',
    'public.ecf_documentos_por_enviar(int)',
    'public.ecf_consultas_pendientes()',
    'public.ecf_disparar_envios()',
    'public.ecf_disparar_consultas()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% no debía ser ejecutable por anon ni authenticated', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% debía ser ejecutable por service_role', f;
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
  -- Tiene efectos (devuelve a la fila los sin cupo): no puede ser stable.
  if (select provolatile from pg_proc where oid = 'public.ecf_documentos_por_enviar(int)'::regprocedure) <> 'v' then
    raise exception 'ecf_documentos_por_enviar tiene efectos: debía ser volatile';
  end if;
end $t$;

-- R1: de verdad como `authenticated` y como `anon`, no como postgres: nadie
-- fuera del servidor lee las credenciales ni toca la fila de envíos.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
begin
  perform pg_temp.debe_fallar(
    $q$select ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF')$q$,
    '%permission denied%');
  perform pg_temp.debe_fallar(
    $q$select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF', 'a@b.com', 'x', 'y')$q$,
    '%permission denied%');
  perform pg_temp.debe_fallar(
    $q$select ecf_reservar_documento('00000000-0000-0000-0000-00000000ecc0')$q$,
    '%permission denied%');
  perform pg_temp.debe_fallar($q$select ecf_documentos_por_enviar()$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select * from ecf_consultas_pendientes()$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select ecf_disparar_envios()$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select ecf_sumar_uso('00000000-0000-0000-0000-0000000000aa', 1, 1)$q$, '%permission denied%');
end $t$;
reset role;
set local role anon;
do $t$
begin
  perform pg_temp.debe_fallar(
    $q$select ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF')$q$,
    '%permission denied%');
end $t$;
reset role;

-- service_role sí puede.
set local role service_role;
do $t$
begin
  if (ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0c', 'TesteCF')->>'password') is distinct from 'clave-w' then
    raise exception 'service_role debía poder leer las credenciales';
  end if;
end $t$;
reset role;

-- == Task 8: estado ante la DGII y avisos a SellAlleS ==
-- Estado explícito de la sección: super admin; la demo formalizada, sin
-- ncf_enabled, con el módulo `ecf` y su ecf_config activa (plan gratis: 250
-- comprobantes y 1,000 requests al mes, sin certificado); sin documentos ni
-- uso; una venta (…ecd0) que respalda los documentos de la prueba; y
-- platform_settings.support_email con un correo de prueba (solo dentro de la
-- transacción, que se revierte).
--
-- Nunca cambia ni borra lo que ya haya en Vault: si falta la service_role_key
-- solo agrega una de prueba. No toca a las empresas reales: los avisos de la
-- demo se reconocen por su nombre, y "sin nada que avisar no envía" solo se
-- afirma si en todo el sistema no hay otros avisos. Los correos se miran en
-- net.http_request_queue filtrando por la URL de send-lifecycle-email y por
-- template = 'ecf-avisos' (no por "la última fila").
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
update companies set is_formalized = true, ncf_enabled = false where id = '00000000-0000-0000-0000-0000000000aa';
delete from company_modules where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'ecf', true);
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-0000000000aa', 'preparacion', 'TesteCF', '101010101', 'Demo SRL', 'Calle 1, Santo Domingo');
select pg_temp.venta('00000000-0000-0000-0000-00000000ecd0', '00000000-0000-0000-0000-0000000000aa',
                     '00000000-0000-0000-0000-0000000000b1');
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';
update platform_settings set support_email = 'soporte-prueba@sellalles.test';
do $t$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    perform vault.create_secret('llave-de-prueba', 'service_role_key', 'solo para la prueba de ecf.sql');
  end if;
end $t$;

-- Los correos ecf-avisos que hay en la cola de pg_net, con su URL y sus
-- encabezados. El cuerpo solo se lee si es de send-lifecycle-email.
create function pg_temp.correos_ecf() returns table (id bigint, url text, headers jsonb, b jsonb)
language sql as $$
  select q.id, q.url, q.headers, q.b
    from (select r.id, r.url, r.headers,
                 case when r.url like '%/functions/v1/send-lifecycle-email%'
                      then convert_from(r.body, 'utf8')::jsonb end as b
            from net.http_request_queue r) q
   where q.b ->> 'template' = 'ecf-avisos'
$$;

-- Los de la demo: su nombre sale en el correo.
create function pg_temp.correos_demo() returns table (id bigint, url text, headers jsonb, b jsonb)
language sql as $$
  select c.id, c.url, c.headers, c.b from pg_temp.correos_ecf() c
   where position((select name from companies where id = '00000000-0000-0000-0000-0000000000aa') in c.b::text) > 0
$$;

-- Las líneas del resumen que hablan de la demo y empiezan con el prefijo.
create function pg_temp.lineas_demo(p_prefijo text) returns text[] language sql as $$
  select coalesce(array_agg(t.l order by t.l), '{}')
    from jsonb_array_elements_text(public._ecf_avisos_lineas()) as t(l)
   where t.l like p_prefijo || '%'
     and position((select name from companies where id = '00000000-0000-0000-0000-0000000000aa') in t.l) > 0
$$;

-- Cambia el uso del mes de la demo y dice cuántas líneas de cupo salen.
create function pg_temp.cupo_demo(p_comprobantes int, p_requests int) returns int language plpgsql as $$
begin
  update ecf_uso set comprobantes = p_comprobantes, requests = p_requests
   where company_id = '00000000-0000-0000-0000-0000000000aa'
     and periodo = date_trunc('month', now() at time zone 'utc')::date;
  return cardinality(pg_temp.lineas_demo('Cupo:'));
end $$;

-- Documento de la demo (venta ecd0): e-NCF E32 + 10 dígitos; creado y con el
-- estado puesto hace p_hace.
create function pg_temp.doc_t8(p_id uuid, p_n int, p_estado text, p_hace interval default interval '0') returns void
language sql as $$
  insert into ecf_documentos (id, company_id, sale_id, tipo_ecf, encf, ambiente, estado, created_at, estado_at)
  values (p_id, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ecd0', 32,
          'E32' || lpad(p_n::text, 10, '0'), 'TesteCF', p_estado, now() - p_hace, now() - p_hace);
$$;

-- Sin uso, sin documentos y sin certificado la demo no tiene nada que avisar.
do $t$
declare antes bigint;
begin
  if cardinality(pg_temp.lineas_demo('')) <> 0 then
    raise exception 'Task 8: la demo sin uso, sin documentos y sin certificado no debía tener avisos, tiene %',
      pg_temp.lineas_demo('');
  end if;
  if jsonb_array_length(public._ecf_avisos_lineas()) = 0 then
    antes := (select count(*) from pg_temp.correos_ecf());
    perform ecf_avisos_diarios();
    if (select count(*) from pg_temp.correos_ecf()) <> antes then
      raise exception 'Task 8: sin nada que avisar, ecf_avisos_diarios no debía encolar ningún correo';
    end if;
  else
    raise notice 'Task 8: otras empresas tienen avisos; no se afirma que, sin nada, el resumen no se envía';
  end if;
end $t$;

-- La demo al 85% de su cupo de comprobantes: el resumen diario sale con una
-- sola línea de cupo, en un solo correo para SellAlleS.
insert into ecf_uso (company_id, periodo, comprobantes, requests)
values ('00000000-0000-0000-0000-0000000000aa', date_trunc('month', now() at time zone 'utc')::date, 213, 10);
do $t$
declare
  l     text[] := pg_temp.lineas_demo('Cupo:');
  antes bigint := (select count(*) from pg_temp.correos_ecf());
  q     record;
begin
  if cardinality(l) <> 1
     or strpos(l[1], '213 de 250 comprobantes (85%)') = 0
     or strpos(l[1], '10 de 1000 requests (1%)') = 0 then
    raise exception 'Task 8: al 85%% del cupo de comprobantes debía salir una línea de cupo con los dos usos, sale %', l;
  end if;

  perform ecf_avisos_diarios();
  if (select count(*) from pg_temp.correos_ecf()) <> antes + 1 then
    raise exception 'Task 8: ecf_avisos_diarios con la demo al 85%% debía encolar un solo correo ecf-avisos';
  end if;
  select * into q from pg_temp.correos_demo() order by id desc limit 1;

  if q.url is distinct from 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/send-lifecycle-email'
     or q.headers ->> 'Authorization' is distinct from
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1) then
    raise exception 'Task 8: el resumen debía llamar a send-lifecycle-email con la llave de Vault, llamó a % ', q.url;
  end if;
  if q.b ->> 'to' is distinct from 'soporte-prueba@sellalles.test'
     or jsonb_typeof(q.b -> 'companyId') is distinct from 'null'
     or q.b ->> 'dedupeKey' is distinct from 'ecf-avisos-' || current_date::text then
    raise exception 'Task 8: el resumen debía ir a support_email, sin empresa y con la clave ecf-avisos-<fecha>, trae %',
      q.b - 'vars';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(q.b) k)
       is distinct from array['companyId', 'dedupeKey', 'template', 'to', 'vars']
     or (select array_agg(k order by k) from jsonb_object_keys(q.b -> 'vars') k)
       is distinct from array['lineas', 'titulo'] then
    raise exception 'Task 8: el correo solo debía llevar titulo y lineas en vars, trae %', q.b;
  end if;
  if q.b -> 'vars' ->> 'titulo' is distinct from 'Avisos de e-CF del ' || to_char(current_date, 'DD/MM/YYYY')
     or jsonb_typeof(q.b -> 'vars' -> 'lineas') is distinct from 'array'
     or not ((q.b -> 'vars' -> 'lineas') @> to_jsonb(l[1])) then
    raise exception 'Task 8: el asunto o las líneas del resumen no son los esperados: %', q.b -> 'vars';
  end if;
  -- Ningún secreto de la demo (las contraseñas de la sección Task 4 empiezan con "clave-").
  if q.b::text like '%clave-%' or q.b::text like '%key-y%' then
    raise exception 'Task 8: el correo no podía llevar secretos';
  end if;
end $t$;

-- El umbral es 80% de cualquiera de los dos cupos, solo del mes en curso.
do $t$
declare
  v_mes date := date_trunc('month', now() at time zone 'utc')::date;
begin
  if pg_temp.cupo_demo(199, 799) <> 0 then
    raise exception 'Task 8: al 79.6%% y al 79.9%% no debía avisar';
  end if;
  if pg_temp.cupo_demo(200, 0) <> 1 then
    raise exception 'Task 8: justo al 80%% de comprobantes debía avisar';
  end if;
  if pg_temp.cupo_demo(0, 800) <> 1 then
    raise exception 'Task 8: justo al 80%% de requests debía avisar';
  end if;
  if pg_temp.cupo_demo(250, 1000) <> 1 then
    raise exception 'Task 8: al 100%% debía avisar';
  end if;
  if pg_temp.cupo_demo(0, 0) <> 0 then
    raise exception 'Task 8: sin uso no debía avisar';
  end if;

  -- Un cupo en cero no se puede medir: no avisa, ni con uso.
  update ecf_config set cupo_comprobantes = 0, cupo_requests = 0
   where company_id = '00000000-0000-0000-0000-0000000000aa';
  if pg_temp.cupo_demo(5, 5) <> 0 then
    raise exception 'Task 8: con el cupo en cero no debía avisar';
  end if;
  update ecf_config set cupo_comprobantes = 250, cupo_requests = 1000
   where company_id = '00000000-0000-0000-0000-0000000000aa';

  -- El 100% del mes pasado ya no cuenta.
  perform pg_temp.cupo_demo(250, 1000);
  update ecf_uso set periodo = (v_mes - interval '1 month')::date
   where company_id = '00000000-0000-0000-0000-0000000000aa' and periodo = v_mes;
  if cardinality(pg_temp.lineas_demo('Cupo:')) <> 0 then
    raise exception 'Task 8: el uso de un mes anterior no debía avisar';
  end if;
  update ecf_uso set periodo = v_mes, comprobantes = 213, requests = 10
   where company_id = '00000000-0000-0000-0000-0000000000aa';
end $t$;

-- Documentos con problema en las últimas 24 horas.
--   ecd1 rechazado ahora                 ecd5 rechazado ahora, ya reemplazado por ecd6
--   ecd2 error_datos hace 2 h            ecd6 por_enviar (el reemplazo)
--   ecd3 sin_cupo hace 23 h              ecd7 aceptado
--   ecd4 rechazado hace 3 días (viejo)   ecd8 creado hace 3 días, rechazado hace 1 hora
select pg_temp.doc_t8('00000000-0000-0000-0000-00000000ecd1', 880001, 'rechazado');
select pg_temp.doc_t8('00000000-0000-0000-0000-00000000ecd2', 880002, 'error_datos', interval '2 hours');
select pg_temp.doc_t8('00000000-0000-0000-0000-00000000ecd3', 880003, 'sin_cupo', interval '23 hours');
select pg_temp.doc_t8('00000000-0000-0000-0000-00000000ecd4', 880004, 'rechazado', interval '3 days');
select pg_temp.doc_t8('00000000-0000-0000-0000-00000000ecd6', 880006, 'por_enviar');
select pg_temp.doc_t8('00000000-0000-0000-0000-00000000ecd5', 880005, 'rechazado');
update ecf_documentos set reemplazado_por = '00000000-0000-0000-0000-00000000ecd6'
 where id = '00000000-0000-0000-0000-00000000ecd5';
select pg_temp.doc_t8('00000000-0000-0000-0000-00000000ecd7', 880007, 'aceptado');
select pg_temp.doc_t8('00000000-0000-0000-0000-00000000ecd8', 880008, 'rechazado', interval '3 days');
update ecf_documentos set estado_at = now() - interval '1 hour'
 where id = '00000000-0000-0000-0000-00000000ecd8';
do $t$
declare
  l  text[] := pg_temp.lineas_demo('Documentos:');
  e  text;
begin
  if cardinality(l) <> 1
     or strpos(l[1], ': 2 rechazados, 1 con error de datos, 1 sin cupo (') = 0 then
    raise exception 'Task 8: debían salir 2 rechazados, 1 con error de datos y 1 sin cupo, sale %', l;
  end if;
  foreach e in array array['E320000880001', 'E320000880002', 'E320000880003', 'E320000880008'] loop
    if strpos(l[1], e) = 0 then
      raise exception 'Task 8: la línea de documentos debía nombrar el %, sale %', e, l;
    end if;
  end loop;
  foreach e in array array['E320000880004', 'E320000880005', 'E320000880006', 'E320000880007'] loop
    if strpos(l[1], e) > 0 then
      raise exception 'Task 8: la línea de documentos no debía nombrar el % (viejo, reemplazado, por enviar o aceptado), sale %', e, l;
    end if;
  end loop;
  if strpos(l[1], ' y otros') > 0 then
    raise exception 'Task 8: con 4 documentos no debía decir "y otros", sale %', l;
  end if;

  -- En singular.
  update ecf_documentos set estado = 'aceptado'
   where id in ('00000000-0000-0000-0000-00000000ecd2', '00000000-0000-0000-0000-00000000ecd3',
                '00000000-0000-0000-0000-00000000ecd8');
  l := pg_temp.lineas_demo('Documentos:');
  if cardinality(l) <> 1 or strpos(l[1], ': 1 rechazado (E320000880001)') = 0 then
    raise exception 'Task 8: con un solo rechazado debía decir "1 rechazado (E320000880001)", sale %', l;
  end if;
  update ecf_documentos set estado = 'error_datos' where id = '00000000-0000-0000-0000-00000000ecd2';
  update ecf_documentos set estado = 'sin_cupo' where id = '00000000-0000-0000-0000-00000000ecd3';
  update ecf_documentos set estado = 'rechazado' where id = '00000000-0000-0000-0000-00000000ecd8';

  -- Con más de cinco documentos se nombran cinco y el resto va como "y otros".
  insert into ecf_documentos (id, company_id, sale_id, tipo_ecf, encf, ambiente, estado, created_at, estado_at)
  select gen_random_uuid(), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ecd0',
         32, 'E32' || lpad((990000 + g)::text, 10, '0'), 'TesteCF', 'sin_cupo', now(), now()
    from generate_series(1, 6) g;
  l := pg_temp.lineas_demo('Documentos:');
  if cardinality(l) <> 1 or strpos(l[1], ' y otros)') = 0 or strpos(l[1], ': 2 rechazados, 1 con error de datos, 7 sin cupo (') = 0 then
    raise exception 'Task 8: con 10 documentos debían salir las cuentas completas y "y otros", sale %', l;
  end if;
  delete from ecf_documentos
   where company_id = '00000000-0000-0000-0000-0000000000aa' and encf like 'E320000990%';
end $t$;

-- Certificados que vencen en 30 días o menos (o que ya vencieron).
do $t$
declare
  c text := '00000000-0000-0000-0000-0000000000aa';
  l text[];
begin
  if cardinality(pg_temp.lineas_demo('Certificado:')) <> 0 then
    raise exception 'Task 8: sin fecha de vencimiento no debía haber aviso de certificado';
  end if;

  update ecf_config set certificado_vence = current_date + 31 where company_id = c::uuid;
  if cardinality(pg_temp.lineas_demo('Certificado:')) <> 0 then
    raise exception 'Task 8: a 31 días del vencimiento no debía avisar';
  end if;

  update ecf_config set certificado_vence = current_date + 30 where company_id = c::uuid;
  l := pg_temp.lineas_demo('Certificado:');
  if cardinality(l) <> 1 or strpos(l[1], 'vence el ' || to_char(current_date + 30, 'DD/MM/YYYY') || ' (en 30 días)') = 0 then
    raise exception 'Task 8: a 30 días del vencimiento debía avisar, sale %', l;
  end if;

  update ecf_config set certificado_vence = current_date + 1 where company_id = c::uuid;
  l := pg_temp.lineas_demo('Certificado:');
  if cardinality(l) <> 1 or strpos(l[1], '(en 1 día)') = 0 then
    raise exception 'Task 8: a un día del vencimiento debía decir "en 1 día", sale %', l;
  end if;

  update ecf_config set certificado_vence = current_date where company_id = c::uuid;
  l := pg_temp.lineas_demo('Certificado:');
  if cardinality(l) <> 1 or strpos(l[1], 'vence hoy') = 0 then
    raise exception 'Task 8: el día del vencimiento debía decir "vence hoy", sale %', l;
  end if;

  update ecf_config set certificado_vence = current_date - 5 where company_id = c::uuid;
  l := pg_temp.lineas_demo('Certificado:');
  if cardinality(l) <> 1 or strpos(l[1], 'venció el ' || to_char(current_date - 5, 'DD/MM/YYYY')) = 0 then
    raise exception 'Task 8: un certificado vencido debía avisar "venció el", sale %', l;
  end if;

  update ecf_config set certificado_vence = null where company_id = c::uuid;
end $t$;

-- Todo junto: un solo correo con las tres clases de aviso, en ese orden.
update ecf_config set certificado_vence = current_date + 10
 where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
declare
  antes   bigint := (select count(*) from pg_temp.correos_ecf());
  q       record;
  v_orden text[];
begin
  perform ecf_avisos_diarios();
  if (select count(*) from pg_temp.correos_ecf()) <> antes + 1 then
    raise exception 'Task 8: aunque haya cupo, documentos y certificado, el resumen debía ser un solo correo';
  end if;
  select * into q from pg_temp.correos_demo() order by id desc limit 1;
  select array_agg(left(t.l, 4) order by t.n) into v_orden
    from jsonb_array_elements_text(q.b -> 'vars' -> 'lineas') with ordinality as t(l, n)
   where position((select name from companies where id = '00000000-0000-0000-0000-0000000000aa') in t.l) > 0;
  if v_orden is distinct from array['Cupo', 'Docu', 'Cert'] then
    raise exception 'Task 8: el resumen debía traer cupo, documentos y certificado de la demo, en ese orden, trae %', v_orden;
  end if;
end $t$;

-- Sin correo de soporte no se manda nada (la tabla no admite uno en blanco: o es
-- un correo válido o es nulo).
do $t$
declare
  antes bigint := (select count(*) from pg_temp.correos_ecf());
begin
  update platform_settings set support_email = null;
  perform ecf_avisos_diarios();
  perform ecf_avisar_sin_cupo('00000000-0000-0000-0000-0000000000aa');
  update platform_settings set support_email = 'soporte-prueba@sellalles.test';
  if (select count(*) from pg_temp.correos_ecf()) <> antes then
    raise exception 'Task 8: sin support_email no debía encolarse ningún correo';
  end if;
end $t$;

-- Sin cupo: aviso urgente de una empresa, con su clave de un correo por mes.
do $t$
declare
  antes bigint := (select count(*) from pg_temp.correos_ecf());
  n     text := (select name from companies where id = '00000000-0000-0000-0000-0000000000aa');
  q     record;
begin
  perform ecf_avisar_sin_cupo('00000000-0000-0000-0000-0000000000aa');
  if (select count(*) from pg_temp.correos_ecf()) <> antes + 1 then
    raise exception 'Task 8: ecf_avisar_sin_cupo debía encolar un correo ecf-avisos';
  end if;
  select * into q from pg_temp.correos_demo() where b ->> 'dedupeKey' like 'ecf-sin-cupo-%' order by id desc limit 1;

  if q.url is distinct from 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/send-lifecycle-email'
     or q.headers ->> 'Authorization' is distinct from
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1) then
    raise exception 'Task 8: el aviso de falta de cupo debía llamar a send-lifecycle-email con la llave de Vault';
  end if;
  if q.b ->> 'to' is distinct from 'soporte-prueba@sellalles.test'
     or q.b ->> 'companyId' is distinct from '00000000-0000-0000-0000-0000000000aa'
     or q.b ->> 'dedupeKey' is distinct from
        'ecf-sin-cupo-00000000-0000-0000-0000-0000000000aa-' || to_char(now() at time zone 'utc', 'YYYYMM') then
    raise exception 'Task 8: el aviso debía ir a support_email, con la empresa y la clave ecf-sin-cupo-<empresa>-<AAAAMM>, trae %',
      q.b - 'vars';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(q.b -> 'vars') k)
       is distinct from array['lineas', 'titulo']
     or position(n in q.b -> 'vars' ->> 'titulo') = 0
     or jsonb_typeof(q.b -> 'vars' -> 'lineas') is distinct from 'array'
     or jsonb_array_length(q.b -> 'vars' -> 'lineas') < 2
     or position('213 de 250 comprobantes' in (q.b -> 'vars' -> 'lineas')::text) = 0
     or position('10 de 1000 requests' in (q.b -> 'vars' -> 'lineas')::text) = 0 then
    raise exception 'Task 8: el aviso de falta de cupo debía nombrar la empresa y su uso del mes, trae %', q.b -> 'vars';
  end if;
  if q.b::text like '%clave-%' or q.b::text like '%key-y%' then
    raise exception 'Task 8: el aviso no podía llevar secretos';
  end if;

  -- Una empresa que no existe no rompe el aviso.
  perform ecf_avisar_sin_cupo(gen_random_uuid());
end $t$;

-- Cron: el resumen diario a las 12:00 UTC.
do $t$
begin
  if (select count(*) from cron.job where jobname = 'ecf-avisos') <> 1
     or (select schedule from cron.job where jobname = 'ecf-avisos') is distinct from '0 12 * * *'
     or (select command from cron.job where jobname = 'ecf-avisos') is distinct from 'select public.ecf_avisos_diarios()'
     or not (select active from cron.job where jobname = 'ecf-avisos') then
    raise exception 'cron: debía existir la tarea ecf-avisos, activa, a las 12:00 con la función del resumen';
  end if;
end $t$;

-- Permisos: del servidor, como las demás.
do $t$
declare f text;
begin
  foreach f in array array[
    'public.ecf_avisar_sin_cupo(uuid)',
    'public._ecf_avisos_lineas()',
    'public.ecf_avisos_diarios()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% no debía ser ejecutable por anon ni authenticated', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% debía ser ejecutable por service_role', f;
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
end $t$;

select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_avisar_sin_cupo('00000000-0000-0000-0000-0000000000aa')$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select ecf_avisos_diarios()$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select _ecf_avisos_lineas()$q$, '%permission denied%');
end $t$;
reset role;
set local role anon;
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_avisos_diarios()$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select ecf_avisar_sin_cupo('00000000-0000-0000-0000-0000000000aa')$q$, '%permission denied%');
end $t$;
reset role;

-- service_role sí puede (es quien las llama; el cron corre como postgres).
set local role service_role;
do $t$
begin
  perform ecf_avisar_sin_cupo('00000000-0000-0000-0000-0000000000aa');
  perform ecf_avisos_diarios();
  if jsonb_typeof(_ecf_avisos_lineas()) is distinct from 'array' then
    raise exception 'service_role debía poder pedir las líneas del resumen';
  end if;
end $t$;
reset role;

-- == Task 9: administración (credenciales, estado y resumen) ==
-- Estado explícito de la sección: super admin; la demo formalizada, con
-- is_demo = true, sin ncf_enabled, con el módulo `ecf` encendido y su ecf_config
-- completa en preparación (TesteCF, sin conexión probada ni activada); sin
-- documentos, secuencias ni uso; y una venta (…ece0) que respalda los
-- documentos de la prueba. Los UUID de la sección: ece0 (venta), ece1–ece5
-- (secuencias), ecf1–ecf9 (documentos).
--
-- Las pruebas de credenciales son de la empresa de prueba …ec0d (creada al
-- principio): nunca lee, cambia ni borra las de la demo ni ningún secreto que ya
-- exista en Vault. Los secretos que agrega se van con el rollback; las
-- credenciales de CerteCF se escriben directo en la tabla, sin Vault.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
update companies set is_formalized = true, ncf_enabled = false, is_demo = true
 where id = '00000000-0000-0000-0000-0000000000aa';
delete from company_modules where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'ecf', true);
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ncf_sequences where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-0000000000aa', 'preparacion', 'TesteCF', '101010101', 'Demo SRL', 'Calle 1, Santo Domingo');
select pg_temp.venta('00000000-0000-0000-0000-00000000ece0', '00000000-0000-0000-0000-0000000000aa',
                     '00000000-0000-0000-0000-0000000000b1');
do $t$
begin
  if not (select is_demo from companies where id = '00000000-0000-0000-0000-0000000000aa') then
    raise exception 'Task 9: el estado de partida debía tener la demo con is_demo = true';
  end if;
end $t$;

-- Secuencia de la demo. Sin p_vence, las E que no son E32 ni E34 vencen en 2099
-- (la base no las acepta sin vencimiento).
create function pg_temp.seq_t9(p_id uuid, p_tipo text, p_prefix text, p_electronica boolean,
                               p_activa boolean default true, p_actual bigint default 1,
                               p_hasta bigint default 100, p_vence date default null) returns void
language sql as $$
  insert into ncf_sequences (id, company_id, tipo, prefix, range_from, range_to, current_val,
                             electronica, active, expires_at)
  values (p_id, '00000000-0000-0000-0000-0000000000aa', p_tipo, p_prefix, 1, p_hasta, p_actual,
          p_electronica, p_activa,
          coalesce(p_vence, case when p_electronica and p_prefix not in ('E32', 'E34') then date '2099-12-31' end));
$$;

-- Documento de la demo (venta ece0): e-NCF E32 + 10 dígitos.
create function pg_temp.doc_t9(p_id uuid, p_n int, p_estado text, p_reemplazado uuid default null) returns void
language sql as $$
  insert into ecf_documentos (id, company_id, sale_id, tipo_ecf, encf, ambiente, estado, reemplazado_por)
  values (p_id, '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ece0', 32,
          'E32' || lpad(p_n::text, 10, '0'), 'TesteCF', p_estado, p_reemplazado);
$$;

create function pg_temp.cfg_t9() returns ecf_config language sql as $$
  select * from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa'
$$;

-- Permisos: las tres del panel las ejecuta authenticated (no anon ni PUBLIC);
-- los disparadores no los ejecuta nadie más que la base.
do $t$
declare f text;
begin
  foreach f in array array[
    'public.ecf_cambiar_estado(uuid,text)',
    'public.ecf_credenciales_guardadas(uuid)',
    'public.ecf_resumen_plataforma()'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'Task 9: % no debía ser ejecutable por anon', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'Task 9: % debía ser ejecutable por authenticated (el panel la llama)', f;
    end if;
    if (select proacl is null from pg_proc where oid = f::regprocedure)
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                   where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'Task 9: % no debía ser ejecutable por PUBLIC', f;
    end if;
    if not coalesce((select prosecdef and proconfig @> array['search_path=public']
                       from pg_proc where oid = f::regprocedure), false) then
      raise exception 'Task 9: % debía ser security definer con search_path = public', f;
    end if;
  end loop;

  foreach f in array array[
    'public.ecf_config_ambiente_cambia()',
    'public.ecf_credenciales_cambian()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'Task 9: % no debía ser ejecutable por anon ni authenticated', f;
    end if;
    if (select proacl is null from pg_proc where oid = f::regprocedure)
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                   where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'Task 9: % no debía ser ejecutable por PUBLIC', f;
    end if;
  end loop;
end $t$;

-- ecf_cambiar_estado: cada requisito para pasar a activa, en el orden en que se
-- piden. Cada intento que falla deja la empresa en preparación.
-- 1. Formalizada.
update companies set is_formalized = false where id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'La empresa no está formalizada.');
end $t$;
update companies set is_formalized = true where id = '00000000-0000-0000-0000-0000000000aa';

-- 2. Módulo encendido: ni apagado ni ausente.
update company_modules set enabled = false
 where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'El módulo de facturación electrónica está apagado.');
end $t$;
delete from company_modules
 where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'El módulo de facturación electrónica está apagado.');
end $t$;
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'ecf', true);

-- 3. Datos del emisor: RNC, razón social y dirección, y que exista la configuración.
update ecf_config set rnc_emisor = null where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'Faltan datos del emisor (RNC, razón social o dirección).');
end $t$;
update ecf_config set rnc_emisor = '101010101', razon_social = '   '
 where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'Faltan datos del emisor (RNC, razón social o dirección).');
end $t$;
update ecf_config set razon_social = 'Demo SRL', direccion = ''
 where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'Faltan datos del emisor (RNC, razón social o dirección).');
end $t$;
update ecf_config set direccion = 'Calle 1, Santo Domingo' where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'Faltan datos del emisor (RNC, razón social o dirección).');
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'suspendida')$q$,
    'La empresa no tiene configuración de e-CF.');
end $t$;
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-0000000000aa', 'preparacion', 'TesteCF', '101010101', 'Demo SRL', 'Calle 1, Santo Domingo');

-- 4. Conexión probada.
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'La conexión con el proveedor no se ha probado.');
end $t$;
update ecf_config set conexion_probada_at = now() where company_id = '00000000-0000-0000-0000-0000000000aa';

-- 5. Una secuencia E32 vigente. Ninguna de estas lo es: la serie B, una E32
-- inactiva, una agotada, una vencida ayer y una E31.
select pg_temp.seq_t9('00000000-0000-0000-0000-00000000ece1', 'consumer', 'B02', false);
select pg_temp.seq_t9('00000000-0000-0000-0000-00000000ece2', 'consumer', 'E32', true, false);
select pg_temp.seq_t9('00000000-0000-0000-0000-00000000ece3', 'consumer', 'E32', true, true, 101, 100);
select pg_temp.seq_t9('00000000-0000-0000-0000-00000000ece4', 'consumer', 'E32', true, true, 1, 100,
                      company_today('00000000-0000-0000-0000-0000000000aa') - 1);
select pg_temp.seq_t9('00000000-0000-0000-0000-00000000ece5', 'fiscal', 'E31', true);
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'No hay una secuencia E32 vigente.');
end $t$;
-- Vence hoy: todavía vale (igual que en assign_ncf).
update ncf_sequences set expires_at = company_today('00000000-0000-0000-0000-0000000000aa')
 where id = '00000000-0000-0000-0000-00000000ece4';

-- 6. Ambiente de pruebas: solo la demo. Cambiar el ambiente borra la prueba de
-- conexión, así que se vuelve a marcar.
update companies set is_demo = false where id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if (select is_demo from companies where id = '00000000-0000-0000-0000-0000000000aa') then
    raise exception 'Task 9: no se pudo poner is_demo = false en la demo para la prueba';
  end if;
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'Solo la empresa demo puede activarse en un ambiente de pruebas.');
end $t$;
update ecf_config set ambiente = 'CerteCF' where company_id = '00000000-0000-0000-0000-0000000000aa';
update ecf_config set conexion_probada_at = now() where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'Solo la empresa demo puede activarse en un ambiente de pruebas.');
  if (pg_temp.cfg_t9()).estado is distinct from 'preparacion' then
    raise exception 'Task 9: los intentos que fallan no debían cambiar el estado, quedó en %', (pg_temp.cfg_t9()).estado;
  end if;
end $t$;

-- Una empresa real en producción sí puede activarse: todo listo y ambiente eCF.
update ecf_config set ambiente = 'eCF' where company_id = '00000000-0000-0000-0000-0000000000aa';
update ecf_config set conexion_probada_at = now() where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
declare c ecf_config;
begin
  perform ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa');
  c := pg_temp.cfg_t9();
  if c.estado is distinct from 'activa' or c.activada_at is null
     or ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'Task 9: una empresa no demo en eCF con todo listo debía quedar activa con activada_at, quedó (%, %)',
      c.estado, c.activada_at;
  end if;
  perform ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'preparacion');
  if (pg_temp.cfg_t9()).estado is distinct from 'preparacion' then
    raise exception 'Task 9: volver a preparación debía funcionar sin pedir nada';
  end if;
end $t$;

-- La demo, de nuevo con is_demo y en TesteCF, lista para activar.
update companies set is_demo = true where id = '00000000-0000-0000-0000-0000000000aa';
update ecf_config set ambiente = 'TesteCF', activada_at = null where company_id = '00000000-0000-0000-0000-0000000000aa';
update ecf_config set conexion_probada_at = now() where company_id = '00000000-0000-0000-0000-0000000000aa';

-- Quién puede: un admin normal de otra empresa no, aunque todo esté listo; anon
-- tampoco. Nada cambia.
select pg_temp.como('cc56c633-4b6c-4a8e-a7e8-6ee3a1934566');
set local role authenticated;
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'Solo el administrador de la plataforma puede cambiar el estado de la facturación electrónica.');
  perform pg_temp.debe_fallar($q$select ecf_credenciales_guardadas('00000000-0000-0000-0000-0000000000aa')$q$,
    'Solo el administrador de la plataforma puede ver las credenciales de e-CF guardadas.');
  perform pg_temp.debe_fallar($q$select * from ecf_resumen_plataforma()$q$,
    'Solo el administrador de la plataforma puede ver el resumen de e-CF.');
end $t$;
reset role;
set local role anon;
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select ecf_credenciales_guardadas('00000000-0000-0000-0000-0000000000aa')$q$, '%permission denied%');
  perform pg_temp.debe_fallar($q$select * from ecf_resumen_plataforma()$q$, '%permission denied%');
end $t$;
reset role;
do $t$
begin
  if (pg_temp.cfg_t9()).estado is distinct from 'preparacion' or (pg_temp.cfg_t9()).activada_at is not null then
    raise exception 'Task 9: quien no es super admin no podía cambiar el estado';
  end if;
end $t$;

-- El super admin, con la sesión real (authenticated), activa la demo en TesteCF.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa');
reset role;
do $t$
declare c ecf_config;
begin
  c := pg_temp.cfg_t9();
  if c.estado is distinct from 'activa' or c.activada_at is null or c.ambiente is distinct from 'TesteCF'
     or ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from true then
    raise exception 'Task 9: la demo en TesteCF con todo listo debía quedar activa con activada_at, quedó (%, %, %)',
      c.estado, c.ambiente, c.activada_at;
  end if;
end $t$;

-- Estado ya activa: pedirlo otra vez no cambia nada (ni activada_at).
update ecf_config set activada_at = now() - interval '1 day' where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
declare antes timestamptz := (pg_temp.cfg_t9()).activada_at;
begin
  perform ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa');
  if (pg_temp.cfg_t9()).activada_at is distinct from antes then
    raise exception 'Task 9: pedir activa estando activa no debía mover activada_at';
  end if;

  -- Suspender: sin pedir nada y conservando activada_at.
  perform ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'suspendida');
  if (pg_temp.cfg_t9()).estado is distinct from 'suspendida' or (pg_temp.cfg_t9()).activada_at is distinct from antes
     or ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from false then
    raise exception 'Task 9: suspender debía dejar la empresa suspendida, sin e-CF activo y con su activada_at';
  end if;

  -- Reactivar vuelve a pedir todo: sin módulo no pasa.
  update company_modules set enabled = false
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa')$q$,
    'El módulo de facturación electrónica está apagado.');
  update company_modules set enabled = true
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';

  -- Con todo listo reactiva y pone la fecha de la nueva activación.
  perform ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'activa');
  if (pg_temp.cfg_t9()).estado is distinct from 'activa' or (pg_temp.cfg_t9()).activada_at <= antes then
    raise exception 'Task 9: reactivar debía dejarla activa con una activada_at más reciente que la anterior';
  end if;
end $t$;

-- Estados y empresas que no existen.
do $t$
begin
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'pausada')$q$,
    'El estado de e-CF no es válido: pausada.');
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', null)$q$,
    'El estado de e-CF no es válido: vacío.');
  perform pg_temp.debe_fallar($q$select ecf_cambiar_estado(gen_random_uuid(), 'activa')$q$,
    'La empresa no existe.');
end $t$;

-- La prueba de conexión vale para lo que se probó: ambiente y credenciales. En
-- la empresa de prueba …ec0d, con su propia ecf_config en preparación (TesteCF).
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-00000000ec0d', 'preparacion', 'TesteCF', '303030303', 'Credenciales SRL', 'Calle 3');
create function pg_temp.probada_t9() returns timestamptz language sql as $$
  select conexion_probada_at from ecf_config where company_id = '00000000-0000-0000-0000-00000000ec0d'
$$;
select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0d', 'eCF',
                                'ecf+t9@sellalles.com', 'clave-t9', 'key-t9');
insert into ecf_credenciales (company_id, ambiente, email)
values ('00000000-0000-0000-0000-00000000ec0d', 'CerteCF', 'ecf+cert@sellalles.com');
do $t$
declare c text := '00000000-0000-0000-0000-00000000ec0d';
begin
  -- La empresa está en TesteCF y esta marca es de TesteCF: guardar credenciales
  -- de otros ambientes no la toca.
  update ecf_config set conexion_probada_at = now() where company_id = c::uuid;
  perform ecf_guardar_credenciales(c::uuid, 'eCF', 'ecf+t9@sellalles.com', 'clave-t9', 'key-t9');
  update ecf_credenciales set email = 'ecf+cert2@sellalles.com' where company_id = c::uuid and ambiente = 'CerteCF';
  if pg_temp.probada_t9() is null then
    raise exception 'Task 9: guardar credenciales de otro ambiente no debía borrar la prueba de conexión';
  end if;

  -- Cambiar el ambiente de la empresa la borra; dejarlo igual, no.
  update ecf_config set ambiente = 'TesteCF', plan = 'basico' where company_id = c::uuid;
  if pg_temp.probada_t9() is null then
    raise exception 'Task 9: dejar el mismo ambiente y cambiar otra columna no debía borrar la prueba de conexión';
  end if;
  update ecf_config set ambiente = 'eCF' where company_id = c::uuid;
  if pg_temp.probada_t9() is not null then
    raise exception 'Task 9: cambiar el ambiente de la empresa debía borrar la prueba de conexión';
  end if;

  -- Con la empresa en eCF: guardar la sesión no borra la marca; guardar otras
  -- credenciales de eCF sí (también si solo cambia el correo).
  update ecf_config set conexion_probada_at = now() where company_id = c::uuid;
  perform ecf_guardar_sesion(c::uuid, 'eCF', 'tok-t9', now() + interval '1 hour', 'ref-t9', 'sub-t9');
  if pg_temp.probada_t9() is null then
    raise exception 'Task 9: guardar la sesión no debía borrar la prueba de conexión';
  end if;
  perform ecf_guardar_credenciales(c::uuid, 'eCF', 'ecf+t9@sellalles.com', 'clave-t9-nueva', 'key-t9');
  if pg_temp.probada_t9() is not null then
    raise exception 'Task 9: guardar otras credenciales del ambiente en uso debía borrar la prueba de conexión';
  end if;
  update ecf_config set conexion_probada_at = now() where company_id = c::uuid;
  update ecf_credenciales set email = 'ecf+otro@sellalles.com' where company_id = c::uuid and ambiente = 'eCF';
  if pg_temp.probada_t9() is not null then
    raise exception 'Task 9: cambiar el correo de las credenciales del ambiente en uso debía borrar la prueba de conexión';
  end if;
  update ecf_config set conexion_probada_at = now() where company_id = c::uuid;
  update ecf_credenciales set id_token = 'otro-token' where company_id = c::uuid and ambiente = 'eCF';
  if pg_temp.probada_t9() is null then
    raise exception 'Task 9: cambiar solo el token de la sesión no debía borrar la prueba de conexión';
  end if;

  -- De vuelta a TesteCF, ya con la conexión probada.
  update ecf_config set ambiente = 'TesteCF' where company_id = c::uuid;
  update ecf_config set conexion_probada_at = now() where company_id = c::uuid;
end $t$;

-- ecf_credenciales_guardadas: el super admin, con la sesión real, ve los
-- ambientes, el correo y la fecha; nunca un secreto.
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
declare
  c   text := '00000000-0000-0000-0000-00000000ec0d';
  r   jsonb;
  n   int;
  llaves text[];
begin
  select count(*), jsonb_agg(to_jsonb(g) order by g.ambiente) into n, r from ecf_credenciales_guardadas(c::uuid) g;
  if n <> 2 or (select array_agg(x ->> 'ambiente' order by x ->> 'ambiente') from jsonb_array_elements(r) x)
               is distinct from array['CerteCF', 'eCF'] then
    raise exception 'Task 9: debía listar CerteCF y eCF, listó %', r;
  end if;
  if (r -> 0 ->> 'email') is distinct from 'ecf+cert2@sellalles.com'
     or (r -> 1 ->> 'email') is distinct from 'ecf+otro@sellalles.com'
     or (r -> 0 ->> 'updated_at') is null or (r -> 1 ->> 'updated_at') is null then
    raise exception 'Task 9: cada ambiente debía traer su correo y su fecha, trae %', r;
  end if;
  select array_agg(k order by k) into llaves from jsonb_object_keys(r -> 0) k;
  if llaves is distinct from array['ambiente', 'email', 'updated_at'] then
    raise exception 'Task 9: solo debía devolver ambiente, email y updated_at, devuelve %', llaves;
  end if;
  if r::text like '%clave-t9%' or r::text like '%key-t9%' or r::text like '%tok-t9%' or r::text like '%ref-t9%' then
    raise exception 'Task 9: la lista no podía llevar secretos';
  end if;
  if (select count(*) from ecf_credenciales_guardadas(gen_random_uuid())) <> 0 then
    raise exception 'Task 9: una empresa sin credenciales debía dar una lista vacía';
  end if;
end $t$;
reset role;

-- ecf_resumen_plataforma, con la demo activa en TesteCF y sin uso ni documentos.
update ecf_config set estado = 'activa', plan = 'gratis', certificado_vence = null
 where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
declare
  r record;
begin
  if (select count(*) from ecf_resumen_plataforma() x where x.company_id = '00000000-0000-0000-0000-0000000000aa') <> 1 then
    raise exception 'Task 9: el resumen debía traer una sola fila de la demo';
  end if;
  select * into r from ecf_resumen_plataforma() x where x.company_id = '00000000-0000-0000-0000-0000000000aa';
  if r.empresa is distinct from (select name from companies where id = '00000000-0000-0000-0000-0000000000aa')
     or (r.estado, r.ambiente, r.plan, r.cupo_comprobantes, r.cupo_requests)
        is distinct from ('activa', 'TesteCF', 'gratis', 250, 1000)
     or (r.comprobantes, r.requests, r.pendientes, r.problemas) is distinct from (0, 0, 0, 0)
     or r.certificado_vence is not null then
    raise exception 'Task 9: la demo sin uso ni documentos debía salir con ceros y su configuración, sale %', to_jsonb(r);
  end if;
end $t$;
reset role;

-- Documentos de la demo:
--   ecf1 por_enviar, ecf2 enviando, ecf3 recibido, ecf9 por_enviar (el reemplazo de ecf8)
--                                                                    -> 4 pendientes
--   ecf4 aceptado, ecf5 aceptado_condicional                         -> no cuentan
--   ecf6 rechazado, ecf7 error_datos, ecfa sin_cupo                  -> 3 problemas
--   ecf8 rechazado, ya reemplazado por ecf9                          -> no es problema
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf9', 910009, 'por_enviar');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf1', 910001, 'por_enviar');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf2', 910002, 'enviando');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf3', 910003, 'recibido');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf4', 910004, 'aceptado');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf5', 910005, 'aceptado_condicional');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf6', 910006, 'rechazado');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf7', 910007, 'error_datos');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecfa', 910010, 'sin_cupo');
select pg_temp.doc_t9('00000000-0000-0000-0000-00000000ecf8', 910008, 'rechazado',
                      '00000000-0000-0000-0000-00000000ecf9');
-- Uso: el mes en curso cuenta; el anterior, no.
insert into ecf_uso (company_id, periodo, comprobantes, requests)
values ('00000000-0000-0000-0000-0000000000aa', date_trunc('month', now() at time zone 'utc')::date, 7, 11),
       ('00000000-0000-0000-0000-0000000000aa', (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date, 99, 98);
update ecf_config set plan = 'basico', cupo_comprobantes = 1000, cupo_requests = 5000,
                      certificado_vence = date '2027-05-01'
 where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
set local role authenticated;
do $t$
declare
  r record;
begin
  select * into r from ecf_resumen_plataforma() x where x.company_id = '00000000-0000-0000-0000-0000000000aa';
  if (r.estado, r.ambiente, r.plan, r.cupo_comprobantes, r.cupo_requests)
        is distinct from ('activa', 'TesteCF', 'basico', 1000, 5000)
     or r.certificado_vence is distinct from date '2027-05-01' then
    raise exception 'Task 9: el resumen debía traer el plan, el cupo y el certificado de la demo, trae %', to_jsonb(r);
  end if;
  if (r.comprobantes, r.requests) is distinct from (7, 11) then
    raise exception 'Task 9: el resumen debía traer solo el uso del mes en curso (7 y 11), trae % y %',
      r.comprobantes, r.requests;
  end if;
  if r.pendientes is distinct from 4 then
    raise exception 'Task 9: debían ser 4 pendientes (por enviar x2, enviando y recibido), son %', r.pendientes;
  end if;
  if r.problemas is distinct from 3 then
    raise exception 'Task 9: debían ser 3 problemas (rechazado, error de datos y sin cupo; el reemitido no cuenta), son %',
      r.problemas;
  end if;
end $t$;
reset role;

-- == Revisión final: 20261030180000_ecf_ajustes_revision_final.sql ==
-- Estado explícito de la sección: super admin; la demo formalizada, sin
-- ncf_enabled, con el módulo `ecf` y su ecf_config activa en TesteCF; sin
-- documentos, uso ni secuencias propias; la sucursal b1 sin RNC; dos ventas sin
-- NCF (…ec9a, …ec9b) que respaldan los documentos de la prueba (se crean con el
-- e-CF en preparación, para que no reciban e-NCF). La otra empresa es …ec0a
-- (su venta …ec99); las credenciales, de …ec0e (su venta …ec9c).
-- UUID de la sección: ec99 y ec9a–ec9e (ventas), ec5a–ec5f (secuencias), ec1a–ec1c,
-- ec24–ec2b y ec6a–ec6f, ec7a–ec7f (documentos).
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
update companies set is_formalized = true, ncf_enabled = false where id = '00000000-0000-0000-0000-0000000000aa';
update branches set rnc = null where id = '00000000-0000-0000-0000-0000000000b1';
delete from company_modules where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
insert into company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'ecf', true);
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ecf_uso where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ncf_sequences where company_id = '00000000-0000-0000-0000-0000000000aa';
delete from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa';
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion)
values ('00000000-0000-0000-0000-0000000000aa', 'preparacion', 'TesteCF', '101010101', 'Demo SRL', 'Calle 1, Santo Domingo');
select pg_temp.venta('00000000-0000-0000-0000-00000000ec9a', '00000000-0000-0000-0000-0000000000aa',
                     '00000000-0000-0000-0000-0000000000b1');
select pg_temp.venta('00000000-0000-0000-0000-00000000ec9b', '00000000-0000-0000-0000-0000000000aa',
                     '00000000-0000-0000-0000-0000000000b1');
select pg_temp.venta('00000000-0000-0000-0000-00000000ec9c', '00000000-0000-0000-0000-00000000ec0e', null);
select pg_temp.venta('00000000-0000-0000-0000-00000000ec99', '00000000-0000-0000-0000-00000000ec0a', null);
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';
do $t$
begin
  if ecf_activa('00000000-0000-0000-0000-0000000000aa') is distinct from true
     or pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec9a') is not null then
    raise exception 'Revisión final: el estado de partida debía tener e-CF activo y las ventas de apoyo sin NCF';
  end if;
end $t$;

-- Documento de la prueba: estado, cuándo se creó, cuándo se envió y cuándo se
-- consultó (hace cuánto; null = nunca), de la demo y su venta …ec9a salvo que se diga otra.
create function pg_temp.doc_rf(p_id uuid, p_n int, p_estado text,
                               p_creado interval default interval '1 hour',
                               p_enviado interval default null,
                               p_consultado interval default null,
                               p_company uuid default '00000000-0000-0000-0000-0000000000aa',
                               p_ambiente text default 'TesteCF',
                               p_sale uuid default '00000000-0000-0000-0000-00000000ec9a') returns void
language sql as $$
  insert into ecf_documentos (id, company_id, sale_id, tipo_ecf, encf, ambiente, estado,
                              created_at, estado_at, enviado_at, ultima_consulta_at)
  values (p_id, p_company, p_sale, 32, 'E32' || lpad(p_n::text, 10, '0'), p_ambiente, p_estado,
          now() - p_creado, now() - p_creado, now() - p_enviado, now() - p_consultado);
$$;

-- I1: con la empresa activa no se cambia el ambiente; en preparación o
-- suspendida sí, y la prueba de conexión se borra.
do $t$
declare demo uuid := '00000000-0000-0000-0000-0000000000aa'; e text;
begin
  perform pg_temp.debe_fallar(
    $q$update ecf_config set ambiente = 'eCF' where company_id = '00000000-0000-0000-0000-0000000000aa'$q$,
    'Pasa la empresa a preparación antes de cambiar el ambiente.');
  -- Tampoco en la misma sentencia que la saca de activa: cuenta el estado que tenía.
  perform pg_temp.debe_fallar(
    $q$update ecf_config set estado = 'preparacion', ambiente = 'eCF' where company_id = '00000000-0000-0000-0000-0000000000aa'$q$,
    'Pasa la empresa a preparación antes de cambiar el ambiente.');
  -- Repetir el mismo ambiente no es cambiarlo.
  update ecf_config set ambiente = 'TesteCF', plan = 'basico' where company_id = demo;
  if (select plan from ecf_config where company_id = demo) <> 'basico'
     or (select estado from ecf_config where company_id = demo) <> 'activa' then
    raise exception 'I1: con el mismo ambiente, cambiar otra columna de una empresa activa debía funcionar';
  end if;
  foreach e in array array['preparacion', 'suspendida'] loop
    update ecf_config set estado = e, conexion_probada_at = now() where company_id = demo;
    update ecf_config set ambiente = 'CerteCF' where company_id = demo;
    if (select ambiente from ecf_config where company_id = demo) <> 'CerteCF'
       or (select conexion_probada_at from ecf_config where company_id = demo) is not null then
      raise exception 'I1: en % el ambiente debía cambiar y borrar la prueba de conexión', e;
    end if;
    update ecf_config set ambiente = 'TesteCF' where company_id = demo;
  end loop;
  update ecf_config set estado = 'activa', plan = 'gratis' where company_id = demo;
end $t$;

-- I1: desde la API (authenticated), aun el super admin, solo se escriben los
-- datos de ecf_config. El estado y las marcas los cambian las funciones; el
-- updated_at, el disparador; company_id solo se escribe al crear la fila.
insert into ecf_config (company_id, rnc_emisor, razon_social, direccion, updated_at)
values ('00000000-0000-0000-0000-00000000ec0e', '404040404', 'Prueba SRL', 'Calle 4', '2020-01-01');
do $t$
declare c text;
begin
  foreach c in array array['estado', 'conexion_probada_at', 'activada_at', 'updated_at', 'company_id'] loop
    if has_column_privilege('authenticated', 'public.ecf_config', c, 'update') then
      raise exception 'I1: authenticated no debía poder escribir ecf_config.%', c;
    end if;
  end loop;
  foreach c in array array['rnc_emisor', 'razon_social', 'nombre_comercial', 'direccion', 'ambiente', 'plan',
                           'cupo_comprobantes', 'cupo_requests', 'minutos_entre_consultas', 'certificado_vence'] loop
    if not has_column_privilege('authenticated', 'public.ecf_config', c, 'update')
       or not has_column_privilege('authenticated', 'public.ecf_config', c, 'insert') then
      raise exception 'I1: authenticated debía poder escribir ecf_config.%', c;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.ecf_config', 'company_id', 'insert')
     or has_column_privilege('authenticated', 'public.ecf_config', 'estado', 'insert') then
    raise exception 'I1: al crear la fila authenticated debía escribir company_id y no el estado';
  end if;
end $t$;
set local role authenticated;
do $t$
declare c text;
begin
  foreach c in array array['estado', 'conexion_probada_at', 'activada_at', 'company_id'] loop
    perform pg_temp.debe_fallar(
      format($q$update ecf_config set %I = %s where company_id = '00000000-0000-0000-0000-0000000000aa'$q$, c,
             case c when 'estado' then quote_literal('preparacion')
                    when 'company_id' then quote_literal('00000000-0000-0000-0000-00000000ec0b')
                    else 'now()' end),
      '%permission denied%');
  end loop;

  -- Lo que guarda el panel (ecf-config-dialog): un update con las columnas de datos.
  update ecf_config
     set rnc_emisor = '404040404', razon_social = 'Prueba SRL', nombre_comercial = 'Prueba', direccion = 'Calle 4',
         ambiente = 'CerteCF', plan = 'basico', cupo_comprobantes = 1000, cupo_requests = 5000,
         minutos_entre_consultas = 30, certificado_vence = date '2027-01-01'
   where company_id = '00000000-0000-0000-0000-00000000ec0e';
  if (select (plan, ambiente, nombre_comercial, certificado_vence) from ecf_config
       where company_id = '00000000-0000-0000-0000-00000000ec0e')
     is distinct from ('basico'::text, 'CerteCF'::text, 'Prueba'::text, date '2027-01-01') then
    raise exception 'I1: el super admin debía poder guardar los datos de ecf_config';
  end if;
  if (select updated_at from ecf_config where company_id = '00000000-0000-0000-0000-00000000ec0e') is distinct from now() then
    raise exception 'I1: el disparador debía seguir poniendo updated_at al guardar desde la API';
  end if;

  -- Y al crear la fila, un insert con company_id y los datos; el estado sale por omisión.
  insert into ecf_config (company_id, rnc_emisor, razon_social, nombre_comercial, direccion, ambiente, plan,
                          cupo_comprobantes, cupo_requests, minutos_entre_consultas, certificado_vence)
  values ('00000000-0000-0000-0000-00000000ec0b', '505050505', 'Nueva SRL', null, 'Calle 5', 'TesteCF', 'gratis',
          250, 1000, 60, null);
  if (select estado from ecf_config where company_id = '00000000-0000-0000-0000-00000000ec0b') is distinct from 'preparacion' then
    raise exception 'I1: la fila creada desde la API debía empezar en preparación';
  end if;
  perform pg_temp.debe_fallar(
    $q$insert into ecf_config (company_id, estado, rnc_emisor, razon_social, direccion)
       values ('00000000-0000-0000-0000-00000000ec0d', 'activa', '606060606', 'Intento', 'Calle 6')$q$,
    '%permission denied%');
  -- El upsert de PostgREST reescribe cada columna que manda, company_id incluido:
  -- por eso el panel hace insert o update y no upsert.
  perform pg_temp.debe_fallar(
    $q$insert into ecf_config (company_id, rnc_emisor, razon_social, direccion)
       values ('00000000-0000-0000-0000-00000000ec0e', '404040404', 'Prueba SRL', 'Calle 4')
       on conflict (company_id) do update
         set company_id = excluded.company_id, rnc_emisor = excluded.rnc_emisor,
             razon_social = excluded.razon_social, direccion = excluded.direccion$q$,
    '%permission denied%');

  -- El estado sí cambia con ecf_cambiar_estado (security definer).
  perform ecf_cambiar_estado('00000000-0000-0000-0000-0000000000aa', 'suspendida');
  if (select estado from ecf_config where company_id = '00000000-0000-0000-0000-0000000000aa') <> 'suspendida' then
    raise exception 'I1: ecf_cambiar_estado debía poder cambiar el estado';
  end if;
end $t$;
reset role;
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';

-- I3: el e-NCF de una venta guardada no se cambia ni se escribe a mano. …ec9d
-- recibe un E32 del sistema; …ec9e trae una B (de antes del e-CF).
select pg_temp.secuencia('consumer', 'E32', true, 8000, 8100);
select pg_temp.venta_ncf('00000000-0000-0000-0000-00000000ec9d', false);
select pg_temp.venta_b('00000000-0000-0000-0000-00000000ec9e', 'B0200000077');
do $t$
declare e text; ncf0 text := pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec9d');
begin
  if ncf0 is distinct from 'E320000008000' or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec9d') <> 1 then
    raise exception 'I3: la venta debía recibir E320000008000 del sistema, dio %', ncf0;
  end if;
  -- e-NCF -> otro e-NCF, -> una B o -> nada.
  foreach e in array array['''E320000008099''', '''B0200000001''', 'null'] loop
    perform pg_temp.debe_fallar(
      format($q$update sales set ncf = %s where id = '00000000-0000-0000-0000-00000000ec9d'$q$, e),
      'El número de comprobante electrónico lo asigna el sistema.');
  end loop;
  -- B -> e-NCF, y sin NCF -> e-NCF.
  perform pg_temp.debe_fallar(
    $q$update sales set ncf = 'E320000008098' where id = '00000000-0000-0000-0000-00000000ec9e'$q$,
    'El número de comprobante electrónico lo asigna el sistema.');
  perform pg_temp.debe_fallar(
    $q$update sales set ncf = 'E320000008097' where id = '00000000-0000-0000-0000-00000000ec9a'$q$,
    'El número de comprobante electrónico lo asigna el sistema.');
  -- Lo demás de la venta se sigue cambiando, y repetir el mismo NCF no es cambiarlo.
  update sales set ncf = ncf, amount_paid = amount_paid where id = '00000000-0000-0000-0000-00000000ec9d';
  -- Una B se corrige como hoy.
  update sales set ncf = 'B0200000078' where id = '00000000-0000-0000-0000-00000000ec9e';
  if pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec9d') is distinct from ncf0
     or pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec9e') is distinct from 'B0200000078'
     or pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec9a') is not null then
    raise exception 'I3: los cambios rechazados no debían tocar las ventas; la B sí debía cambiar';
  end if;
  -- Fuera de reemitir_ecf la marca está apagada.
  if coalesce(current_setting('sellalles.reemitiendo_ecf', true), '') = 'on' then
    raise exception 'I3: la marca de reemisión no debía estar encendida';
  end if;
end $t$;

-- Tampoco desde la API. Hoy el rol authenticated solo tiene SELECT e INSERT en
-- sales (no UPDATE): la venta cambia únicamente por funciones security definer,
-- y un UPDATE directo ya muere en el permiso de la tabla. Si algún día se le
-- diera UPDATE a authenticated, el disparador es el que debe pararlo.
set local role authenticated;
do $t$
begin
  perform pg_temp.debe_fallar(
    $q$update sales set ncf = 'E320000008095' where id = '00000000-0000-0000-0000-00000000ec9d'$q$,
    case when has_table_privilege('authenticated', 'public.sales', 'UPDATE')
         then 'El número de comprobante electrónico lo asigna el sistema.'
         else '%permission denied%' end);
  perform pg_temp.debe_fallar(
    $q$insert into sales (id, company_id, branch_id, subtotal, itbis_amount, total, payment_method,
                          payment_status, amount_paid, ncf)
       values ('00000000-0000-0000-0000-00000000ec9f', '00000000-0000-0000-0000-0000000000aa',
               '00000000-0000-0000-0000-0000000000b1', 100, 0, 100, 'transfer', 'paid', 100, 'E320000008094')$q$,
    'El número de comprobante electrónico lo asigna el sistema.');
end $t$;
reset role;

-- reemitir_ecf sigue cambiando el e-NCF (con su marca), y la marca no queda
-- encendida después.
update ecf_documentos set estado = 'rechazado' where sale_id = '00000000-0000-0000-0000-00000000ec9d';
set local role authenticated;
do $t$
declare r jsonb;
begin
  r := reemitir_ecf('00000000-0000-0000-0000-00000000ec9d');
  perform set_config('ecf.rf_reemision', r::text, true);
end $t$;
reset role;
do $t$
declare r jsonb := current_setting('ecf.rf_reemision')::jsonb;
begin
  if (r->>'encf') is distinct from 'E320000008001'
     or pg_temp.ncf_de('00000000-0000-0000-0000-00000000ec9d') is distinct from 'E320000008001'
     or pg_temp.docs_de('00000000-0000-0000-0000-00000000ec9d') <> 2 then
    raise exception 'I3: reemitir_ecf debía seguir poniendo el e-NCF nuevo en la venta, dio %', r;
  end if;
  if coalesce(current_setting('sellalles.reemitiendo_ecf', true), '') = 'on' then
    raise exception 'I3: reemitir_ecf debía apagar su marca al terminar';
  end if;
  perform pg_temp.debe_fallar(
    $q$update sales set ncf = 'E320000008093' where id = '00000000-0000-0000-0000-00000000ec9d'$q$,
    'El número de comprobante electrónico lo asigna el sistema.');
end $t$;

-- I3: el disparador nuevo es solo de la base.
do $t$
declare f text := 'public.ecf_proteger_ncf_venta()';
begin
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                 where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'I3: ecf_proteger_ncf_venta no debía ser ejecutable por PUBLIC, anon ni authenticated';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.sales'::regclass and tgname = 'trg_ecf_proteger_ncf'
                    and tgfoid = f::regprocedure and not tgisinternal
                    and tgtype & 2 = 2      -- BEFORE
                    and tgtype & 16 = 16    -- UPDATE
                    and tgattr::text <> '') then
    raise exception 'I3: faltaba el disparador BEFORE UPDATE OF ncf en sales';
  end if;
end $t$;

-- I4: las secuencias E31, E33, E44 y E45 llevan vencimiento; E32, E34 y las B
-- no lo necesitan. El rango E cabe en 10 dígitos.
do $t$
declare p record;
begin
  for p in
    select * from (values ('fiscal', 'E31', '00000000-0000-0000-0000-00000000ec5a'::uuid),
                          ('nota_debito', 'E33', '00000000-0000-0000-0000-00000000ec5b'::uuid),
                          ('regimen_especial', 'E44', '00000000-0000-0000-0000-00000000ec5c'::uuid),
                          ('gubernamental', 'E45', '00000000-0000-0000-0000-00000000ec5d'::uuid)) v(tipo, prefix, id)
  loop
    perform pg_temp.debe_fallar(
      format($q$insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica)
                values ('00000000-0000-0000-0000-0000000000aa', %L, %L, 1, 10, 1, true)$q$, p.tipo, p.prefix),
      '%ncf_sequences_vencimiento_e_check%');
    insert into ncf_sequences (id, company_id, tipo, prefix, range_from, range_to, current_val, electronica, expires_at)
    values (p.id, '00000000-0000-0000-0000-0000000000aa', p.tipo, p.prefix, 1, 10, 1, true, current_date + 30);
    -- Quitarle el vencimiento después tampoco.
    perform pg_temp.debe_fallar(
      format($q$update ncf_sequences set expires_at = null where id = %L$q$, p.id),
      '%ncf_sequences_vencimiento_e_check%');
  end loop;
  insert into ncf_sequences (id, company_id, tipo, prefix, range_from, range_to, current_val, electronica)
  values ('00000000-0000-0000-0000-00000000ec5e', '00000000-0000-0000-0000-0000000000aa', 'nota_credito', 'E34', 1, 10, 1, true);
  insert into ncf_sequences (id, company_id, tipo, prefix, range_from, range_to, current_val, electronica)
  values ('00000000-0000-0000-0000-00000000ec5f', '00000000-0000-0000-0000-0000000000aa', 'fiscal', 'B01', 1, 10, 1, false);

  perform pg_temp.debe_fallar(
    $q$insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, electronica)
       values ('00000000-0000-0000-0000-0000000000aa', 'consumer', 'E32', 9999999990, 10000000000, 9999999990, true)$q$,
    '%ncf_sequences_rango_e_check%');
  perform pg_temp.debe_fallar(
    $q$update ncf_sequences set range_to = 10000000000 where id = '00000000-0000-0000-0000-00000000ec5e'$q$,
    '%ncf_sequences_rango_e_check%');
  update ncf_sequences set range_to = 9999999999 where id = '00000000-0000-0000-0000-00000000ec5e';
  -- La serie B no tiene ese tope.
  update ncf_sequences set range_to = 10000000000 where id = '00000000-0000-0000-0000-00000000ec5f';

  delete from ncf_sequences where id in (
    '00000000-0000-0000-0000-00000000ec5a', '00000000-0000-0000-0000-00000000ec5b', '00000000-0000-0000-0000-00000000ec5c',
    '00000000-0000-0000-0000-00000000ec5d', '00000000-0000-0000-0000-00000000ec5e', '00000000-0000-0000-0000-00000000ec5f');
end $t$;

-- I5: solo se reserva (y se envía) el documento de una empresa con e-CF activo.
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec6a', 960001, 'por_enviar');
update ecf_documentos set proximo_intento_at = now() - interval '1 minute'
 where id = '00000000-0000-0000-0000-00000000ec6a';
do $t$
declare e text; d uuid := '00000000-0000-0000-0000-00000000ec6a';
begin
  foreach e in array array['suspendida', 'preparacion'] loop
    update ecf_config set estado = e where company_id = '00000000-0000-0000-0000-0000000000aa';
    if pg_temp.reservar(d) is distinct from '0:-:-' or pg_temp.estado_de(d) <> 'por_enviar' then
      raise exception 'I5: con la empresa % el documento por enviar no debía reservarse', e;
    end if;
    -- Ni un enviando con la reserva vencida.
    update ecf_documentos set estado = 'enviando', reservado_hasta = now() - interval '1 minute' where id = d;
    if pg_temp.reservar(d) is distinct from '0:-:-' or pg_temp.estado_de(d) <> 'enviando' then
      raise exception 'I5: con la empresa % un enviando vencido no debía reservarse', e;
    end if;
    update ecf_documentos set estado = 'por_enviar', reservado_hasta = null where id = d;
  end loop;

  -- Activa pero con el módulo apagado: tampoco.
  update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-0000000000aa';
  update company_modules set enabled = false
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
  if pg_temp.reservar(d) is distinct from '0:-:-' then
    raise exception 'I5: con el módulo apagado el documento no debía reservarse';
  end if;
  update company_modules set enabled = true
   where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';

  -- Activa: sí, y es el primer intento (los rechazos de arriba no contaron).
  if pg_temp.reservar(d) is distinct from '1:1:enviando' then
    raise exception 'I5: con la empresa activa debía reservarse en el primer intento';
  end if;
end $t$;

-- I6: consultas pendientes. Lo que lleva más de 72 horas sin respuesta ya no se
-- pide; cada lote empieza por lo nunca consultado y luego por lo consultado
-- hace más tiempo; el intervalo se mide desde el último lote de la empresa.
--   ec6b recibido, creado hace 100 h y enviado hace 71 h        -> sí (cuenta el envío)
--   ec6c recibido, creado hace 73 h, sin fecha de envío          -> no
--   ec6d recibido, creado hace 80 h y enviado hace 73 h          -> no
--   ec6e recibido, creado hace 1 h, nunca consultado             -> sí, después de ec6b
--   ec6f recibido, creado hace 2 h, consultado hace 3 h          -> sí, al final
--   ec7a aceptado, consultado hace 3 h (no se pide; solo cuenta para el intervalo)
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec6b', 960011, 'recibido', interval '100 hours', interval '71 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec6c', 960012, 'recibido', interval '73 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec6d', 960013, 'recibido', interval '80 hours', interval '73 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec6e', 960014, 'recibido', interval '1 hour');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec6f', 960015, 'recibido', interval '2 hours', null, interval '3 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec7a', 960016, 'aceptado', interval '5 hours', interval '5 hours', interval '3 hours');
do $t$
declare e text[];
begin
  select encfs into e from ecf_consultas_pendientes()
   where company_id = '00000000-0000-0000-0000-0000000000aa' and ambiente = 'TesteCF';
  if e is distinct from array['E320000960011', 'E320000960014', 'E320000960015'] then
    raise exception 'I6: el lote debía traer ec6b, ec6e y ec6f en ese orden (sin los de más de 72 horas), trae %', e;
  end if;

  -- Un documento que ya no está recibido también marca el último lote de la empresa.
  update ecf_documentos set ultima_consulta_at = now() - interval '10 minutes'
   where id = '00000000-0000-0000-0000-00000000ec7a';
  if exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa') then
    raise exception 'I6: la empresa consultó hace 10 minutos (aunque ese documento ya se aceptó): no debía salir';
  end if;
  update ecf_documentos set ultima_consulta_at = now() - interval '61 minutes'
   where id = '00000000-0000-0000-0000-00000000ec7a';
  if not exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa') then
    raise exception 'I6: pasado el intervalo del plan la empresa debía volver a salir';
  end if;

  -- Solo lo de más de 72 horas: la empresa no sale.
  delete from ecf_documentos where id in ('00000000-0000-0000-0000-00000000ec6b', '00000000-0000-0000-0000-00000000ec6e',
                                          '00000000-0000-0000-0000-00000000ec6f');
  if exists (select 1 from ecf_consultas_pendientes() where company_id = '00000000-0000-0000-0000-0000000000aa') then
    raise exception 'I6: con solo recibidos de más de 72 horas la empresa no debía salir';
  end if;
end $t$;

-- I6: MSeller rechazó las credenciales: lo que espera de esa empresa y ambiente
-- se pospone 30 minutos con el motivo (sin nada de la cuenta); lo demás, no.
--   ec7b por enviar, TesteCF   -> se pospone       ec7c por enviar, CerteCF  -> no
--   ec7d recibido, TesteCF     -> no               ec7e por enviar de la otra empresa -> no
delete from ecf_documentos where company_id = '00000000-0000-0000-0000-0000000000aa';
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec7b', 960021, 'por_enviar');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec7c', 960022, 'por_enviar', p_ambiente => 'CerteCF');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec7d', 960023, 'recibido');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec7e', 960024, 'por_enviar',
                      p_company => '00000000-0000-0000-0000-00000000ec0a',
                      p_sale => '00000000-0000-0000-0000-00000000ec99');
update ecf_documentos set proximo_intento_at = now() - interval '1 minute', ultimo_error = null
 where id in ('00000000-0000-0000-0000-00000000ec7b', '00000000-0000-0000-0000-00000000ec7c',
              '00000000-0000-0000-0000-00000000ec7d', '00000000-0000-0000-0000-00000000ec7e');
set local role service_role;
select ecf_posponer_por_credenciales('00000000-0000-0000-0000-0000000000aa', 'TesteCF');
reset role;
do $t$
declare d ecf_documentos;
begin
  select * into d from ecf_documentos where id = '00000000-0000-0000-0000-00000000ec7b';
  if d.proximo_intento_at is distinct from now() + interval '30 minutes'
     or d.ultimo_error is distinct from 'MSeller rechazó las credenciales de la empresa.'
     or d.estado <> 'por_enviar' then
    raise exception 'I6: el por enviar de la empresa debía posponerse 30 minutos con el motivo, quedó % %',
      d.proximo_intento_at, d.ultimo_error;
  end if;
  if exists (select 1 from ecf_documentos
              where id in ('00000000-0000-0000-0000-00000000ec7c', '00000000-0000-0000-0000-00000000ec7d',
                           '00000000-0000-0000-0000-00000000ec7e')
                and (proximo_intento_at <> now() - interval '1 minute' or ultimo_error is not null)) then
    raise exception 'I6: posponer debía tocar solo los por enviar de esa empresa y ese ambiente';
  end if;
end $t$;

-- I6: con credenciales nuevas lo pospuesto vuelve a la fila enseguida (empresa
-- de prueba …ec0e). Solo lo por enviar de ese ambiente.
--   ec1a por enviar, TesteCF, pospuesto -> ahora   ec1b por enviar, CerteCF -> no
--   ec1c recibido, TesteCF              -> no
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec1a', 960031, 'por_enviar',
                      p_company => '00000000-0000-0000-0000-00000000ec0e', p_sale => '00000000-0000-0000-0000-00000000ec9c');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec1b', 960032, 'por_enviar', p_ambiente => 'CerteCF',
                      p_company => '00000000-0000-0000-0000-00000000ec0e', p_sale => '00000000-0000-0000-0000-00000000ec9c');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec1c', 960033, 'recibido',
                      p_company => '00000000-0000-0000-0000-00000000ec0e', p_sale => '00000000-0000-0000-0000-00000000ec9c');
update ecf_documentos set proximo_intento_at = now() + interval '30 minutes'
 where company_id = '00000000-0000-0000-0000-00000000ec0e';
set local role service_role;
select ecf_guardar_credenciales('00000000-0000-0000-0000-00000000ec0e', 'TesteCF',
                                'ecf+rf@sellalles.com', 'clave-rf', 'key-rf');
reset role;
do $t$
begin
  if (select proximo_intento_at from ecf_documentos where id = '00000000-0000-0000-0000-00000000ec1a') is distinct from now() then
    raise exception 'I6: guardar credenciales nuevas debía devolver a la fila lo que esperaba en ese ambiente';
  end if;
  if exists (select 1 from ecf_documentos
              where id in ('00000000-0000-0000-0000-00000000ec1b', '00000000-0000-0000-0000-00000000ec1c')
                and proximo_intento_at is distinct from now() + interval '30 minutes') then
    raise exception 'I6: guardar credenciales solo debía tocar lo por enviar de ese ambiente';
  end if;
  if (ecf_leer_credenciales('00000000-0000-0000-0000-00000000ec0e', 'TesteCF') ->> 'password') is distinct from 'clave-rf' then
    raise exception 'I6: las credenciales debían guardarse igual que siempre';
  end if;
end $t$;

-- I6: posponer es del servidor, como las demás.
do $t$
declare f text := 'public.ecf_posponer_por_credenciales(uuid,text)';
begin
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
    raise exception 'I6: % no debía ser ejecutable por anon ni authenticated', f;
  end if;
  if not has_function_privilege('service_role', f, 'execute') then
    raise exception 'I6: % debía ser ejecutable por service_role', f;
  end if;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
              where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'I6: % no debía ser ejecutable por PUBLIC', f;
  end if;
  if not coalesce((select prosecdef and proconfig @> array['search_path=public']
                     from pg_proc where oid = f::regprocedure), false) then
    raise exception 'I6: % debía ser security definer con search_path = public', f;
  end if;
end $t$;
set local role authenticated;
do $t$
begin
  perform pg_temp.debe_fallar(
    $q$select ecf_posponer_por_credenciales('00000000-0000-0000-0000-0000000000aa', 'TesteCF')$q$,
    '%permission denied%');
end $t$;
reset role;

-- I7: el resumen diario avisa, por empresa, de lo atascado. Sin la exclusión de
-- reemplazado_por: un reemplazo atascado también se avisa.
--   ec24 por enviar hace 7 h         ec27 recibido, enviado hace 49 h
--   ec25 enviando hace 7 h           ec28 recibido sin fecha de envío, creado hace 50 h
--   ec26 por enviar hace 5 h (no)    ec29 recibido, enviado hace 47 h (no)
--   ec2a por enviar hace 8 h, con reemplazado_por puesto
--   ec2b por enviar hace 7 h, de la otra empresa (aunque no tenga e-CF activo)
delete from ecf_documentos where company_id in ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000ec0a');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec24', 970001, 'por_enviar', interval '7 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec25', 970002, 'enviando', interval '7 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec26', 970003, 'por_enviar', interval '5 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec27', 970004, 'recibido', interval '60 hours', interval '49 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec28', 970005, 'recibido', interval '50 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec29', 970006, 'recibido', interval '60 hours', interval '47 hours');
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec2a', 970007, 'por_enviar', interval '8 hours');
update ecf_documentos set reemplazado_por = '00000000-0000-0000-0000-00000000ec26'
 where id = '00000000-0000-0000-0000-00000000ec2a';
select pg_temp.doc_rf('00000000-0000-0000-0000-00000000ec2b', 970008, 'por_enviar', interval '7 hours',
                      p_company => '00000000-0000-0000-0000-00000000ec0a', p_sale => '00000000-0000-0000-0000-00000000ec99');
do $t$
declare
  n     text := (select name from companies where id = '00000000-0000-0000-0000-0000000000aa');
  l     text[] := pg_temp.lineas_demo('Documentos:');
  todas jsonb := public._ecf_avisos_lineas();
  antes bigint := (select count(*) from pg_temp.correos_ecf());
  q     record;
begin
  if l is distinct from array[
       'Documentos: ' || n || ': 2 comprobantes sin respuesta de la DGII desde hace más de 48 horas.',
       'Documentos: ' || n || ': 3 comprobantes sin enviar desde hace más de 6 horas.'] then
    raise exception 'I7: debían salir los 3 sin enviar y los 2 sin respuesta de la demo, sale %', l;
  end if;
  if not todas @> to_jsonb(array['Documentos: Prueba e-CF: otra empresa: 1 comprobante sin enviar desde hace más de 6 horas.']) then
    raise exception 'I7: la otra empresa debía tener su línea (en singular), las líneas son %', todas;
  end if;

  -- Van en el correo del día.
  perform ecf_avisos_diarios();
  if (select count(*) from pg_temp.correos_ecf()) <> antes + 1 then
    raise exception 'I7: lo atascado debía salir en el resumen diario';
  end if;
  select * into q from pg_temp.correos_demo() order by id desc limit 1;
  if not ((q.b -> 'vars' -> 'lineas') @> to_jsonb(l)) then
    raise exception 'I7: el correo debía traer las líneas de lo atascado, trae %', q.b -> 'vars';
  end if;

  -- Lo que ya no está atascado deja de avisarse.
  update ecf_documentos set estado = 'aceptado'
   where id in ('00000000-0000-0000-0000-00000000ec24', '00000000-0000-0000-0000-00000000ec25',
                '00000000-0000-0000-0000-00000000ec27', '00000000-0000-0000-0000-00000000ec28');
  if pg_temp.lineas_demo('Documentos:') is distinct from array[
       'Documentos: ' || n || ': 1 comprobante sin enviar desde hace más de 6 horas.'] then
    raise exception 'I7: solo debía quedar el reemplazo atascado (en singular), sale %', pg_temp.lineas_demo('Documentos:');
  end if;
end $t$;

-- Ajustes sueltos: annul_sale lee el documento vigente con `for share`, y la
-- service role tiene sus permisos explícitos sobre las cuatro tablas.
do $t$
declare t text;
begin
  if pg_get_functiondef('public.annul_sale(uuid,text,text)'::regprocedure)
     !~ 'reemplazado_por is null\s+order by d\.created_at desc\s+limit 1\s+for share' then
    raise exception 'annul_sale debía leer el documento vigente con for share';
  end if;
  foreach t in array array['ecf_config', 'ecf_credenciales', 'ecf_documentos', 'ecf_uso'] loop
    if (select count(distinct a.privilege_type)
          from pg_class c cross join lateral aclexplode(c.relacl) a
         where c.oid = ('public.' || t)::regclass
           and a.grantee = 'service_role'::regrole
           and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) <> 4 then
      raise exception 'service_role debía tener select, insert, update y delete en %', t;
    end if;
  end loop;
end $t$;

-- == R37: tope por empresa y ambiente en la cola de envíos ==
-- Estado explícito de la sección: super admin; dos empresas de prueba formalizadas,
-- con el módulo `ecf` y su ecf_config activa en TesteCF: …ecee (A, la "caída") y
-- …ecef (B). Cada una con una venta de apoyo sin NCF (…ecde, …ecdf). Los documentos
-- de A son los más viejos de todos (hace 30 días) y los de B más nuevos. Las
-- aserciones filtran por estas dos empresas.
-- UUID de la sección: ecee–ecef (empresas), ecde–ecdf (ventas).
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
insert into companies (id, name) values
  ('00000000-0000-0000-0000-00000000ecee', 'Prueba e-CF: cola A'),
  ('00000000-0000-0000-0000-00000000ecef', 'Prueba e-CF: cola B');
update companies set is_formalized = true
 where id in ('00000000-0000-0000-0000-00000000ecee', '00000000-0000-0000-0000-00000000ecef');
insert into company_modules (company_id, module_key, enabled) values
  ('00000000-0000-0000-0000-00000000ecee', 'ecf', true),
  ('00000000-0000-0000-0000-00000000ecef', 'ecf', true);
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion) values
  ('00000000-0000-0000-0000-00000000ecee', 'preparacion', 'TesteCF', '505050505', 'Cola A SRL', 'Calle 5'),
  ('00000000-0000-0000-0000-00000000ecef', 'preparacion', 'TesteCF', '606060606', 'Cola B SRL', 'Calle 6');
select pg_temp.venta('00000000-0000-0000-0000-00000000ecde', '00000000-0000-0000-0000-00000000ecee', null);
select pg_temp.venta('00000000-0000-0000-0000-00000000ecdf', '00000000-0000-0000-0000-00000000ecef', null);
update ecf_config set estado = 'activa'
 where company_id in ('00000000-0000-0000-0000-00000000ecee', '00000000-0000-0000-0000-00000000ecef');
-- A: 15 por_enviar vencidos, los n = 1..15 en orden de antigüedad; B: 3 más nuevos.
insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente, estado, created_at, estado_at)
select '00000000-0000-0000-0000-00000000ecee', '00000000-0000-0000-0000-00000000ecde', 32,
       'E32' || lpad(n::text, 10, '0'), 'TesteCF', 'por_enviar',
       now() - interval '30 days' + n * interval '1 minute', now() - interval '30 days'
  from generate_series(1, 15) n;
insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente, estado, created_at, estado_at)
select '00000000-0000-0000-0000-00000000ecef', '00000000-0000-0000-0000-00000000ecdf', 32,
       'E32' || lpad(n::text, 10, '0'), 'TesteCF', 'por_enviar',
       now() - interval '20 days' + n * interval '1 minute', now() - interval '20 days'
  from generate_series(1, 3) n;

-- Los ids que devuelve la cola para estas dos empresas, en el orden de la cola.
create function pg_temp.cola_r37(p_limite int) returns uuid[]
language sql as $$
  select coalesce(array_agg(q.id order by d.created_at, d.id), '{}')
    from public.ecf_documentos_por_enviar(p_limite) q(id)
    join public.ecf_documentos d on d.id = q.id
   where d.company_id in ('00000000-0000-0000-0000-00000000ecee', '00000000-0000-0000-0000-00000000ecef')
$$;

do $t$
declare
  a uuid := '00000000-0000-0000-0000-00000000ecee';
  b uuid := '00000000-0000-0000-0000-00000000ecef';
  v_ids uuid[]; v_viejos_a uuid[]; v_b uuid[];
begin
  select array_agg(id order by created_at) into v_viejos_a from (
    select id, created_at from ecf_documentos where company_id = a order by created_at limit 10) x;
  select array_agg(id order by created_at) into v_b from ecf_documentos where company_id = b;

  -- Tope de 10 por empresa: de A los 10 más viejos y los 3 de B.
  v_ids := pg_temp.cola_r37(50);
  if cardinality(v_ids) <> 13
     or (select count(*) from ecf_documentos where id = any (v_ids) and company_id = a) <> 10
     or not (v_viejos_a <@ v_ids) or not (v_b <@ v_ids) then
    raise exception 'R37: con 15 de A y 3 de B la cola debía dar los 10 más viejos de A y los 3 de B; dio % (A: %)',
      cardinality(v_ids), (select count(*) from ecf_documentos where id = any (v_ids) and company_id = a);
  end if;

  -- El límite global sigue aplicándose, por created_at: solo salen de los 10 más viejos de A.
  v_ids := pg_temp.cola_r37(5);
  if cardinality(v_ids) <> 5 or not (v_ids <@ v_viejos_a) then
    raise exception 'R37: con p_limite 5 debían salir 5 de los 10 más viejos de A; salieron % (¿%?)',
      cardinality(v_ids), v_ids;
  end if;

  -- El tope es por ambiente: A con 13 en TesteCF y 2 en eCF da 10 + 2.
  update ecf_documentos set ambiente = 'eCF'
   where company_id = a and encf in ('E320000000014', 'E320000000015');
  v_ids := pg_temp.cola_r37(50);
  if cardinality(v_ids) <> 15
     or (select count(*) from ecf_documentos where id = any (v_ids) and company_id = a and ambiente = 'TesteCF') <> 10
     or (select count(*) from ecf_documentos where id = any (v_ids) and company_id = a and ambiente = 'eCF') <> 2 then
    raise exception 'R37: el tope debía ser por ambiente (10 TesteCF + 2 eCF de A y 3 de B); dio % en total', cardinality(v_ids);
  end if;
end $t$;

-- == Credenciales rechazadas: lo que nace mientras tanto, nace pospuesto ==
-- Estado explícito de la sección: super admin; una empresa de prueba formalizada
-- (…ecca) con el módulo `ecf`, su ecf_config activa en TesteCF, una venta de
-- apoyo sin NCF (…eccb) y una fila de credenciales SIN secretos (los ids de
-- Vault en null: la sección nunca lee ni escribe Vault). Todo se va con el
-- rollback. Dentro de la transacción now() no cambia: "en 30 minutos" es exacto.
-- UUID de la sección: ecca (empresa), eccb (venta).
select pg_temp.como('92381752-13b2-4f43-8b09-612647754599');
insert into companies (id, name) values ('00000000-0000-0000-0000-00000000ecca', 'Prueba e-CF: credenciales rechazadas');
update companies set is_formalized = true where id = '00000000-0000-0000-0000-00000000ecca';
insert into company_modules (company_id, module_key, enabled) values ('00000000-0000-0000-0000-00000000ecca', 'ecf', true);
insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion) values
  ('00000000-0000-0000-0000-00000000ecca', 'preparacion', 'TesteCF', '707070707', 'Rechazada SRL', 'Calle 7');
select pg_temp.venta('00000000-0000-0000-0000-00000000eccb', '00000000-0000-0000-0000-00000000ecca', null);
update ecf_config set estado = 'activa' where company_id = '00000000-0000-0000-0000-00000000ecca';
insert into ecf_credenciales (company_id, ambiente, email) values
  ('00000000-0000-0000-0000-00000000ecca', 'TesteCF', 'rechazada@prueba.test');

-- Inserta un documento por enviar de la venta de apoyo y devuelve su id.
create function pg_temp.doc_rechazo(p_encf text, p_ambiente text) returns uuid
language sql as $$
  insert into ecf_documentos (company_id, sale_id, tipo_ecf, encf, ambiente, estado)
  values ('00000000-0000-0000-0000-00000000ecca', '00000000-0000-0000-0000-00000000eccb', 32,
          p_encf, p_ambiente, 'por_enviar')
  returning id
$$;

do $t$
declare
  c uuid := '00000000-0000-0000-0000-00000000ecca';
  v_antes uuid; v_nuevo uuid; v_otro uuid; v_despues uuid;
  v_hasta timestamptz;
begin
  -- Sin marca, un documento nuevo sale ya.
  v_antes := pg_temp.doc_rechazo('E320000000101', 'TesteCF');
  if (select proximo_intento_at from ecf_documentos where id = v_antes) > now() then
    raise exception 'Rechazo: sin marca, un documento nuevo no debía nacer pospuesto';
  end if;

  -- MSeller rechazó el login: se marca la cuenta y se pospone lo que espera.
  perform ecf_posponer_por_credenciales(c, 'TesteCF');
  select rechazadas_hasta into v_hasta from ecf_credenciales where company_id = c and ambiente = 'TesteCF';
  if v_hasta is distinct from now() + interval '30 minutes' then
    raise exception 'Rechazo: la cuenta debía quedar marcada hasta dentro de 30 minutos; quedó %', v_hasta;
  end if;
  if (select proximo_intento_at from ecf_documentos where id = v_antes) <> now() + interval '30 minutes' then
    raise exception 'Rechazo: lo que ya esperaba debía posponerse 30 minutos';
  end if;

  -- Lo que nace con la marca nace pospuesto hasta ella, con el motivo, y la
  -- reserva del punto de venta no lo toma.
  v_nuevo := pg_temp.doc_rechazo('E320000000102', 'TesteCF');
  if (select proximo_intento_at from ecf_documentos where id = v_nuevo) <> v_hasta
     or (select ultimo_error from ecf_documentos where id = v_nuevo) is distinct from 'MSeller rechazó las credenciales de la empresa.' then
    raise exception 'Rechazo: un documento nuevo debía nacer pospuesto hasta % y con el motivo', v_hasta;
  end if;
  if exists (select 1 from ecf_reservar_documento(v_nuevo)) then
    raise exception 'Rechazo: la reserva no debía tomar un documento pospuesto por credenciales';
  end if;

  -- La marca es por ambiente: en otro ambiente nace normal.
  v_otro := pg_temp.doc_rechazo('E320000000103', 'eCF');
  if (select proximo_intento_at from ecf_documentos where id = v_otro) > now() then
    raise exception 'Rechazo: la marca de TesteCF no debía posponer un documento de eCF';
  end if;

  -- Volver a posponer no la borra (no cambia ni las credenciales ni la sesión).
  perform ecf_posponer_por_credenciales(c, 'TesteCF');
  if (select rechazadas_hasta from ecf_credenciales where company_id = c and ambiente = 'TesteCF') is null then
    raise exception 'Rechazo: posponer otra vez no debía borrar la marca';
  end if;

  -- Una sesión nueva (MSeller aceptó la cuenta) borra la marca.
  update ecf_credenciales set id_token = 'sesion-de-prueba', id_token_vence = now() + interval '1 hour'
   where company_id = c and ambiente = 'TesteCF';
  if (select rechazadas_hasta from ecf_credenciales where company_id = c and ambiente = 'TesteCF') is not null then
    raise exception 'Rechazo: una sesión nueva debía borrar la marca';
  end if;

  -- Credenciales nuevas también la borran.
  perform ecf_posponer_por_credenciales(c, 'TesteCF');
  update ecf_credenciales set email = 'otra@prueba.test' where company_id = c and ambiente = 'TesteCF';
  if (select rechazadas_hasta from ecf_credenciales where company_id = c and ambiente = 'TesteCF') is not null then
    raise exception 'Rechazo: cambiar las credenciales debía borrar la marca';
  end if;

  -- Una marca vencida ya no pospone.
  perform ecf_posponer_por_credenciales(c, 'TesteCF');
  update ecf_credenciales set rechazadas_hasta = now() - interval '1 minute'
   where company_id = c and ambiente = 'TesteCF';
  v_despues := pg_temp.doc_rechazo('E320000000104', 'TesteCF');
  if (select proximo_intento_at from ecf_documentos where id = v_despues) > now() then
    raise exception 'Rechazo: una marca vencida no debía posponer un documento nuevo';
  end if;
end $t$;

select 'ok';
