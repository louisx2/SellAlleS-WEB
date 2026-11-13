-- El índice único de deduplicación bloqueaba también los envíos fallidos: si
-- Resend devolvía un error, la clave quedaba tomada y el aviso no se podía
-- reintentar nunca. Se vuelve parcial para que 'failed' no cuente.
--
-- Los rebotes y quejas SÍ cuentan: ahí el correo salió y llegó a destino, el
-- problema es el buzón. Reintentar solo empeoraría la reputación del dominio.

drop index public.platform_email_log_dedupe_idx;

create unique index platform_email_log_dedupe_idx
  on public.platform_email_log (template, dedupe_key)
  where status <> 'failed';
