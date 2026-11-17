-- ============================================================================
-- Plantillas de correo que faltaban en el enum platform_email_template
-- ============================================================================
-- send-lifecycle-email registra cada envío en platform_email_log.template, que
-- es un enum. 'ecf-avisos' se agregó a la función pero nunca al enum: el insert
-- fallaba ("invalid input value for enum platform_email_template") y ningún
-- aviso de e-CF (resumen diario, falta de cupo) llegó a soporte. Se agregan
-- también las dos plantillas de suspensión y reactivación.
-- ============================================================================

alter type public.platform_email_template add value if not exists 'ecf-avisos';
alter type public.platform_email_template add value if not exists 'cuenta-suspendida';
alter type public.platform_email_template add value if not exists 'cuenta-reactivada';
