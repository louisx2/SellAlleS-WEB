# Visión general del proyecto

> Este era el README del repo que versionaba el backend por separado, antes de
> unirlo a este. Se conserva por el índice de documentación y el registro de
> estado. Donde dice `SellAlleS-WEB/` ahora es la raíz de este repo, y el estado
> que describe es el de julio de 2026.

SaaS multitenant de punto de venta para la web. Evolución del sistema de escritorio **LhEs_Ventas** (WinForms .NET 4.8 + SQL Server) hacia una plataforma en navegador con:

- **Multitenant**: múltiples empresas (clientes del SaaS) en una sola infraestructura, con aislamiento de datos por tenant.
- **Multisucursal**: cada empresa puede tener varias sucursales, con inventario, caja y usuarios por sucursal (el sistema actual ya lo maneja — se conserva el modelo).
- **Facturación electrónica DGII (e-CF)**: preparado desde el diseño para emitir comprobantes fiscales electrónicos en República Dominicana.

## Stack (real, según el repo existente)

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Zustand |
| Repositorio | https://github.com/louisx2/SellAlleS-WEB (clonado en `SellAlleS-WEB/`) |
| Hosting frontend | Cloudflare Pages/Workers (pendiente; Next.js requiere adaptador `@opennextjs/cloudflare`) |
| Base de datos | Supabase proyecto **SellAlleS** `qwpjclqinruhtxgkrxwr` (Postgres 17 + RLS por `company_id`) |
| Autenticación | Supabase Auth (pendiente de conectar; hoy la app usa login demo en memoria) |
| Lógica de servidor | Funciones SQL `security definer` + Edge Functions |
| Impresión de tickets | react-to-print (ya en el repo) + QZ Tray para térmicas (futuro) |

## Documentación

1. [Factibilidad](docs/01-FACTIBILIDAD.md) — análisis módulo por módulo del sistema actual y veredicto.
2. [Arquitectura](docs/02-ARQUITECTURA.md) — stack, multitenancy, seguridad.
3. [Modelo de datos](docs/03-MODELO-DE-DATOS.md) — esquema PostgreSQL multitenant (borrador).
4. [Roadmap](docs/04-ROADMAP.md) — fases de construcción.

## Estado (actualizado 2026-07-06 tras descubrir el proyecto existente)

El proyecto estaba más avanzado de lo previsto: el repo ya contiene la **UI completa**
(POS, productos, ventas, crédito, financiamiento, clientes, suplidores, gastos,
sucursales, roles, usuarios, 5 reportes, dashboard, panel super-admin, landing)
funcionando con **datos demo en memoria**, y Supabase ya tiene el **esquema multitenant
desplegado** (15 tablas con RLS, 8 migraciones, planes sembrados).

- [x] Análisis de factibilidad
- [x] Proyecto Supabase creado y esquema aplicado (`companies`, `branches`, `profiles`, `sales`, `ncf_sequences`... — RLS por `company_id`)
- [x] Frontend construido (Next.js 14) con datos demo
- [x] Repo clonado y `.env.local` configurado con las claves del proyecto
- [x] App conectada a Supabase (auth + los 9 providers de datos) — ya venía hecho; los docs del repo estaban desactualizados
- [x] Abonos de crédito/financiamiento guardando en `credit_payments` (2026-07-06)
- [x] NCF real: trigger `set_sale_ncf` asigna desde `ncf_sequences` con lock, solo si `ncf_enabled` (2026-07-06)
- [x] Venta con cliente genérico y sucursal resueltas correctamente a la base (2026-07-06)
- [x] `tsc` limpio y `next build` verde; módulo demo `lib/database.ts` eliminado (2026-07-06)
- [x] Motor de crédito/financiamiento en la base (2026-07-07): cuotas en `financing_installments`, abonos atómicos por RPC (mora primero, capital FIFO), límite de crédito por cliente con rechazo en trigger, mora/interés configurables por empresa, estado de cuenta e historial, recibo de abono y plan de pagos imprimibles. Se corrigió además el bug que guardaba las ventas financiadas con `amount_paid = total` y la fórmula de interés (dividía la tasa mensual entre 12). Ver `SellAlleS-WEB/SUPABASE.md`.
- [ ] Prueba de venta completa en el navegador con el usuario real (pendiente: solo Luis tiene la clave)
- [ ] Onboarding: alta de empresas + panel super admin con suscripciones
- [ ] UI para gestionar secuencias NCF
- [ ] Deploy a Cloudflare (adaptador OpenNext)
- [ ] Facturación electrónica DGII e-CF (los campos `is_formalized`/`ncf_enabled` ya existen en `companies`)

Los documentos `02-ARQUITECTURA.md` y `03-MODELO-DE-DATOS.md` se escribieron antes de
descubrir el esquema real; los principios aplican, pero **el esquema desplegado (nombres
en inglés, `company_id`) es la fuente de verdad** — ver `SellAlleS-WEB/SUPABASE.md`.
