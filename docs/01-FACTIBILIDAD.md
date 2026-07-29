# Análisis de factibilidad — LhEs_Ventas → SELLALLES WEB 2.1

## Veredicto: FACTIBLE (alto)

La migración es completamente factible, con una aclaración importante: **no es una conversión del código, es una reescritura funcional**. El código WinForms (C# de escritorio, decompilado) no se puede "poner en la web"; lo que sí se migra intacto es lo más valioso:

1. **El modelo de negocio** — módulos, reglas, flujos (cotización → venta, crédito con histórico de pagos, transferencias entre sucursales).
2. **El modelo de datos** — las tablas de SQL Server se traducen casi 1:1 a PostgreSQL, agregando la dimensión `tenant_id`.
3. **La experiencia acumulada** — ya se sabe qué funciona y qué no del sistema actual.

## Punto clave a favor: ya es multisucursal

El sistema actual ya maneja sucursales, transferencias entre sucursales, asignación usuario-sucursal y búsqueda de artículos en otra sucursal. Convertirlo en SaaS multitenant es **agregar una dimensión más arriba** (empresa/tenant), no rediseñar el dominio desde cero. Eso reduce el riesgo de diseño considerablemente.

## Inventario de módulos del sistema actual y su destino web

| Módulo actual (capa lógica) | Destino en web | Dificultad | Fase |
|---|---|---|---|
| Usuarios / Permisos / Login | Supabase Auth + roles por tenant/sucursal | Baja | 1 |
| Sucursales / UsuarioSucursal | Tabla `sucursales` + claims JWT | Baja | 1 |
| Productos / Categorías / Ubicaciones | CRUD estándar + imágenes en Supabase Storage | Baja | 2 |
| Inventario / Transferencias | Stock por sucursal + movimientos | Media | 2 |
| Ventas / Facturas / DetalleFactura | POS web (carrito, cobro, ticket) | Media | 3 |
| Caja (abrir/cerrar, cuadre) | Sesiones de caja por sucursal | Media | 3 |
| Clientes / Direcciones | CRUD estándar | Baja | 3 |
| Cotizaciones + Seguimiento + conversión a venta | Igual que el patrón actual (`PrecargarDesdeCotizacion`) | Media | 4 |
| Ventas a crédito / Financiamiento / HistoricoPagos | Cuentas por cobrar + plan de pagos | Media-Alta | 4 |
| Órdenes de servicio (reparaciones) / Citas | Flujo de estados + agenda | Media | 5 |
| Pedidos | Patrón moderno del sistema actual — referencia de diseño | Media | 5 |
| Gastos / Proveedores | CRUD + reportes | Baja | 5 |
| Reportes / Resumen | Vistas SQL + dashboard con gráficas | Media | 5 |
| Perfil de empresa | Configuración del tenant (RNC, logo, secuencias NCF) | Baja | 1 |
| Lavandería | Deshabilitado en el sistema actual — **no se migra** (se puede activar por tenant a futuro) | — | — |
| Impresión de tickets (RawPrinterHelper) | QZ Tray o PDF — ver riesgo #1 | Media | 3 |

## Elección de base de datos: Supabase vs SQL Azure

**Recomendación: Supabase (PostgreSQL).** Razones:

- **Row Level Security (RLS)**: el aislamiento por tenant se declara en la base de datos misma (`tenant_id = jwt.tenant_id` en cada tabla). Es el mecanismo estándar de la industria para SaaS multitenant y elimina la clase de bug más peligrosa (fuga de datos entre empresas). En SQL Azure habría que construirlo a mano en la capa de aplicación.
- **Auth incluida**: login, recuperación de contraseña, JWT con claims personalizados — sin escribir un servidor de autenticación.
- **Realtime incluido**: stock y ventas en vivo entre cajas/sucursales.
- **Storage incluido**: imágenes de productos (hoy `FrmAsociarImagen`/`ImagenHelper`).
- **Costo**: capa gratuita generosa para desarrollo; el plan Pro (~$25/mes) aguanta los primeros tenants. SQL Azure de entrada cuesta más y no trae auth/realtime/storage.
- T-SQL → PostgreSQL es una traducción directa para el tipo de esquema que tiene LhEs (tablas relacionales clásicas, sin SQLCLR ni features exóticos).

SQL Azure quedaría como opción solo si en el futuro un cliente corporativo exige ecosistema Microsoft; no aporta nada hoy.

## Riesgos y cómo se mitigan

1. **Impresión de tickets térmicos** (el mayor cambio real vs escritorio). El navegador no habla directo con impresoras ESC/POS. Solución: **QZ Tray** (agente local gratuito para uso no firmado / licencia para producción) o impresión como PDF de 80mm vía diálogo del navegador. Se decide en Fase 3 con la impresora real del negocio.
2. **Conectividad**: un POS de escritorio funciona sin internet; uno web no (de entrada). Mitigación futura: PWA con cola offline (IndexedDB) — Fase post-lanzamiento, no bloquea el MVP.
3. **Facturación electrónica DGII (e-CF)**: requiere certificado digital, firma XML y comunicación con la API de DGII. Es un proyecto en sí mismo, pero el diseño lo contempla desde el día 1 (tablas de secuencias NCF/e-NCF por tenant, campos de RNC, tipos de comprobante). Cuando llegue el momento se decide: integración directa con DGII o vía un proveedor certificado de facturación electrónica (más rápido de certificar).
4. **Reescritura de reglas de negocio**: el modelo de descuento/ITBIS difiere entre módulos en el sistema actual (ya detectado en cotizaciones vs ventas) — la web es la oportunidad de **unificar** esas reglas en un solo lugar (funciones SQL/Edge Functions).

## Tecnologías adicionales que van a hacer falta (aviso solicitado)

- **QZ Tray** — impresión térmica desde navegador (Fase 3).
- **Certificado digital DGII + librería de firma XML** — cuando se active e-CF.
- **Resend o similar** — envío de facturas/cotizaciones por correo (opcional, Fase 4+).
- **Sentry** (opcional) — monitoreo de errores en producción.

## Esfuerzo estimado

Trabajando por fases (ver [Roadmap](04-ROADMAP.md)): un MVP vendible (auth + productos + inventario + POS + caja + tickets) es alcanzable en **Fases 1–3**. Crédito, cotizaciones, reparaciones y reportes completan la paridad con el escritorio en Fases 4–5. e-CF DGII es la Fase 6.
