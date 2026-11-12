-- Pruebas de la memoria de consultas de RNC (dgii_contribuyentes). NO es una
-- migración: se corre contra producción dentro de una transacción que se
-- revierte, después del SQL de la migración:
--
--   begin; <supabase/migrations/20261112120000_dgii_contribuyentes.sql>
--          <este archivo> rollback;
--
-- Pasa si el último resultado es `ok`. Usa el documento 000000000, que no es de
-- nadie, para no chocar con lo que la función ya haya guardado.

-- La tabla, sus columnas, la RLS sin políticas y los grants: solo la service role.
do $t$
declare
  priv text;
begin
  if to_regclass('public.dgii_contribuyentes') is null then
    raise exception 'falta la tabla dgii_contribuyentes';
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'dgii_contribuyentes'
         and column_name in ('rnc', 'encontrado', 'razon_social', 'nombre_comercial', 'categoria',
                             'regimen_pagos', 'estado', 'actividad_economica', 'administracion_local',
                             'facturador_electronico', 'consultado_at')) <> 11 then
    raise exception 'dgii_contribuyentes no tiene las 11 columnas esperadas';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.dgii_contribuyentes'::regclass) then
    raise exception 'dgii_contribuyentes debía tener la RLS encendida';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dgii_contribuyentes') then
    raise exception 'dgii_contribuyentes no debía tener políticas: solo la lee y escribe la función';
  end if;

  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.dgii_contribuyentes', priv) then
      raise exception 'service_role debía tener % en dgii_contribuyentes', priv;
    end if;
    if has_table_privilege('anon', 'public.dgii_contribuyentes', priv)
       or has_table_privilege('authenticated', 'public.dgii_contribuyentes', priv) then
      raise exception 'anon y authenticated no debían tener % en dgii_contribuyentes', priv;
    end if;
  end loop;
end $t$;

-- Solo 9 u 11 dígitos.
do $t$
begin
  begin
    insert into public.dgii_contribuyentes (rnc, encontrado) values ('0000000000', false);
    raise exception 'un documento de 10 dígitos debía fallar';
  exception when check_violation then
    null;
  end;
end $t$;

-- Guardar dos veces el mismo documento actualiza la fila.
insert into public.dgii_contribuyentes (rnc, encontrado, razon_social) values ('000000000', true, 'Primera');
insert into public.dgii_contribuyentes (rnc, encontrado, razon_social) values ('000000000', true, 'Segunda')
on conflict (rnc) do update set razon_social = excluded.razon_social, consultado_at = now();
do $t$
begin
  if (select count(*) from public.dgii_contribuyentes where rnc = '000000000') <> 1
     or (select razon_social from public.dgii_contribuyentes where rnc = '000000000') is distinct from 'Segunda' then
    raise exception 'guardar otra vez el mismo documento debía actualizar la fila';
  end if;
end $t$;

select 'ok';
