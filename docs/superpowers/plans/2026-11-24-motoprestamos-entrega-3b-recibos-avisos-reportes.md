# Motopréstamos · Entrega 3B (recibo del abono, avisos por WhatsApp y reportes de cobranza) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar la cobranza en la calle:
- al cobrar, el cobrador imprime el recibo o se lo manda al cliente por WhatsApp;
- cada mañana manda los avisos de cuota con un toque por cliente;
- la oficina ve cuánto cobra cada cobrador, sus entregas y lo que tiene en mano.

**Architecture:**
- **Recibo:** el mismo recibo térmico de la oficina (`ReceiptBody` de `payment-receipt-dialog.tsx`).
  - **Imprimir:** se imprime tal cual.
  - **Enviar por WhatsApp:** el PDF sale del recibo en pantalla (`generateReceiptPdf`) y se sube por `receipt-link`, ampliado a abonos. El enlace corto lo sigue resolviendo la función `c`, que no cambia.
  - **Enlaces:** `receipt_links` ya no exige venta y apunta a la venta **o** al abono.
- **Mensajes:** dos plantillas por empresa en `motos_settings` (aviso y recibo), con marcadores `{…}` como el contrato. Si están vacías se usa el texto base. Se editan en Configuración → General.
- **Avisos:** una página que arma la lista con las mismas cuentas de la ruta (`useCuentasDeCobro`) y abre `wa.me` con el mensaje escrito. No se guarda nada en la base.
- **Reportes:**
  - **Cobranza por cobrador:** una RPC (`cobranza_reporte`) que calcula en la base, sin el tope de 1000 filas y probable con la suite SQL.
  - **Cuadres:** se arma con la tabla de entregas.
  - **Antigüedad:** gana un filtro por cobrador.

**Tech Stack:** Next 14 (export estático), TypeScript, Supabase/Postgres y Edge Functions (Deno), `node --test`, suites SQL en `begin … rollback`.

**Spec:** `docs/superpowers/specs/2026-11-23-motoprestamos-design.md`, "Entrega 3 — Cobranza en la calle" (Cobrar: «Enviar recibo por WhatsApp … e Imprimir»; "Avisos por WhatsApp"; "Reportes de la entrega 3"; Configuración → General: «el texto del mensaje de WhatsApp de avisos y recibos»).

