# Roadmap por fases

Cada fase termina con algo usable en el navegador. El orden replica la dependencia natural del negocio: no hay venta sin producto, no hay producto sin sucursal, no hay sucursal sin tenant.

## Fase 0 — Infraestructura (1 sesión de trabajo)
- [ ] Autorizar conector MCP de Supabase / crear proyecto Supabase `sellalles-dev`.
- [ ] Scaffold frontend: `npm create vite@latest app -- --template react-ts` + Tailwind + shadcn/ui + supabase-js + TanStack Query + React Router.
- [ ] Deploy inicial a Cloudflare Pages (aunque sea la pantalla de login vacía).
- [ ] Inicializar git.

## Fase 1 — Núcleo SaaS: tenants, auth y sucursales
- [ ] Migración: `tenants`, `sucursales`, `usuarios`, `usuario_sucursal`, `secuencias_ncf` + RLS.
- [ ] Login con Supabase Auth; claims de `tenant_id`/rol en el JWT (auth hook).
- [ ] Selector de sucursal al entrar (equivale a `FrmSelectorSucursal`).
- [ ] Pantalla de administración del SaaS (alta de tenants) — solo superadmin.
- [ ] Perfil de empresa (RNC, logo, secuencias NCF) — equivale a PerfilEmpresa.

## Fase 2 — Catálogo e inventario
- [ ] Migración: `categorias`, `productos`, `inventario`, `transferencias` + RLS.
- [ ] CRUD de productos con imagen (Supabase Storage) y código de barras.
- [ ] Stock por sucursal + consulta de stock en otras sucursales.
- [ ] Transferencias entre sucursales (solicitar → enviar → recibir).
- [ ] **Importador desde el sistema actual**: script que lee SQL Server de LhEs y carga productos/clientes del primer tenant real.

## Fase 3 — POS: ventas, caja y tickets (fin del MVP vendible)
- [ ] Migración: `clientes`, `cajas`, `facturas`, `factura_detalle` + funciones SQL de emisión (NCF con lock, totales en servidor).
- [ ] Pantalla POS: búsqueda por código/nombre, carrito, descuentos, ITBIS, métodos de pago.
- [ ] Apertura/cierre/cuadre de caja.
- [ ] Ticket 80mm: primero PDF imprimible, luego QZ Tray para térmica directa.
- [ ] Devoluciones con autorización de admin (equivale a Login_AutenticarADMIN_Devolucion).

## Fase 4 — Cotizaciones y crédito
- [ ] Cotizaciones con estados y seguimiento; conversión a factura (unificando la regla de descuento/ITBIS que hoy difiere entre módulos).
- [ ] Envío de cotización por correo/WhatsApp (link público de solo lectura).
- [ ] Ventas a crédito: límite por cliente, plan de pagos, registro de abonos, estado de cuenta.

## Fase 5 — Servicios, pedidos y reportes
- [ ] Órdenes de servicio (reparaciones) con flujo de estados + citas/agenda.
- [ ] Pedidos (siguiendo el patrón del módulo moderno actual).
- [ ] Gastos y proveedores.
- [ ] Dashboard: ventas del día/mes por sucursal, top productos, cuadres, CxC.

## Fase 6 — Facturación electrónica DGII (e-CF)
- [ ] Decidir: integración directa (certificado digital + firma XML + API DGII) vs proveedor certificado.
- [ ] Edge Function de construcción y envío del e-CF; estados y QR en factura.
- [ ] Proceso de certificación con DGII por tenant.

## Post-lanzamiento (ideas, sin compromiso)
- PWA con modo offline para la caja (cola en IndexedDB).
- Módulo lavandería activable por tenant (hoy deshabilitado en escritorio).
- Facturación del SaaS mismo (cobro de suscripción a los tenants).
