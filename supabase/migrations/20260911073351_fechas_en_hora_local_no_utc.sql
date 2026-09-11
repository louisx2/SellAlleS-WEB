-- La base corre en UTC y República Dominicana es UTC-4, así que entre las 8 de
-- la noche y la medianoche `current_date` ya devuelve el día siguiente. Todo lo
-- que se decidiera con esa fecha salía corrido durante esas cuatro horas: una
-- suscripción vencía antes de tiempo, un pago quedaba fechado mañana, una
-- secuencia de NCF se daba por caducada con un día de sobra.
--
-- `company_today(company_id)` ya existía y resuelve la fecha en la zona de cada
-- empresa (`companies.timezone`, por defecto America/Santo_Domingo); los abonos
-- de ventas, préstamos y clientes ya la usaban. Esta migración termina el
-- trabajo en las seis funciones que se quedaron en UTC.
--
-- Quedan a propósito dos `default CURRENT_DATE` de columna
-- (`voided_ncf.voided_date` y `subscription_payments.paid_at`): un default no
-- recibe el id de empresa, así que no puede saber la zona. Ninguno de los dos
-- se usa en la práctica — la app manda siempre el valor — y con
-- `record_subscription_payment` corregida aquí, el de `subscription_payments`
-- deja de alcanzarse por esa vía.

-- Se reescribe entera, y no por sustitución como las de abajo, para leer la
-- zona en el mismo SELECT que ya consultaba la empresa. Llamar a
-- company_today() aquí habría añadido una segunda lectura de `companies` a una
-- función que se evalúa constantemente.
create or replace function public.company_is_readonly(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select
        (status = 'trial'  and trial_ends_at is not null and trial_ends_at < now())
     or (status = 'active' and paid_until   is not null
         and paid_until < (now() at time zone
                            coalesce(nullif(btrim(timezone), ''), 'America/Santo_Domingo')
                          )::date)
       from companies where id = p_company_id),
    false);
$function$;

-- El resto son cambios de una expresión dentro de funciones largas. Se hacen
-- sustituyendo sobre la definición viva en vez de copiarlas enteras aquí: así
-- esta migración no puede revertir por accidente ningún otro cambio que tengan,
-- y si el texto esperado no aparece falla en vez de dejar la función a medias.
do $migracion$
declare
  -- función, texto que debe aparecer, texto que lo sustituye
  v_cambios constant text[][] := array[
    ['assign_ncf',
     'expires_at >= current_date',
     'expires_at >= company_today(p_company)'],

    ['annul_sale',
     'expires_at >= current_date',
     'expires_at >= company_today(v_sale.company_id)'],

    ['register_supplier_payment',
     'payment_date = current_date',
     'payment_date = company_today(v_company)'],

    -- Dos pasadas: el valor por defecto del parámetro se evaluaba en UTC antes
    -- de que el cuerpo pudiera opinar, así que no bastaba con tocar el coalesce.
    ['record_subscription_payment',
     'p_paid_at date DEFAULT CURRENT_DATE',
     'p_paid_at date DEFAULT NULL::date'],

    ['record_subscription_payment',
     'coalesce(p_paid_at, current_date)',
     'coalesce(p_paid_at, company_today(p_company_id))'],

    -- Aquí `c` es la empresa sobre la que itera el aviso, de modo que cada una
    -- cuenta sus días de prueba y de cobro en su propia zona.
    ['notificar_ciclo_de_vida',
     '(c.trial_ends_at::date - current_date)',
     '(c.trial_ends_at::date - company_today(c.id))'],

    ['notificar_ciclo_de_vida',
     '(c.paid_until - current_date)',
     '(c.paid_until - company_today(c.id))']
  ];
  v_i       int;
  v_nombre  text;
  v_cuantas int;
  v_def     text;
  v_nueva   text;
begin
  for v_i in 1 .. array_length(v_cambios, 1) loop
    v_nombre := v_cambios[v_i][1];

    -- Con sobrecargas, pg_get_functiondef daría una cualquiera y el parche
    -- iría a parar a la función equivocada.
    select count(*) into v_cuantas
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nombre;

    if v_cuantas <> 1 then
      raise exception 'Se esperaba exactamente una public.%, hay %.', v_nombre, v_cuantas;
    end if;

    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nombre;

    v_nueva := replace(v_def, v_cambios[v_i][2], v_cambios[v_i][3]);

    if v_nueva = v_def then
      raise exception 'En public.% no aparece "%"; la funcion cambio desde que se escribio esta migracion.',
        v_nombre, v_cambios[v_i][2];
    end if;

    execute v_nueva;
  end loop;
end
$migracion$;

-- Red de seguridad: si algo de lo anterior no cuajó, es mejor enterarse ahora
-- que descubrirlo por una mora cobrada de más.
do $comprobacion$
declare
  v_pendientes text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_pendientes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.proname in ('assign_ncf', 'annul_sale', 'company_is_readonly',
                       'register_supplier_payment', 'record_subscription_payment',
                       'notificar_ciclo_de_vida')
     and pg_get_functiondef(p.oid) ~* 'current_date';

  if v_pendientes is not null then
    raise exception 'Siguen usando current_date: %', v_pendientes;
  end if;
end
$comprobacion$;