Base: rama `claude/motoprestamos-entrega-3a` (PR #85).

## Decisiones de este plan (para que Louis las revise)

- **Recibo:**
  - Es el mismo recibo de abono que ya imprime la oficina: no hay un formato nuevo.
  - El enlace vive 15 días, como el plan de pagos.
  - Sin teléfono del cliente, WhatsApp abre para elegir el chat.
  - No se manda recibo de un abono anulado.
- **Avisos:**
  - La lista incluye a quien tiene cuota mañana, cuota hoy o algo atrasado.
  - El cobrador ve su cartera. Quien tiene «ver todas las rutas» ve toda la sucursal (también lo no asignado) y puede filtrar por cobrador.
  - «Enviado hoy» se marca en ese teléfono (almacenamiento local), no en la base. Si dos personas mandan avisos, pueden repetir.
- **Plantillas:**
  - **Aviso:** marcadores `{cliente}`, `{monto}`, `{estado}`, `{fecha}`, `{empresa}`. `{estado}` es «vence mañana», «vence hoy» o «tiene N días de atraso».
  - **Recibo:** marcadores `{cliente}`, `{monto}`, `{saldo}`, `{fecha}`, `{enlace}`, `{vence}`, `{empresa}`.
  - Un marcador desconocido se deja tal cual, y Configuración lo avisa, como en el contrato.
- **Reporte «Cobranza por cobrador»** (período elegido, sucursal activa):
  - **Por cobrar:** lo que vencía en el período en las cuotas de los clientes de su cartera **actual**, pagado o no. No hay historial de asignaciones.
  - **Cobrado:** sus abonos no anulados con fecha local (hora de la empresa) en el período, de todo método.
  - **Efectividad:** cobrado ÷ por cobrar, sin tope (puede pasar de 100 % si cobró atrasos). Si no había nada por cobrar, sale «—».
  - **Visitas:** las suyas en el período, incluidos los pagos.
  - **Promesas:** cuentan las que tienen fecha en el período y ya pasaron.
    - **Cumplida:** el cliente hizo algún abono no anulado en la sucursal entre el día de la visita y el de la promesa.
    - **Incumplida:** las demás.
    - Las promesas de hoy en adelante no cuentan.
  - **Atrasados en su cartera:** hoy, clientes de su cartera con una cuota vencida sin pagar.
  - **«Sin asignar»:** una fila con lo por cobrar y los atrasados de los clientes sin cobrador.
  - **En mano ahora:** efectivo sin entregar por cobrador y desde cuándo. Va en la misma página.
- **Reporte «Cuadres de cobradores»:** entregas del período, con totales por cobrador (esperado, recibido, diferencia) y el detalle.
- **Antigüedad de cartera:** con el módulo encendido, un selector «Cobrador» filtra las cuentas por los clientes asignados en la sucursal activa.

## Global Constraints

- **Permisos:**
  - Los reportes usan el permiso `reports` de siempre y solo aparecen con el módulo `motoprestamos` encendido (mismo criterio que `vehiculos` en `authed-layout.tsx`).
  - Avisos usa `cobranza` (`view`).
  - `cobranza_reporte` exige ser admin, o tener `cobranza-all:view` o `reports:view` en la sucursal (`cobranza_tengo_permiso`). Si no, lanza `No tienes permiso para ver los reportes de cobranza.`
- **Fechas:** el día local sale de la zona de la empresa, como `company_today`: `timezone(coalesce(nullif(btrim(companies.timezone),''),'America/Santo_Domingo'), ts)::date`. El front usa `hoyLocal`/`fechaLocal`.
- **`receipt-link`:** sin `abono` en el cuerpo se comporta **exactamente** igual que hoy (facturas, planes y estados; enlaces ya enviados). Con `abono`:
  - **Validaciones:**
    - El abono debe existir: `Abono no encontrado.` (404).
    - Debe ser de la empresa: `No tienes permiso para acceder a este abono.` (403).
    - No debe estar anulado: `Este abono fue anulado.` (409).
  - **Archivo:** ruta `<empresa>/abonos/<paymentId>.pdf`, descarga `recibo-de-abono.pdf`, 15 días.
- **`receipt_links`:**
  - `sale_id` pasa a admitir null.
  - Gana `loan_payment_id` y `credit_payment_id` (FK `on delete cascade`).
  - Check `receipt_links_un_documento`: `num_nonnulls(sale_id, loan_payment_id, credit_payment_id) = 1`.
- **Textos base** (en `src/lib/cobranza-mensajes.ts`):
  - **Aviso:** `Hola {cliente}, le recordamos que su cuota de {monto} {estado}. Gracias por mantenerse al día. {empresa}`
  - **Recibo:** `Hola {cliente}, recibimos su pago de {monto} el {fecha}. Saldo pendiente: {saldo}. Su recibo: {enlace} (disponible hasta el {vence}). {empresa}`
- **Migración nueva:** `supabase/migrations/20261125140000_cobranza_recibos_y_reportes.sql`.
  - Grants explícitos.
  - `revoke execute … from public, anon` en la RPC.
  - No cambia ninguna función viva. `motos_ajuste` lee por nombre, así que las columnas nuevas no la rompen.
- **Edge Function:** `receipt-link` se despliega en la Task 8, después de la revisión. Es compatible con el front de producción.
- **Empresa demo:** `…0aa`, sucursal `…0b1`, súper admin `92381752-…`. La demo emite e-CF: en pantalla solo se cobran abonos de préstamo de prueba.
- **Textos y pantallas:** en español. Avisos y el recibo en la ruta, primero móvil. Sin dependencias nuevas.

## Review Focus

1. **Front viejo y enlaces ya enviados:** `receipt-link` sin `abono` y la tabla con filas viejas tienen que dar lo mismo que hoy. → Task 3 (pruebas de `_shared`) y Task 1 (el check acepta las filas existentes).
2. **Recibo de un abono ajeno o anulado:** rechazado en la función, no solo en la pantalla. → Task 3.
3. **Zona horaria:** un abono a las 9 p. m. en RD (01:00 UTC del día siguiente) cuenta en el día local del reporte. → Task 1 (suite).
4. **Promesas:** una de fecha futura no cuenta como incumplida; un pago el mismo día de la visita cumple la promesa; un abono anulado no la cumple. → Task 1.
5. **Plantilla con marcador mal escrito:** el mensaje sale igual, con el marcador a la vista, y Configuración lo avisa. → Task 2 y Task 4.

---

### Task 1: Migración — enlaces de abonos, plantillas y reporte de cobranza

**Files:**
- Create: `supabase/migrations/20261125140000_cobranza_recibos_y_reportes.sql`
- Modify: `supabase/tests/cobranza.sql` (§4)

**Interfaces:**
- Produces:
  - **`receipt_links`:**
    - `sale_id` admite null;
    - columnas `loan_payment_id uuid references loan_payments on delete cascade` y `credit_payment_id uuid references credit_payments on delete cascade`;
    - check `receipt_links_un_documento`;
    - índices `receipt_links_loan_payment_idx` y `receipt_links_credit_payment_idx`.
  - **`motos_settings`:** columnas `whatsapp_reminder text` y `whatsapp_receipt text` (null = texto base).
  - **`cobranza_reporte(p_branch_id uuid, p_desde date, p_hasta date) returns jsonb`**, security definer, `search_path = public`:
    - Devuelve `{ cobradores: [{ collector_id, nombre, por_cobrar, cobrado, visitas, promesas_cumplidas, promesas_incumplidas, atrasados, en_mano, en_mano_desde }], sin_asignar: { por_cobrar, atrasados } }`.
    - `nombre` sale de `profiles.name`.
    - `en_mano_desde` es la fecha local del abono más viejo en la calle, o null.
    - Incluye todos los cobradores de la sucursal, activos o no, si tienen algún dato.

- [ ] **Step 1: Suite §4** (datos con UUID fijos `…e7XX` en la demo, b1; préstamos semanales de prueba como en §2):
  - cobrador e7c1 con cliente e701 (cuotas que vencen en el período) y e702 sin asignar;
  - por cobrar de e7c1 = suma de las cuotas de e701 con vencimiento en el período (pagadas o no);
  - cobrado = sus abonos del período; un abono anulado no cuenta; uno con `date` a las 01:00 UTC del día siguiente al período (21:00 en RD) **sí** cuenta;
  - promesas:
    - una con fecha ayer y un abono el día de la visita → cumplida;
    - una con fecha ayer sin abono → incumplida;
    - una con fecha ayer y solo un abono anulado → incumplida;
    - una con fecha mañana → no cuenta;
  - `atrasados` = 1 con una cuota de e701 vencida ayer sin pagar;
  - `en_mano` y `en_mano_desde` de un abono en la calle sin entregar;
  - `sin_asignar.por_cobrar` y `sin_asignar.atrasados` con e702;
  - `cc56c633` con solo el rol Cobrador → `%No tienes permiso para ver los reportes de cobranza%`;
  - `receipt_links`:
    - con `loan_payment_id` y sin `sale_id` se inserta;
    - sin ninguno de los tres falla `%receipt_links_un_documento%`;
    - con dos falla igual;
    - `select count(*) from receipt_links where num_nonnulls(sale_id, loan_payment_id, credit_payment_id) <> 1` = 0 (las filas existentes valen);
  - `motos_ajuste` de una empresa sin fila sigue dando `whatsapp_reminder` null.
- [ ] **Step 2:** Correr la suite sin la migración (con las de 3A ya aplicadas) → falla porque `cobranza_reporte` no existe.
- [ ] **Step 3:** Escribir la migración.
- [ ] **Step 4:** `begin; <esta> <cobranza.sql completa> rollback;` → `ok`.
- [ ] **Step 5:** Commit: `Motopréstamos: enlaces de recibos de abono, plantillas y reporte de cobranza`.

### Task 2: Lógica pura de mensajes, avisos y entregas

**Files:**
- Create: `src/lib/cobranza-mensajes.ts`
- Modify: `src/lib/cobranza.ts`, `supabase/functions/_shared/documentos.ts`
- Test: `scripts/tests/cobranza.test.mjs`, `scripts/tests/documentos-edge.test.mjs`

**Interfaces:**
- Produces:
  - **`cobranza-mensajes.ts`:**
    - `AVISO_BASE: string`, `RECIBO_BASE: string` (textos de Global Constraints);
    - `MARCADORES_AVISO`, `MARCADORES_RECIBO: { clave: string; descripcion: string }[]`;
    - `llenarMensaje(plantilla: string, valores: Record<string, string | undefined>): string`: deja tal cual un marcador desconocido o sin valor;
    - `marcadoresDesconocidosEn(plantilla: string, validos: string[]): string[]`;
    - `estadoDeCuota(motivo: 'manana' | 'hoy' | 'atrasado', dias: number): string` → «vence mañana» / «vence hoy» / «tiene 1 día de atraso» / «tiene N días de atraso»;
    - `plantillaParaGuardar(texto: string | undefined): string | null`: recorta; vacío o igual al texto base → null (se usa el base).
  - **`cobranza.ts`:**
    - `type Aviso = { customerId: string; motivo: 'manana' | 'hoy' | 'atrasado'; diasAtraso: number; monto: number; fecha: string }`;
    - `avisosDelDia(cuentas: CuentaDeCobro[], hoy: string, clientes?: Set<string>): Aviso[]`:
      - una fila por cliente, con el motivo dominante (atrasado > hoy > mañana);
      - `monto` = sugerido (cuota + mora, sin pasar de lo pendiente) de lo que toca hoy o está atrasado; si solo es mañana, lo que falta de la cuota de mañana;
      - `fecha` = la de la cuota más vieja que toca;
      - con `clientes`, solo esos;
      - orden: atrasados de más a menos días, luego hoy, luego mañana.
    - `resumenDeEntregas(entregas: { collectorId: string; expected: number; received: number; difference: number }[]): { collectorId: string; entregas: number; esperado: number; recibido: number; diferencia: number }[]`, en centavos exactos.
  - **`_shared/documentos.ts`:**
    - `rutaDelRecibo(companyId: string, paymentId: string): string` → `<empresa>/abonos/<paymentId>.pdf`;
    - `NOMBRE_RECIBO = 'recibo-de-abono.pdf'`;
    - `DIAS_RECIBO = 15`;
    - `abonoValido(x: unknown): { tipo: 'prestamo' | 'venta'; paymentId: string } | null`: null si no es un objeto con `tipo` válido y un `paymentId` uuid.
- [ ] **Step 1: Pruebas:**
  - `llenarMensaje` con todos los marcadores; con `{clienteX}` lo deja igual; con un valor `undefined` lo deja igual;
  - `marcadoresDesconocidosEn('Hola {cliente} {nombre}', ['cliente'])` → `['nombre']`;
  - `estadoDeCuota` en singular y plural;
  - `plantillaParaGuardar`: `'  '` → null, el texto base → null, un texto propio → recortado;
  - `avisosDelDia`:
    - cuota mañana (`proximaFecha` = hoy + 1) → `manana`;
    - cuota hoy → `hoy`;
    - atrasado 6 días → `atrasado` con su monto;
    - sin nada en los próximos días → fuera;
    - filtro por `clientes`;
    - orden;
  - `resumenDeEntregas` suma por cobrador sin errores de redondeo (0.1 + 0.2);
  - `rutaDelRecibo` y `abonoValido` (tipo malo, uuid malo, vacío);
  - lo de la factura en `documentos-edge.test.mjs` sigue pasando sin cambios.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`npm test`).
