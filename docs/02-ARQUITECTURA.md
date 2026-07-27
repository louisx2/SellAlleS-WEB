# Arquitectura — SELLALLES WEB 2.1

## Visión general

```
┌─────────────────────────────────────────────────────┐
│  Navegador (PC caja, tablet, celular)               │
│  React + Vite + TypeScript + Tailwind (SPA/PWA)     │
│  └─ QZ Tray (agente local) → impresora térmica      │
└──────────────┬──────────────────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────────────────┐
│  Cloudflare                                         │
│  - Pages/Workers: hosting del frontend, CDN, DNS    │
│  - (Workers para endpoints propios si hace falta)   │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│  Supabase                                           │
│  - PostgreSQL con RLS (aislamiento por tenant)      │
│  - Auth (JWT con tenant_id, sucursal, rol)          │
│  - Edge Functions (NCF, cierres de caja, e-CF)      │
│  - Realtime (stock/ventas en vivo)                  │
│  - Storage (imágenes de productos, logos)           │
└──────────────┬──────────────────────────────────────┘
               │ (Fase 6)
┌──────────────▼──────────────────────────────────────┐
│  DGII — facturación electrónica e-CF                │
│  (directo con firma XML o vía proveedor certificado)│
└─────────────────────────────────────────────────────┘
```

## Frontend

- **React 18 + Vite + TypeScript**: ecosistema más grande, contratación fácil, Vite compila rapidísimo.
- **Tailwind CSS + shadcn/ui**: componentes de calidad (tablas, formularios, diálogos) sin pagar licencias.
- **TanStack Query + supabase-js**: datos con caché y revalidación automática.
- **React Router**: rutas por módulo (`/pos`, `/inventario`, `/cotizaciones`, ...).
- Diseñado **mobile-first para consulta** (dueño mira ventas desde el celular) y **desktop-first para la caja**.

## Multitenancy (la decisión más importante)

**Modelo: base de datos compartida + `tenant_id` en cada tabla + RLS.**

- Cada fila de cada tabla de negocio lleva `tenant_id uuid not null`.
- El JWT del usuario (Supabase Auth) lleva claims: `tenant_id`, `sucursal_id` activa, `rol`.
- Políticas RLS en PostgreSQL: `using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)` — un tenant **no puede** ver datos de otro aunque el frontend tenga un bug.
- Ventaja: una sola base de datos que mantener, onboarding de un tenant nuevo = insertar filas, no crear infraestructura.
- La dimensión sucursal va **dentro** del tenant: `sucursal_id` en inventario, cajas, ventas — igual que el sistema actual.

## Roles (equivalente a PermisosUsuario actual)

| Rol | Alcance |
|---|---|
| `superadmin` | Nosotros — administración del SaaS, alta de tenants |
| `owner` | Dueño de la empresa — todo su tenant, todas las sucursales |
| `admin` | Administrador de sucursal(es) asignadas |
| `cajero` | POS, caja, clientes — sucursal asignada |
| `consulta` | Solo lectura de reportes |

Los permisos finos (equivalente a las autorizaciones ADMIN para devoluciones/descuentos del sistema actual) se modelan como tabla `permisos` por rol/usuario, y las operaciones sensibles se validan en Edge Functions o funciones SQL `security definer`, nunca solo en el frontend.

## Lógica de servidor

Regla general: **CRUD directo con supabase-js + RLS; lógica crítica en el servidor.**

Va en Edge Functions / funciones SQL (transaccional, no confiable al navegador):

- Emisión de factura (número secuencial NCF por tenant/tipo — con lock).
- Cierre/cuadre de caja.
- Conversión cotización → venta (unificando la regla de descuentos/ITBIS).
- Registro de pagos de crédito (recalcular saldo).
- Transferencias entre sucursales (descontar/acreditar stock atómicamente).
- (Fase 6) Construcción, firma y envío del XML e-CF a DGII.

## Preparación DGII e-CF desde el día 1

- `tenants` guarda RNC, razón social, régimen.
- `secuencias_ncf`: por tenant + tipo de comprobante (B01, B02, ... y sus equivalentes e-CF E31, E32...), rango autorizado, próximo número, fecha de vencimiento.
- `facturas` guarda `tipo_comprobante`, `ncf`, y campos reservados: `ecf_track_id`, `ecf_estado`, `ecf_xml_url`, `ecf_qr`.
- Así, activar e-CF luego es agregar el módulo de firma/envío, **sin migrar datos**.

## Entornos

- `dev`: proyecto Supabase de desarrollo + Cloudflare Pages preview.
- `prod`: proyecto Supabase de producción + dominio propio en Cloudflare.
- Migraciones SQL versionadas en `supabase/migrations/` (CLI de Supabase), nunca cambios a mano en producción.
