-- Saca de la base los números de días que estaban quemados en el código: la
-- duración de la prueba (14 días fijos dentro de create_company_for_user) y los
-- tramos de aviso (3 y 1, escritos a mano en el barrido diario).
--
-- Van en platform_settings para poder tantear la conversión —28 días contra
-- 14— sin migración de por medio.

alter table public.platform_settings
  add column trial_days integer not null default 28
    check (trial_days between 1 and 365),
  -- Cuántos días ANTES del fin de prueba avisar. Con 28 días de prueba, avisar
  -- solo al final llega tarde: el de la mitad es el que alcanza al usuario
  -- cuando ya cargó sus datos y le duele perderlos.
  add column trial_reminder_days integer[] not null default '{7,3,1}',
  -- Cuántos días antes de paid_until recordar el cobro.
  add column payment_reminder_days integer[] not null default '{3}';

comment on column public.platform_settings.trial_days is
  'Duracion de la prueba gratis para empresas nuevas. La lee create_company_for_user al registrarse por el landing.';
comment on column public.platform_settings.trial_reminder_days is
  'Dias antes del fin de prueba en que se avisa. Ej: {7,3,1}.';
comment on column public.platform_settings.payment_reminder_days is
  'Dias antes de paid_until en que se recuerda el cobro. Ej: {3}.';

comment on table public.platform_settings is
  'Ajustes globales del SaaS, una sola fila. Legible por anon a proposito: la landing es un export estatico y consulta sin sesion. Solo datos publicos (contacto, duracion de prueba) - NO agregar campos sensibles aqui.';

-- Los arrays vacíos apagarían los avisos en silencio, que es peor que no
-- tenerlos: nadie se entera de que dejó de avisar.
alter table public.platform_settings
  add constraint platform_settings_recordatorios_no_vacios
    check (array_length(trial_reminder_days, 1) >= 1
       and array_length(payment_reminder_days, 1) >= 1);
