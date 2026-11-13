# Datos del cliente en la factura, firmas, envío del plan y estado del financiamiento — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Factura con datos del cliente a pedido (configurable), firmas apiladas, y plan de pagos + estado del financiamiento enviables por WhatsApp/correo/PDF; logo de Comercial GP.

**Architecture:** Lógica pura en `src/lib/*.ts` y `supabase/functions/_shared/documentos.ts` (probada con `node --test`); la UI la consume. La configuración vive en dos columnas nuevas de `companies`. Las Edge Functions `receipt-link` y `send-sale-receipt` aprenden un parámetro `documento` que por defecto es `factura` (compatibilidad total con el front actual).

**Tech Stack:** Next 14 (export estático), React, shadcn/ui, Supabase (Postgres + Edge Functions Deno), `node --test` sobre `.ts` con tipos borrables.

**Spec:** `docs/superpowers/specs/2026-11-12-factura-datos-cliente-design.md`

## Global Constraints

- Trabajar en `app-wt/` (rama `claude/factura-datos-cliente`, desde `origin/main` 2ac1ef2).
- Módulos importados por las pruebas: solo sintaxis TS borrable, imports de tipos con `import type`, sin alias `@/` en imports de valor.
- Migración: nunca `supabase db push`; se aplica por MCP `apply_migration`. Columnas en tabla existente: sin grants nuevos.
- Orden de salida: migración → desplegar `receipt-link` y `send-sale-receipt` → merge del front.
- Campos válidos: `address`, `phone`, `email`. Defaults: `receipt_customer_info_enabled=false`, `receipt_customer_fields='{address,phone}'`.
- La factura de siempre no cambia de ruta ni de nombre: `<empresa>/<venta>.pdf`, `comprobante[-NCF].pdf`.
- Textos de UI en español, en el tono del resto de la app.

## Review Focus

- Cliente "Consumidor Final" o sin dirección/teléfono/correo → la casilla no aparece; nada vacío ("Dirección: ") en la factura.
- Reenviar la factura después de mandar el plan → el cliente conserva el mismo enlace de la factura (reutilización por ruta, no por venta).
- Front nuevo contra función vieja → no debe pasar: desplegar funciones antes del merge (y la función nueva sin `documento` se comporta igual que hoy).
- Configuración apagada después de haber estado encendida → ninguna casilla en el pago ni en Movimientos, aunque el cajero la hubiera marcado antes.
- Abonos anulados → no aparecen ni suman en el estado del financiamiento.

---

### Task 1: Lógica pura de datos del cliente

**Files:**
- Create: `src/lib/datos-cliente.ts`
- Test: `scripts/tests/datos-cliente.test.mjs`

**Interfaces:**
- Produces:
  - `type CampoCliente = 'address' | 'phone' | 'email'`
  - `const CAMPOS_CLIENTE: ReadonlyArray<{ campo: CampoCliente; etiqueta: string }>` = Dirección, Teléfono, Correo (en ese orden)
  - `normalizarCamposCliente(raw: unknown): CampoCliente[]` — filtra inválidos y repetidos, respeta el orden de `CAMPOS_CLIENTE`; no-array → `[]`
  - `lineasDatosCliente(customer: { address?: string; phone?: string; email?: string } | undefined, campos: CampoCliente[]): { etiqueta: string; valor: string }[]` — solo valores no vacíos tras `trim`
  - `puedeIncluirDatosCliente(enabled: boolean, campos: CampoCliente[], customer?): boolean` — `enabled && lineasDatosCliente(...).length > 0`

- [ ] **Step 1: Pruebas**
  - `normalizarCamposCliente(['email','address','x','address'])` → `['address','email']`; `normalizarCamposCliente(null)` → `[]`
  - `lineasDatosCliente({ address: ' Calle 1 ', phone: '', email: 'a@b.do' }, ['address','phone','email'])` → `[{etiqueta:'Dirección',valor:'Calle 1'},{etiqueta:'Correo',valor:'a@b.do'}]`
  - `lineasDatosCliente(undefined, ['address'])` → `[]`
  - `puedeIncluirDatosCliente(false, ['address'], {address:'x'})` → `false`; `(true, ['phone'], {address:'x'})` → `false`; `(true, ['address'], {address:'x'})` → `true`
- [ ] **Step 2:** `npm test` → FALLA (módulo no existe)
- [ ] **Step 3:** Implementar en `src/lib/datos-cliente.ts`
- [ ] **Step 4:** `npm test` → PASA
- [ ] **Step 5:** Commit `feat: lógica de datos del cliente en la factura`

