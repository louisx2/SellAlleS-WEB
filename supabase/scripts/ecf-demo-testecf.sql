-- Prepara la empresa demo (SellAlleS Store DEMO, …00aa) para probar la
-- facturación electrónica de punta a punta en TesteCF, con la cuenta de MSeller
-- y el certificado de Pujols Group EIRL (por ahora la única empresa que los tiene).
--
-- NO es una migración: se corre a mano en el SQL editor de Supabase, una vez que
-- Pujols tiene guardadas sus credenciales de TesteCF. Se puede correr más de una
-- vez: no duplica nada. Las credenciales pasan de Vault a Vault dentro de la
-- base; no se muestran ni se copian a ningún otro lado.
--
-- Por qué la demo y no Pujols: ecf_cambiar_estado solo deja activar en un
-- ambiente de pruebas a una empresa demo, para que las ventas reales de una
-- empresa nunca vayan a TesteCF.
--
-- Después, en SellAlleS, como super admin y sin entrar a ninguna empresa:
--   1. Empresas → SellAlleS Store DEMO → Facturación electrónica.
--   2. "Probar conexión" en Pruebas (TesteCF): debe decir "Conexión exitosa".
--   3. "Activar".
--   4. Entrar a la demo y vender: el ticket sale con un e-NCF E32 y su QR.
--      Con un cliente con RNC sale E31; al anular una venta, E34.
-- El certificado .p12 tiene que estar cargado en el portal de MSeller: sin él,
-- MSeller rechaza los comprobantes (412 CERTIFICATE_NOT_CONFIGURED).

do $$
declare
  demo   constant uuid := '00000000-0000-0000-0000-0000000000aa';
  pujols constant uuid := '4b3b00e8-ef6b-4fe2-8d32-3489c73ac099';
  v_emisor record;
  v_email  text;
  v_pass   text;
  v_key    text;
begin
  if not exists (select 1 from companies where id = demo and is_demo) then
    raise exception 'No está la empresa demo.';
  end if;
  -- Con la demo activa no se cambia nada: primero se pasa a preparación.
  if exists (select 1 from ecf_config where company_id = demo and estado = 'activa') then
    raise exception 'La demo tiene la facturación electrónica activa: pásala a preparación antes de correr esto.';
  end if;

  -- 1. El emisor es Pujols: el certificado y la cuenta de MSeller son suyos.
  select c.name, c.rnc,
         coalesce(nullif(btrim(c.address), ''), nullif(btrim(b.address), ''), 'República Dominicana') as direccion
    into v_emisor
    from companies c
    left join branches b on b.company_id = c.id and b.rnc = c.rnc
   where c.id = pujols
   limit 1;
  if v_emisor.rnc is null or v_emisor.rnc !~ '^\d{9}(\d{2})?$' then
    raise exception 'Pujols no tiene un RNC válido en su ficha.';
  end if;

  -- 2. Sus credenciales de TesteCF.
  select k.email, p.decrypted_secret, a.decrypted_secret
    into v_email, v_pass, v_key
    from ecf_credenciales k
    join vault.decrypted_secrets p on p.id = k.password_secret_id
    join vault.decrypted_secrets a on a.id = k.api_key_secret_id
   where k.company_id = pujols and k.ambiente = 'TesteCF';
  if v_email is null or coalesce(v_pass, '') = '' or coalesce(v_key, '') = '' then
    raise exception 'Pujols no tiene credenciales de TesteCF completas: guárdalas primero desde su ventana de Facturación electrónica.';
  end if;

  -- 3. La demo, formalizada y con el módulo e-CF encendido.
  update companies set is_formalized = true where id = demo;
  insert into company_modules (company_id, module_key, enabled)
  values (demo, 'ecf', true)
  on conflict (company_id, module_key) do update set enabled = true;

  -- 4. Datos del emisor, en preparación y en TesteCF.
  insert into ecf_config (company_id, estado, ambiente, rnc_emisor, razon_social, direccion)
  values (demo, 'preparacion', 'TesteCF', v_emisor.rnc, v_emisor.name, v_emisor.direccion)
  on conflict (company_id) do update
    set ambiente     = excluded.ambiente,
        rnc_emisor   = excluded.rnc_emisor,
        razon_social = excluded.razon_social,
        direccion    = excluded.direccion;

  -- 5. Secuencias E de prueba (en TesteCF no hace falta que la DGII las autorice).
  --    El E31 lleva vencimiento; al E32 y al E34 se les pone igual.
  insert into ncf_sequences (company_id, tipo, prefix, range_from, range_to, current_val, expires_at, active, electronica)
  select demo, s.tipo, s.prefix, 1, 1000, 1, date '2027-12-31', true, true
    from (values ('consumer', 'E32'), ('fiscal', 'E31'), ('nota_credito', 'E34')) s(tipo, prefix)
   where not exists (
     select 1 from ncf_sequences x
      where x.company_id = demo and x.prefix = s.prefix and x.electronica and x.active
   );

  -- 6. Las credenciales en la demo (quedan en Vault con sus propios secretos).
  perform ecf_guardar_credenciales(demo, 'TesteCF', v_email, v_pass, v_key);
end $$;

-- Cómo quedó (sin secretos).
select c.name as empresa,
       c.is_formalized as formalizada,
       (select m.enabled from company_modules m where m.company_id = c.id and m.module_key = 'ecf') as modulo_ecf,
       e.estado, e.ambiente, e.rnc_emisor, e.razon_social, e.conexion_probada_at,
       (select string_agg(s.prefix || ' ' || s.current_val || '/' || s.range_to, ', ' order by s.prefix)
          from ncf_sequences s where s.company_id = c.id and s.electronica and s.active) as secuencias_e,
       (select k.updated_at from ecf_credenciales k where k.company_id = c.id and k.ambiente = 'TesteCF') as credenciales_guardadas
  from companies c
  join ecf_config e on e.company_id = c.id
 where c.id = '00000000-0000-0000-0000-0000000000aa';

-- Para dejar la demo como estaba (cuando terminen las pruebas):
--   update ecf_config set estado = 'preparacion' where company_id = '00000000-0000-0000-0000-0000000000aa';
--   update company_modules set enabled = false where company_id = '00000000-0000-0000-0000-0000000000aa' and module_key = 'ecf';
--   update companies set is_formalized = false where id = '00000000-0000-0000-0000-0000000000aa';