- [ ] **Step 5:** Commit: `Motopréstamos: mensajes de WhatsApp, avisos del día y resumen de entregas`.

### Task 3: `receipt-link` comparte el recibo de un abono

**Files:**
- Modify: `supabase/functions/receipt-link/index.ts`
- Test: `scripts/tests/documentos-edge.test.mjs` (lo puro); la función se prueba en la Task 8, desplegada.

**Interfaces:**
- Consumes: Task 2 (`abonoValido`, `rutaDelRecibo`, `NOMBRE_RECIBO`, `DIAS_RECIBO`), Task 1 (columnas de `receipt_links`).
- Produces: el cuerpo admite `{ abono: { tipo, paymentId }, paso }` en lugar de `saleId`; la respuesta tiene la misma forma (`ruta`, `uploadToken` / `url`, `diasValidez`, `venceEl`).
- [ ] **Step 1:** Con `abono` válido:
  - **Lee el abono:** de `loan_payments` o `credit_payments` (`id, company_id, voided_at`), con los mensajes y códigos de Global Constraints.
  - **Enlace:** reutiliza el vigente por `storage_path` como hoy e inserta con `loan_payment_id` o `credit_payment_id` (sin `sale_id`).
  - **Sin `abono`:** el código de la venta queda igual, línea por línea.
