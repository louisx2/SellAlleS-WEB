-- Plantillas de correo de cobros que send-lifecycle-email ya sabe dibujar pero que el registro de envíos
-- (platform_email_log.template) no aceptaba: el insert fallaba con "invalid input value for enum" y el correo no
-- salía. Las disparan avisar_comprobante_recibido (al super admin), enviar_resumen_de_cobros (al super admin),
-- notificar_ciclo_de_vida (cuota vencida, sujeto a platform_settings.avisos_cobro_activos) y el panel al rechazar
-- un comprobante (pago-rechazado).
alter type public.platform_email_template add value if not exists 'comprobante-recibido';
alter type public.platform_email_template add value if not exists 'pago-rechazado';
alter type public.platform_email_template add value if not exists 'cuota-vencida';
alter type public.platform_email_template add value if not exists 'resumen-cobros';
