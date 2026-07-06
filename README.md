# SellAlleS - Sistema de Punto de Venta

POS web moderno para el mercado de República Dominicana, construido con **Next.js 14** y **TypeScript**. SaaS multi-empresa sobre **Supabase**.

## Estado actual (2026-07-06)

**La app está conectada a Supabase**: autenticación (Supabase Auth + perfiles con rol y sucursal), productos, clientes, ventas, sucursales, gastos, suplidores, usuarios y roles leen/escriben en la base con RLS multi-empresa. El carrito vive en el navegador (Zustand + localStorage) hasta el cobro; al confirmar, la venta se inserta en `sales`/`sale_items` y el **NCF lo asigna la base** (trigger `set_sale_ncf` sobre `ncf_sequences`, solo si la empresa tiene `ncf_enabled`). Los abonos de crédito/financiamiento se guardan en `credit_payments`.

Nota histórica: versiones anteriores de este README decían "datos de demostración en memoria"; eso ya no aplica (el módulo `src/lib/database.ts` del modo demo fue eliminado).

## Características Principales

- **Punto de Venta (POS)**: gestión de múltiples carritos, búsqueda por nombre o código de barras.
- **Gestión Financiera**: ventas a crédito, planes de financiamiento con cuotas e intereses, y gestión de mora.
- **NCF Dominicano**: soporte para comprobantes fiscales (Consumidor Final y Crédito Fiscal).
- **Reportes**: resumen de ventas, productos más vendidos, ventas por usuario e ingresos por fechas.
- **Multisucursal**: inventario y ventas segregados por sucursal.

## Stack Tecnológico

- **Framework**: Next.js 14 (App Router)
- **Lenguaje**: TypeScript
- **Estilos**: Tailwind CSS + Shadcn UI
- **Estado**: Zustand + React Context
- **Backend (próxima fase)**: Supabase (PostgreSQL + Auth + RLS multi-empresa)

## Configuración Local

1. **Instalar dependencias**:
   ```bash
   npm install
   ```
2. **Ejecutar el servidor de desarrollo**:
   ```bash
   npm run dev
   ```
   La app abre en `http://localhost:9002` (o el puerto que indique Next). Inicia sesión con cualquier email/contraseña; el usuario de demostración admin es `loui-s@hotmail.com`.

3. **(Próxima fase) Conectar Supabase**: copia `.env.example` a `.env.local` y completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Próximos pasos (roadmap SaaS)

1. Crear proyecto Supabase y el esquema con `empresa_id` + Row Level Security.
2. Reemplazar los datos en memoria (`src/context/*-provider.tsx`) por consultas a Supabase.
3. Reemplazar la autenticación local (`src/context/auth-provider.tsx`) por Supabase Auth.
4. Construir el panel de Super Admin (gestión de empresas) y las suscripciones.
5. Integrar facturación electrónica DGII (e-CF).

## Licencia

Propiedad de SellAlleS RD.