- [ ] **Step 2:** `deno check` si está disponible; si no, revisión de tipos a mano y `npm test`.
- [ ] **Step 3:** Commit: `receipt-link: recibo de abono`.

### Task 4: Front — plantillas y datos del recibo

**Files:**
- Modify:
  - `src/lib/types.ts` (`MotosSettings.whatsappReminder?`, `whatsappReceipt?`), `src/lib/supabase/mappers.ts`;
  - `src/components/motos/config/general-tab.tsx` (dos textareas con sus marcadores, aviso de desconocidos, «Usar texto base»);
  - `src/hooks/use-cobranza.ts` (`registrarAbono` devuelve además `recibo: PaymentResult`, armado como en `register-loan-payment-dialog.tsx`);
  - `src/lib/receipt-sharing.ts`;
  - `src/components/credit/payment-receipt-dialog.tsx` (exportar `ReceiptBody`).
- Test: lo puro ya quedó probado en la Task 2 (`plantillaParaGuardar`); aquí la verificación es `npx tsc --noEmit` y la pantalla de la Task 8.

**Interfaces:**
- Consumes: Task 1 (columnas), Task 2 (mensajes), Task 3 (cuerpo de `receipt-link`).
- Produces:
  - `compartirReciboDeAbono(abono: { tipo: 'prestamo' | 'venta'; paymentId: string }, pdfBase64: string, mensaje: (url: string, venceEl: string) => string, telefono?: string, ventana?: Window | null): Promise<{ url: string; venceEl: string; abrioWhatsApp: boolean }>`, mismo orden subida → archivo → enlace que `shareSalePdfLinkViaWhatsApp`;
  - `CobroDeRuta` gana `recibo: PaymentResult` y `tipoAbono: 'prestamo' | 'venta'` (el abono general queda en `credit_payments`: su recibo es `venta`).
  - El mapper guarda las plantillas con `plantillaParaGuardar` y lee null como `undefined`.
