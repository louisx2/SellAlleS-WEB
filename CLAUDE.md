# SellAlleS WEB

- Reglas de interfaz del proyecto: `.agents/AGENTS.md`.
- Backend (Supabase, proyecto `qwpjclqinruhtxgkrxwr`): leer `SUPABASE.md` antes
  de tocar la base.

## Migraciones: grants explícitos

Desde el 30-oct-2026 Supabase ya no da permisos automáticos a lo nuevo en
`public`. Toda migración que cree una tabla, función o secuencia incluye sus
`grant` para `authenticated` y `service_role` (y `anon` solo si hace falta) en
la misma migración. Detalle y plantilla: sección "Grants en migraciones nuevas"
de `SUPABASE.md`.

**Pendiente (quitar cuando esté hecho):** después del 30-oct-2026, confirmar en
`pg_default_acl` que el cambio llegó al proyecto y revisar los logs de la API
por errores `42501 permission denied`. Tarjeta en Trello, tablero "SellAlleS
Web": "Supabase: grants explícitos en migraciones (cambio del 30-oct)".