### Task 2: Configuración en la empresa (migración + perfil + tarjeta)

**Files:**
- Create: `supabase/migrations/20261112180000_factura_datos_cliente.sql`
- Create: `src/components/company-profile/customer-info-settings-card.tsx`
- Modify: `src/lib/types.ts` (CompanyProfile), `src/lib/supabase/mappers.ts` (`rowToCompanyProfile`), `src/context/company-profile-provider.tsx` (EMPTY + `mergeProfile`), `src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: Task 1 (`CampoCliente`, `CAMPOS_CLIENTE`, `normalizarCamposCliente`)
- Produces:
  - `CompanyProfile.receiptCustomerInfoEnabled: boolean`, `CompanyProfile.receiptCustomerFields: CampoCliente[]`
  - `useCompanyProfile().mergeProfile(partial: Partial<CompanyProfile>): void` — solo estado local, no escribe en la base
  - `<CustomerInfoSettingsCard />`

- [ ] **Step 1:** Migración: `alter table public.companies add column if not exists receipt_customer_info_enabled boolean not null default false, add column if not exists receipt_customer_fields text[] not null default '{address,phone}'` + `check (receipt_customer_fields <@ array['address','phone','email']::text[])` con nombre `companies_receipt_customer_fields_check` + `comment on column` en ambas.
- [ ] **Step 2:** Aplicar por MCP `apply_migration` y verificar con `select column_name, column_default from information_schema.columns where table_name='companies' and column_name like 'receipt_customer%'` → 2 filas.
- [ ] **Step 3:** Tipos, mapper (`normalizarCamposCliente(r.receipt_customer_fields)`, ausente → `['address','phone']`), EMPTY, `mergeProfile`. **No** tocar `companyProfileToRow` (otras pantallas guardan el perfil y no deben pisar esto).
- [ ] **Step 4:** Tarjeta "Datos del cliente en la factura" con el patrón de `loyalty-settings-card.tsx` (carga y guarda directo en `companies`, luego `mergeProfile`): interruptor + una casilla por `CAMPOS_CLIENTE`; con el interruptor encendido y ninguna casilla marcada, no deja guardar. Va en `/settings` justo antes de `PrintSettingsCard`.
- [ ] **Step 5:** `npm run typecheck` → sin errores nuevos
- [ ] **Step 6:** Commit `feat: configuración de datos del cliente en la factura`

### Task 3: Casilla en el pago, la factura y Movimientos

**Files:**
- Create: `src/components/pos/incluir-datos-cliente.tsx`
- Modify: `src/components/pos/receipt-content.tsx` (`ReceiptHeader`, `ReceiptContent`), `src/components/pos/checkout-dialog.tsx`, `src/components/pos/cart-display.tsx`, `src/components/pos/receipt-dialog.tsx`, `src/app/(app)/sales/detail/sale-receipt-client.tsx`

**Interfaces:**
- Consumes: Task 1, Task 2 (`profile.receiptCustomerInfoEnabled`, `profile.receiptCustomerFields`)
- Produces:
  - `ReceiptHeader({ sale, showCustomerInfo?: boolean })`, `ReceiptContent({ sale, showCustomerInfo?: boolean })` — con `true` y la config encendida, imprime `lineasDatosCliente` bajo CLIENTE/RNC como `ETIQUETA: valor`
  - `<IncluirDatosCliente customer checked onCheckedChange />` — `null` si `!puedeIncluirDatosCliente(...)`; Checkbox "Incluir datos del cliente en la factura" + texto con qué datos saldrán
  - `CheckoutDialogProps.onSaleComplete: (sale: Sale, opciones: { incluirDatosCliente: boolean }) => void`
  - `ReceiptDialogProps.incluirDatosClienteInicial?: boolean` (default `false`)

- [ ] **Step 1:** Header/Content con la prop.
- [ ] **Step 2:** `IncluirDatosCliente`.
- [ ] **Step 3:** Checkout: estado `incluirDatosCliente`, se pone en `false` cada vez que el diálogo abre; casilla encima de las notas, con `activeCart.selectedCustomer`; se pasa en `onSaleComplete`.
- [ ] **Step 4:** `cart-display` guarda la opción junto a `completedSale` y la pasa a `ReceiptDialog`; `ReceiptDialog` la copia a estado propio al abrir, muestra la casilla sobre el pie y la pasa a la vista, al PDF y a la impresión.
- [ ] **Step 5:** Detalle de venta: casilla (desmarcada) sobre los botones; pasa a `ReceiptContent` y al PDF.
- [ ] **Step 6:** `npm run typecheck` → sin errores nuevos
- [ ] **Step 7:** Commit `feat: casilla para incluir los datos del cliente en la factura`

### Task 4: Firmas una debajo de la otra

**Files:** Modify: `src/components/financing/payment-plan-content.tsx:161-168`

- [ ] **Step 1:** Reemplazar `grid grid-cols-2 gap-6` por una columna (`flex flex-col gap-10`, `pt-10`), cada línea de firma a lo ancho del ticket.
- [ ] **Step 2:** Commit `fix: firmas del plan de pagos una debajo de la otra`

### Task 5: Documento en las Edge Functions

**Files:**
- Create: `supabase/functions/_shared/documentos.ts`
- Modify: `supabase/functions/receipt-link/index.ts`, `supabase/functions/send-sale-receipt/index.ts`
- Test: `scripts/tests/documentos-edge.test.mjs`

**Interfaces:**
- Produces:
  - `type DocumentoVenta = 'factura' | 'plan' | 'estado'`
  - `documentoValido(x: unknown): DocumentoVenta` — cualquier otra cosa → `'factura'`
  - `rutaDelDocumento(companyId: string, saleId: string, doc: DocumentoVenta): string` — `c/s.pdf`, `c/s-plan.pdf`, `c/s-estado.pdf`
  - `nombreDeDescarga(doc: DocumentoVenta, ncf?: string | null): string` — `comprobante[-NCF].pdf`, `plan-de-pagos.pdf`, `estado-de-financiamiento.pdf`
  - `asuntoDelCorreo(doc, companyName: string, ncf?: string | null): string` — factura igual que hoy (`Comprobante de Compra[ NCF x] - Empresa`), `Plan de Pagos - Empresa`, `Estado de su Financiamiento - Empresa`
  - `tituloDelCorreo(doc): string`, `adjuntoDelCorreo(doc): string` (p. ej. "su plan de pagos en formato PDF")
  - Body nuevo opcional en ambas funciones: `documento`

- [ ] **Step 1:** Pruebas de las seis funciones con los valores de arriba (incluye `documentoValido(undefined)` y `documentoValido('otro')` → `'factura'`).
- [ ] **Step 2:** `npm test` → FALLA
- [ ] **Step 3:** Implementar `_shared/documentos.ts`.
- [ ] **Step 4:** `receipt-link`: usa `rutaDelDocumento` y `nombreDeDescarga`; la búsqueda del enlace vigente filtra por `storage_path = ruta` (no por `sale_id`). `send-sale-receipt`: asunto/título/adjunto por documento; el mensaje personalizado de la sucursal (`receipt_email_message`) solo aplica a la factura; plan/estado llevan un texto propio con el mismo `lugar` y fecha.
- [ ] **Step 5:** `npm test` → PASA
- [ ] **Step 6:** Antes de desplegar, comparar con lo desplegado (`get_edge_function`) para no regresar nada; luego `npx supabase functions deploy receipt-link --project-ref qwpjclqinruhtxgkrxwr` y lo mismo para `send-sale-receipt`, desde `app-wt`.
- [ ] **Step 7:** Commit `feat: receipt-link y send-sale-receipt aceptan plan y estado`

### Task 6: Compartir cualquier documento desde el front

**Files:**
- Create: `src/lib/documentos-venta.ts`, `src/hooks/use-compartir-documento.ts`, `src/components/sharing/compartir-documento.tsx`
- Modify: `src/lib/receipt-sharing.ts`, `src/components/pos/receipt-dialog.tsx`, `src/app/(app)/sales/detail/sale-receipt-client.tsx`
- Test: `scripts/tests/documentos-venta.test.mjs`

**Interfaces:**
- Produces:
  - `src/lib/documentos-venta.ts`: `type DocumentoVenta` (mismo literal que Task 5), `nombreArchivoPdf(doc, sale: { id: string; ncf?: string }): string` (`factura_<ncf|id8>.pdf` como hoy, `plan_de_pagos_<id8>.pdf`, `estado_financiamiento_<id8>.pdf`), `mensajeWhatsApp(doc, url: string, dias: number, negocio?: string): string` (la factura conserva el texto actual)
  - `receipt-sharing.ts`: `shareSalePdfLinkViaWhatsApp(saleId, pdfBase64, sale, companyName?, ventana?, documento: DocumentoVenta = 'factura')`, `abrirWhatsAppConEnlace(sale, url, dias, companyName?, documento = 'factura')`, `sendReceiptViaResendEmail(saleId, email, pdfBase64, filename, sale?, companyName?, documento = 'factura')`; ambas llamadas a funciones mandan `documento`
  - `useCompartirDocumento({ sale, documento, pdfRef })` → `{ correo, setCorreo, enviandoCorreo, enviarCorreo(): Promise<boolean>, enviandoEnlace, enlace, compartirWhatsApp(), copiarEnlace(), reabrirWhatsApp(), descargarPdf() }` (toasts adentro; misma lógica que hoy en `receipt-dialog`)
  - `<PanelWhatsApp c={...} />`, `<PanelCorreo c={...} />` (contenido de las pantallas actuales) y `<CompartirDocumento sale documento pdfRef />` (botones WhatsApp / Correo / Descargar PDF + sus diálogos)

- [ ] **Step 1:** Pruebas de `nombreArchivoPdf` y `mensajeWhatsApp` (factura idéntica al texto actual; plan contiene "plan de pagos"; estado contiene "estado de su financiamiento"; los tres contienen la URL y los días).
- [ ] **Step 2:** `npm test` → FALLA; implementar; `npm test` → PASA
- [ ] **Step 3:** Hook y componentes; `receipt-dialog` usa hook + paneles en sus pantallas; `sale-receipt-client` usa `<CompartirDocumento documento="factura">` en lugar de su copia.
- [ ] **Step 4:** `npm run typecheck` → sin errores nuevos
- [ ] **Step 5:** Commit `refactor: compartir documento reutilizable`

### Task 7: Enviar el plan de pagos y el estado del financiamiento

**Files:**
- Create: `src/lib/estado-financiamiento.ts`, `src/components/financing/financing-statement-content.tsx`, `src/components/financing/financing-statement-dialog.tsx`
- Modify: `src/components/financing/payment-plan-dialog.tsx`, `src/app/(app)/financing/detail/financing-detail-client.tsx`
- Test: `scripts/tests/estado-financiamiento.test.mjs`

**Interfaces:**
- Consumes: Task 6 (`CompartirDocumento`)
- Produces:
  - `abonosDelEstado(payments: CreditPayment[]): CreditPayment[]` — sin anulados, del más viejo al más nuevo
  - `FinancingStatementContent({ sale, payments })` — encabezado del perfil (como el plan), cliente, Total a pagar / Pagado (`sale.amountPaid`) / Balance pendiente / Mora exigible / Próximo vencimiento (de `calculateFinancingStatus(sale, profile.lateFeeRate, profile.lateFeeGraceDays)`), tabla de cuotas (No., Vence, Monto, Pagado, Estado) y tabla de abonos (Fecha, Monto, Mora, Método; el inicial rotulado "Inicial")
  - `FinancingStatementDialog({ sale, payments, isOpen, onOpenChange })`

- [ ] **Step 1:** Pruebas de `abonosDelEstado` (quita el anulado; ordena ascendente por `date`).
- [ ] **Step 2:** `npm test` → FALLA; implementar; `npm test` → PASA
- [ ] **Step 3:** `PaymentPlanDialog`: copia fuera de pantalla a `w-[100mm]` para el PDF + `<CompartirDocumento documento="plan">` en el pie.
- [ ] **Step 4:** Contenido y diálogo del estado, con Imprimir y `<CompartirDocumento documento="estado">`; botón "Estado del Financiamiento" en el detalle, junto a "Imprimir Plan de Pagos", pasando los `payments` que la página ya carga.
- [ ] **Step 5:** `npm run typecheck` → sin errores nuevos
- [ ] **Step 6:** Commit `feat: enviar plan de pagos y estado del financiamiento`

### Task 8: Logo de Comercial GP

**Files:** imagen fuera del repo (scratchpad) — no es código.

- [ ] **Step 1:** Dibujar PNG (System.Drawing por PowerShell): fondo amarillo, "Comercial" en azul marino, "G" roja, "P" azul marino; y su versión en grises para ticket.
- [ ] **Step 2:** Enseñárselo a Luis. Con su visto bueno, subirlo a `product-images/<empresa>/logos/` y poner `logo_url` y `ticket_logo_url` de Comercial GP (empresa `6d77dffa-…`), o dejarle el archivo para subirlo en Perfil de Empresa.

### Task 9: Verificación final

- [ ] `npm test`, `npm run typecheck`, `npm run build` (línea base: ver memoria si `node_modules` es junction).
- [ ] Navegador con la empresa demo: config encendida → casilla en el pago → factura con datos (pantalla, PDF); config apagada → sin casilla; plan con firmas apiladas; enviar plan y estado por WhatsApp (enlace distinto al de la factura) y descargar PDF.
- [ ] `get_advisors` (seguridad) sin hallazgos nuevos.
- [ ] Push de la rama y PR.