- [ ] **Step 1:** Implementar. `npx tsc --noEmit`.
- [ ] **Step 2:** Commit: `Motopréstamos: plantillas de WhatsApp y datos del recibo`.

### Task 5: Recibo en la ruta

**Files:**
- Modify: `src/components/motos/cobranza/cobrar-dialog.tsx`, `src/app/(app)/motos/cobranza/page.tsx` (pasa teléfono, sucursal y plantilla)

**Interfaces:**
- Consumes: Task 4.
- [ ] **Step 1:** En la pantalla de «Abono registrado»:
  - **Imprimir recibo:** `useReactToPrint` sobre una copia oculta de `ReceiptBody`, como el diálogo de la oficina.
  - **Enviar por WhatsApp:**
    - en el escritorio abre la pestaña antes (`abrirPestanaParaWhatsApp`, sin await, primera línea del clic);
    - genera el PDF de la copia, comparte y llena el mensaje con la plantilla `whatsappReceipt` o `RECIBO_BASE`.
  - **Si el navegador bloquea la pestaña:** queda un botón «Abrir WhatsApp» con el enlace ya hecho.
  - **Errores:** van tal cual en un toast.
  - **Abono repetido** (`repetido`): igual se puede imprimir y enviar.
- [ ] **Step 2:** `npx tsc --noEmit`; commit: `Motopréstamos: imprimir y enviar el recibo desde la ruta`.

### Task 6: Avisos de hoy

**Files:**
- Create: `src/app/(app)/motos/cobranza/avisos/page.tsx`
- Modify: `src/app/(app)/authed-layout.tsx` (ítem «Avisos de cobro», `/motos/cobranza/avisos`, módulo `motoprestamos`, permiso `cobranza`)

**Interfaces:**
- Consumes: Task 2 (`avisosDelDia`, `llenarMensaje`, `estadoDeCuota`, `AVISO_BASE`), `useCuentasDeCobro`, `useCobranza` (cartera), `useMotosAjustes`.
- [ ] **Step 1:** Página primero móvil:
  - **Encabezado:** cuántos avisos hay y cuántos se enviaron hoy.
  - **Filas:** cliente (y apodo), motivo (`estadoDeCuota`), monto y fecha, con el botón **WhatsApp** (`wa.me/<whatsappPhone>?text=…`; sin teléfono, sin número).
  - **Al tocar:** marca «Enviado» en `localStorage` (clave `avisos:<branchId>:<hoy>`).
  - **Quién ve qué:** el cobrador sin `cobranza-all` ve solo su cartera; con `cobranza-all`, toda la sucursal y un selector de cobrador (incluye «Sin asignar»).
  - **Plantilla con marcadores desconocidos:** aviso arriba, con enlace a Configuración.
- [ ] **Step 2:** `npx tsc --noEmit`; commit: `Motopréstamos: avisos de cobro por WhatsApp`.

### Task 7: Reportes de cobranza

**Files:**
- Create: `src/app/(app)/reports/cobranza/page.tsx`, `src/app/(app)/reports/cuadres/page.tsx`
- Modify: `src/app/(app)/authed-layout.tsx` (`reportsNavItems` y filtro por módulo de `cobranza` y `cuadres`), `src/app/(app)/reports/antiguedad/page.tsx`

**Interfaces:**
- Consumes: Task 1 (`cobranza_reporte`), Task 2 (`resumenDeEntregas`), `fetchAllRows`, `ExportButton`.
- [ ] **Step 1: Cobranza por cobrador:**
  - **Filtro:** período (hoy, esta semana, este mes, personalizado, como los demás reportes) de la sucursal activa.
  - **Tabla por cobrador:** por cobrar, cobrado, efectividad, visitas, promesas cumplidas/incumplidas, atrasados; fila «Sin asignar» y totales.
  - **Debajo, «En mano ahora»:** por cobrador, monto y «desde», con el más viejo resaltado si pasa de un día.
  - Exportar.
- [ ] **Step 2: Cuadres de cobradores:**
  - entregas del período (`collector_settlements` por `created_at`, con `fetchAllRows`);
  - totales con `resumenDeEntregas` y la lista con fecha, cobrador, esperado, recibido, diferencia, nota y quién recibió;
  - exportar.
- [ ] **Step 3: Antigüedad:** con el módulo encendido, un selector «Cobrador» (cobradores de la sucursal activa y «Sin asignar»). Las cuentas se filtran por los clientes de su cartera.
- [ ] **Step 4:** `npx tsc --noEmit`; commit: `Motopréstamos: reportes de cobranza, cuadres y antigüedad por cobrador`.

### Task 8: Revisión, aplicar, desplegar, probar en pantalla y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit`, `next build` (sin `next dev` vivo).
- [ ] **Step 2: Revisión final** de toda la rama (subagente opus) y un pase de arreglos con prueba que falla primero.
- [ ] **Step 3: Aplicar y desplegar:**
  - aplicar la migración con `apply_migration` y comprobar el md5 del cuerpo de `cobranza_reporte` contra el archivo;
  - correr `cobranza.sql` contra lo aplicado;
  - desplegar `receipt-link` con `deploy_edge_function` y comprobar que una factura se sigue compartiendo: desde la app en la demo, `supabase.functions.invoke('receipt-link', { body: { saleId: <venta de la demo> } })` devuelve la misma `ruta` de siempre (`<empresa>/<venta>.pdf`; el paso de subida no emite ni envía nada);
  - `get_advisors` y logs de la API sin `42501`.
- [ ] **Step 4: En pantalla** (demo; módulo encendido solo para la prueba; préstamo de prueba por SQL como en 3A):
  - cobrar por transferencia y luego imprimir y enviar el recibo (abrir el enlace `sellalles.com/<empresa>/c/<código>` y ver que baja el PDF);
  - la página de avisos con una plantilla propia;
  - los dos reportes y el filtro de antigüedad.
  - Al terminar, borrar todo lo de prueba (enlaces y PDF en `comprobantes/<demo>/abonos/` incluidos), apagar el módulo y quitar el rol Cobrador de la demo.
- [ ] **Step 5:** Estado de 3B en el spec; commit, push y PR. La base es `claude/motoprestamos-entrega-3a`, o `main` si ya se fusionó. No fusionar sin Louis.
