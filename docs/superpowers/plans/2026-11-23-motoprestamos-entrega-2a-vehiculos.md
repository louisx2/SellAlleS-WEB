# Motopréstamos · Entrega 2A (vehículos e inventario por chasis) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encender el módulo Motopréstamos y llevar el inventario de motos unidad por unidad: ficha con chasis, venta del chasis elegido en el POS, anulación que la devuelve, y los reportes de vehículos.

**Architecture:** Módulo de rubro como Taller. Tablas propias (`vehicle_types`, `vehicles`, `vehicle_events`) y dos ganchos en la venta (`motos_vincular_venta` al final de `create_sale_with_items`, `motos_anular_venta` en `annul_sale`). El stock de un artículo-vehículo es **derivado**: lo recalcula un trigger de `vehicles` (= unidades disponibles) y un guardia en `products` rechaza cualquier otro cambio, así que transferencias, compras y ajustes manuales quedan bloqueados sin tocarlos uno por uno.

**Tech Stack:** Next 15 (export estático), TypeScript, Supabase/Postgres, `node --test`, suites SQL en `begin … rollback`.

**Spec:** `docs/superpowers/specs/2026-11-23-motoprestamos-design.md`, "Entrega 2 — Módulo base". Esta es la primera de tres partes: **2A** (este plan), **2B** garantía en préstamos, matrículas en custodia y datos del cliente, **2C** contrato, configuración general, fotos y portal.

## Global Constraints

- Módulo `motoprestamos`, etiqueta "Motopréstamos", `defaultEnabled: false`. Rutas bajo `/motos` → módulo `motoprestamos`. Permisos `motos` (view/create/edit/delete) y `motos-config` (view/edit), ambos gobernados por el módulo.
- Rubro "Motopréstamos" (`BusinessType` `'motoprestamos'`): enciende `prestamos`, `motoprestamos`, `caja` y `customer-portal`; siembra el tipo de vehículo "Motor".
- Estados del vehículo: `disponible` · `vendido` · `en_garantia` · `recuperado` · `liberado` · `baja`. Origen: `inventario` · `garantia`. Condición: `nuevo` · `usado`. Matrícula: `en_custodia` · `lista_para_entregar` · `entregada` · `no_aplica`.
- Campos fijos: marca, modelo, año, color, chasis, número de motor, placa, número de matrícula, cilindraje. Extras por tipo (`extra_fields jsonb`, `{key,label,type:'text'|'number'}[]`), como `service_equipment_types`.
- Chasis único por empresa (sin mayúsculas/minúsculas ni espacios) entre los que no están de baja.
- Stock de un artículo con `is_vehicle` = cantidad de sus vehículos `disponible` en esa sucursal. Mensaje del guardia: `Las existencias de un vehículo las mueven sus unidades: ingrésalas o dalas de baja desde Vehículos.`
- Venta: una línea con `vehicle_id` va con cantidad 1, sin presentación, del mismo artículo y sucursal; exige cliente (`Para vender un vehículo elige el cliente.`); la línea toma el costo de la unidad y su descripción `Marca Modelo · Año · Color · Chasis X · Motor Y` (omitiendo lo vacío). Matrícula al vender: a crédito o financiada → `en_custodia`; de contado → `entregada` (el ajuste configurable llega en 2C).
- `annul_sale`: la unidad vuelve a `disponible` (sin cliente ni venta, matrícula `no_aplica`) y el stock se recalcula solo.
- Funciones cambiadas parten de `pg_get_functiondef` en vivo con huella md5; grants explícitos; `revoke … from public, anon`. Empresa demo `…0aa`, sucursal `…0b1`, súper admin `92381752-…`.
- Textos en español. Sin dependencias nuevas.

## Review Focus

1. Un artículo-vehículo agregado al carrito sin elegir chasis (cotización convertida, búsqueda por código): el cobro se rechaza con un mensaje claro, no con "Stock insuficiente". → prueba en Task 3 y aviso en Task 7.
2. Dos cajeros venden el mismo chasis a la vez: el segundo recibe error, no dos ventas del mismo vehículo. → `for update` y prueba en Task 3.
3. Marcar como vehículo un artículo que ya tiene existencias: se rechaza con instrucción, no se pierden en silencio. → prueba en Task 2.
4. Anular la venta de una moto financiada: vuelve a disponible y el stock sube 1. → prueba en Task 3.
5. Empresa sin el módulo: nada cambia (productos, POS, anulaciones). → prueba de regresión en Task 3 (venta normal y anulación normal).

---

### Task 1: Módulo, rubro, menú y permisos en TypeScript

**Files:**
- Modify: `src/lib/modules.ts`, `src/lib/business-types.ts`, `src/lib/permissions.ts`, `src/lib/types.ts` (`PermissionResource`), `src/app/(app)/authed-layout.tsx`, `src/components/admin/company-modules-dialog.tsx`, `src/app/(app)/admin/empresas/page.tsx`
- Test: `scripts/tests/motos.test.mjs`

**Interfaces:**
- Produces: `ModuleKey` incluye `'motoprestamos'`; `moduleForRoute('/motos/ficha') === 'motoprestamos'`; `BUSINESS_TYPE_PRESETS.motoprestamos` con `modules: ['prestamos','motoprestamos','caja','customer-portal']` y `vehicleTypes: ['Motor']`; `OPTIONAL_VERTICALS` incluye `'motoprestamos'`; `PermissionResource` incluye `'motos' | 'motos-config'`; `RESOURCE_MODULE.motos = RESOURCE_MODULE['motos-config'] = 'motoprestamos'`.

- [ ] **Step 1: Pruebas que fallan** (`scripts/tests/motos.test.mjs`, importa `src/lib/modules.ts` y `src/lib/business-types.ts`): `moduleForRoute('/motos')` y `('/motos/ficha')` → `'motoprestamos'`; el catálogo tiene `motoprestamos` con `defaultEnabled === false`; `resolveEnabledModules([])` no lo incluye y con `[{module_key:'motoprestamos',enabled:true}]` sí; el preset `motoprestamos` enciende exactamente esos 4 módulos y siembra `['Motor']`; `OPTIONAL_VERTICALS` incluye `'motoprestamos'`.
- [ ] **Step 2:** `node --test scripts/tests/motos.test.mjs` → FAIL.
- [ ] **Step 3: Implementar.**
  - `modules.ts`: módulo con descripción "Motos con chasis, venta a cuotas y préstamos con la moto en garantía, matrículas en custodia y cobranza en la calle."; `{ prefix: '/motos', module: 'motoprestamos' }`.
  - `business-types.ts`: `BusinessType` suma `'motoprestamos'`; preset con label "Motopréstamos", descripción "Venta de motos a cuotas y préstamos con la moto en garantía."; campo nuevo opcional `vehicleTypes?: string[]` en `BusinessTypePreset`.
  - `permissions.ts`: recursos `{ key: 'motos', label: 'Motopréstamos: vehículos' }` y `{ key: 'motos-config', label: 'Motopréstamos: configuración', actions: ['view','edit'] }`.
  - Menú (`authed-layout.tsx`): en `featuresNavItems` `{ href: '/motos', icon: Bike, label: 'Vehículos', module: 'motoprestamos', permission: 'motos' }`; en `adminNavItems` `{ href: '/motos/config', icon: Settings2, label: 'Configuración de Motopréstamos', module: 'motoprestamos', permission: 'motos-config' }` (iconos de lucide ya instalado).
  - `company-modules-dialog.tsx`: al encender `motoprestamos`, encender también `prestamos` en el mismo guardado y avisar en el toast si `caja` está apagada ("Recomendado: encender Caja para controlar el efectivo de los préstamos").
  - `admin/empresas/page.tsx`: al crear la empresa con un preset que trae `vehicleTypes`, insertar esas filas en `vehicle_types` (como hace con `tallerRubro`).
- [ ] **Step 4:** `node --test scripts/tests/motos.test.mjs` → PASS; `npm test` PASS.
- [ ] **Step 5:** `npx tsc --noEmit` sin errores nuevos (el insert a `vehicle_types` compila aunque la tabla llegue en la Task 2: el cliente de Supabase no está tipado). Commit: `Motopréstamos: módulo, rubro, menú y permisos`.

---

### Task 2: Migración — vehículos y stock por unidad

**Files:**
- Create: `supabase/migrations/20261124150000_motos_vehiculos.sql`
- Create: `supabase/tests/motos_vehiculos.sql`

**Interfaces:**
- Produces (SQL):
  - `vehicle_types(id uuid pk, company_id, name text not null, extra_fields jsonb not null default '[]', position int not null default 0, is_active bool not null default true, created_at)`.
  - `vehicles(id uuid pk, company_id, branch_id, vehicle_type_id null, origin text, product_id null, customer_id null, sale_id null, brand, model, year int, color, chassis, engine_number, plate, registration_number, cc, extra jsonb not null default '{}', condition text not null default 'nuevo', cost numeric(14,2), price numeric(14,2), status text not null default 'disponible', registration_status text not null default 'no_aplica', registration_location text, registration_since timestamptz, notes text, created_by, created_by_name, created_at, updated_at)` con CHECK de los enumerados de las Global Constraints, `origin='inventario' ⇒ product_id not null`, `origin='garantia' ⇒ customer_id not null and product_id is null`, y `year between 1950 and 2100`.
  - Índice único `vehicles_chassis_uq on (company_id, upper(regexp_replace(chassis, '\s', '', 'g'))) where status <> 'baja' and coalesce(btrim(chassis),'') <> ''`; índices por `(branch_id, status)`, `product_id`, `sale_id`, `customer_id`.
  - `vehicle_events(id, company_id, vehicle_id, kind text check in ('ingreso','venta','venta_anulada','cambio_estado','matricula','edicion','baja'), from_status, to_status, note, sale_id, created_by default auth.uid(), created_by_name, created_at default clock_timestamp())`.
  - `products.is_vehicle boolean not null default false`; `sale_items.vehicle_id uuid null references vehicles(id)` (Task 3 lo usa).
  - Funciones: `motos_tiene_permiso(p_branch_id uuid, p_resource text, p_action text) returns boolean` (copia de `taller_tiene_permiso`; fila sin rol → `{"motos":["view"]}`), `motos_puede_configurar() returns boolean` (admin, súper admin o `motos-config:edit` en alguna sucursal), `motos_recalcular_stock(p_product_id uuid) returns void` (security definer; pone `products.stock` = vehículos `disponible` de ese artículo con `set_config('motos.stock','si',true)`), `motos_descripcion(v vehicles) returns text` (la descripción de las Global Constraints).
  - Triggers: `vehicles_before` (normaliza chasis con `btrim`, pone `updated_at`; en insert fuerza `status` según origen — `disponible` para inventario, `en_garantia` para garantía — y exige que `product_id` sea un artículo `is_vehicle` de la misma sucursal; en update rechaza cambios a `status`, `sale_id`, `customer_id` de inventario, `product_id` y `branch_id` si `current_setting('motos.sistema', true) <> 'si'`, salvo `disponible → baja` que se permite), `vehicles_after` (recalcula stock del `product_id` viejo y nuevo; registra `vehicle_events`: `ingreso` al insertar, `baja`, `cambio_estado`, `edicion` con la lista de campos cambiados en `note`), `products_vehicle_guard` (before insert/update en `products`: si `is_vehicle` y cambia `stock` sin `motos.stock = 'si'` → error de las Global Constraints; pasar `is_vehicle` de false a true con `stock <> 0` → `Para marcarlo como vehículo, deja sus existencias en 0 e ingresa cada unidad desde Vehículos.`; pasar de true a false con vehículos que no estén de baja → `Este artículo tiene vehículos registrados: dalos de baja antes de quitarle la marca.`).
  - RLS: `vehicle_types` (select empresa; escritura `motos_puede_configurar()`), `vehicles` (select `company_id = current_company_id() and motos_tiene_permiso(branch_id,'motos','view')`; insert con `'create'`; update con `'edit'`; **sin** delete: se da de baja), `vehicle_events` (select empresa; sin escritura del cliente). Súper admin pasa en todas. Grants explícitos.

- [ ] **Step 1: Huellas.** No cambia funciones vivas en esta migración; anotar en la cabecera que solo crea objetos y agrega columnas.
- [ ] **Step 2: Suite** `supabase/tests/motos_vehiculos.sql` (encabezado como `cobro_diario.sql`; UUIDs `…e1XX`; termina en `select 'ok'`). Preparación: artículo `is_vehicle` con stock 0 en la sucursal demo. Aserciones:
  - Insertar 2 vehículos de inventario → `products.stock = 2`; uno de garantía (origen `garantia`, sin artículo) no cambia el stock y queda `en_garantia`.
  - Chasis repetido (con otro espaciado o en minúsculas) falla `%vehicles_chassis_uq%`; repetido de uno dado de baja pasa.
  - Cliente cambia `status` a `vendido` → falla `%lo hace el sistema%`; `disponible → baja` pasa y el stock baja a 1; hay evento `baja`.
  - `update products set stock = 5` de un artículo-vehículo → falla con el mensaje del guardia; el mismo update en un artículo normal pasa.
  - Marcar `is_vehicle` un artículo con stock 3 → falla `%deja sus existencias en 0%`; desmarcar uno con vehículos activos → falla `%dalos de baja%`.
  - Vehículo de inventario con `product_id` de un artículo que no es vehículo → falla; de otra sucursal → falla.
  - `motos_descripcion` de `Honda CG 150 · 2025 · Roja · Chasis ABC · Motor 123`; sin año ni motor omite esas partes.
  - `has_function_privilege('anon', 'public.motos_recalcular_stock(uuid)', 'EXECUTE')` es false.
- [ ] **Step 3:** Correr la suite sin la migración → falla (tabla inexistente).
- [ ] **Step 4:** Escribir la migración.
- [ ] **Step 5:** `begin; <migración> <suite> rollback;` → `ok`.
- [ ] **Step 6:** Commit: `Motopréstamos: vehículos con chasis y stock por unidad`.

---

### Task 3: Migración — venta y anulación por chasis

**Files:**
- Create: `supabase/migrations/20261124160000_motos_venta_por_chasis.sql`
- Create: `supabase/tests/motos_venta.sql`

**Interfaces:**
- Consumes: tablas y funciones de la Task 2.
- Produces: `create_sale_with_items` acepta `vehicle_id uuid` en cada línea y lo guarda en `sale_items`; `decrement_product_stock_for_sale_item` no descuenta líneas con `vehicle_id`; `motos_vincular_venta(p_sale_id uuid) returns void` (llamada al final de `create_sale_with_items`, después de `taller_vincular_venta`); `annul_sale` no repone stock de líneas con `vehicle_id` y llama `motos_anular_venta(p_sale_id uuid) returns void`.

- [ ] **Step 1: Volcar lo vivo y huellas** de `create_sale_with_items`, `decrement_product_stock_for_sale_item` y `annul_sale`.
- [ ] **Step 2: Suite** `supabase/tests/motos_venta.sql` (UUIDs `…e2XX`). Aserciones:
  - Venta de contado con la línea del vehículo → vehículo `vendido` con `customer_id` y `sale_id`, matrícula `entregada`; `products.stock` baja 1; la línea tiene `cost` = costo de la unidad y `product_name` = `motos_descripcion`; hay evento `venta`.
  - Venta financiada → matrícula `en_custodia`.
  - Sin cliente → falla `%elige el cliente%`; cantidad 2 → falla; mismo vehículo en dos líneas → falla; vehículo ya vendido → falla `%no está disponible%`; vehículo de otro artículo → falla.
  - Artículo-vehículo sin `vehicle_id` → falla con el mensaje del guardia (no "Stock insuficiente").
  - `annul_sale` de la venta de contado → vehículo `disponible`, sin cliente ni venta, matrícula `no_aplica`, stock repuesto, evento `venta_anulada`.
  - Regresión: venta normal de un artículo con stock y su anulación siguen igual (stock baja y vuelve); `supabase/tests/presentaciones.sql` y `ventas_rapidas.sql` pasan con la migración aplicada en la transacción.
- [ ] **Step 3:** Correr sin la migración → falla.
- [ ] **Step 4:** Migración partiendo de lo volcado (solo las líneas necesarias, como hizo Taller).
- [ ] **Step 5:** `begin; <migración Task 2> <esta> <suite> rollback;` → `ok`, y las regresiones.
- [ ] **Step 6:** Commit: `Motopréstamos: venta y anulación por chasis`.

---

### Task 4: Lógica pura de vehículos

**Files:**
- Create: `src/lib/motos.ts`
- Test: `scripts/tests/motos.test.mjs` (mismo archivo de la Task 1)

**Interfaces:**
- Produces:
  - `type VehicleStatus`, `VehicleOrigin`, `VehicleCondition`, `RegistrationStatus` (los de las Global Constraints) y `VEHICLE_STATUS: Record<VehicleStatus, { label: string; badge: string }>` (etiquetas: Disponible, Vendido, En garantía, Recuperado, Liberado, De baja), `REGISTRATION_STATUS_LABEL` (En custodia, Lista para entregar, Entregada, No aplica).
  - `vehicleLabel(v: { brand?: string; model?: string; year?: number | null; color?: string }): string` → `"Honda CG 150 · 2025 · Roja"`.
  - `vehicleLineName(v)` → igual que `motos_descripcion` en la base (con chasis y motor).
  - `normalizeChassis(s: string): string` (mayúsculas, sin espacios).
  - `matchesVehicle(v, q: string): boolean` (busca en chasis, placa, marca, modelo, color, cliente).
- [ ] **Step 1: Pruebas** con los mismos ejemplos de la Task 2 para `vehicleLineName` (espejo exacto de la base), etiquetas, normalización y búsqueda.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit: `Motopréstamos: etiquetas y descripción de vehículos`.

---

### Task 5: Datos de vehículos en el front

**Files:**
- Modify: `src/lib/types.ts` (`Vehicle`, `VehicleType`, `Product.isVehicle?: boolean`, `CartItem.vehicleId?: string`), `src/lib/supabase/mappers.ts` (`rowToVehicle`, `rowToVehicleType`, `is_vehicle` en producto)
- Create: `src/hooks/use-vehiculos.ts`

**Interfaces:**
- Produces: `useVehiculos(opts?: { branchId?: string })` → `{ vehicles: Vehicle[]; types: VehicleType[]; loading: boolean; reload(): Promise<void>; addVehicle(input: NewVehicleInput): Promise<Vehicle>; updateVehicle(id: string, patch: VehiclePatch): Promise<void>; darDeBaja(id: string, nota: string): Promise<void>; eventos(id: string): Promise<VehicleEvent[]> }`. `select` de vehículos con `customers(id,name,phone)` y `products(id,name,price)` (FK únicas, sin embeds ambiguos). `NewVehicleInput` sin `status` (lo pone la base).
- [ ] **Step 1:** Tipos, mappers y hook. `npx tsc --noEmit` sin errores.
- [ ] **Step 2:** Commit: `Motopréstamos: datos de vehículos en el front`.

---

### Task 6: Pantallas de vehículos y artículo-vehículo

**Files:**
- Create: `src/app/(app)/motos/page.tsx` (lista), `src/app/(app)/motos/ficha/page.tsx` + `ficha-client.tsx`, `src/app/(app)/motos/config/page.tsx` (pestaña Tipos de vehículo), `src/components/motos/vehicle-form-dialog.tsx` (ingresar / editar), `src/components/motos/vehicle-status-badge.tsx`
- Modify: `src/components/products/product-dialog.tsx`

- [ ] **Step 1: Lista `/motos`:** pestañas *Disponibles · Vendidos · En garantía · Todos* (las demás estados entran en *Todos*), búsqueda con `matchesVehicle`, columnas: vehículo (`vehicleLabel`), chasis, placa, estado (badge), cliente, matrícula, costo/precio; botón **Ingresar unidad** (permiso `motos:create`).
- [ ] **Step 2: Formulario de unidad:** artículo-vehículo de la sucursal activa (obligatorio en origen inventario), tipo de vehículo, campos fijos y extras del tipo, condición, costo, precio propio (opcional, vacío = el del artículo), notas. Al editar, los mismos menos artículo.
- [ ] **Step 3: Ficha `/motos/ficha?id=`:** datos, estado y matrícula, cliente y venta enlazados (enlace a la venta), historial (`eventos`), botones **Editar** y **Dar de baja** (solo disponible; pide motivo).
- [ ] **Step 4: Configuración `/motos/config`:** CRUD de tipos de vehículo (nombre, campos extra, orden, activo) con el patrón de `taller/config/equipment-tab.tsx`.
- [ ] **Step 5: Producto:** con el módulo encendido, interruptor **"Es un vehículo (cada unidad con su chasis)"**. Marcado: oculta existencias, presentaciones y mayoreo; muestra "Existencias: N unidades disponibles (se ingresan desde Vehículos)". El error del guardia se muestra tal cual.
- [ ] **Step 6:** `npx tsc --noEmit` sin errores; commit: `Motopréstamos: pantallas de vehículos y artículo-vehículo`.

---

### Task 7: Venta por chasis en el POS

**Files:**
- Create: `src/components/motos/vehicle-picker-dialog.tsx`
- Modify: `src/context/cart-provider.tsx` (`addVehicleItem(product: Product, vehicle: Vehicle)`), `src/components/pos/product-grid.tsx`, `src/components/pos/product-search.tsx`, `src/components/pos/cart-display.tsx`, `src/context/sales-provider.tsx` (`vehicle_id` por línea), el diálogo de cobro (`src/components/pos/checkout-dialog.tsx`)

- [ ] **Step 1:** Al agregar un artículo con `isVehicle` (tarjeta, búsqueda o código), en lugar de `addItem` se abre el selector: unidades `disponible` de ese artículo en la sucursal activa que no estén ya en algún carrito, con chasis, color, año y precio (el propio o el del artículo). Sin unidades: toast "No hay unidades disponibles de X".
- [ ] **Step 2:** `addVehicleItem` crea siempre línea nueva con `vehicleId`, cantidad 1, `product.name = vehicleLineName(v)` y `customPrice = v.price` si la unidad tiene precio propio. `updateQuantity` rechaza cambiar la cantidad ("Cada moto va en su propia línea") y no se fusiona con otras líneas (igual que `serviceItemId`).
- [ ] **Step 3:** En el carrito, la línea muestra el chasis como insignia. Una línea de artículo-vehículo **sin** `vehicleId` (de una cotización) muestra "Elige el chasis" y el cobro se bloquea con ese aviso.
- [ ] **Step 4:** Cobro con una línea de vehículo y cliente "Consumidor Final" → aviso `Para vender un vehículo elige el cliente.` antes de llamar a la base.
- [ ] **Step 5:** `sales-provider` manda `vehicle_id: item.vehicleId ?? null`.
- [ ] **Step 6:** `npx tsc --noEmit`; commit: `Motopréstamos: venta por chasis en el POS`.

---

### Task 8: Reportes de vehículos

**Files:**
- Create: `src/lib/motos-reportes.ts`, `src/app/(app)/reports/vehiculos/page.tsx`
- Modify: `src/lib/permissions.ts` (`REPORT_ITEMS`: `{ slug: 'vehiculos', label: 'Vehículos (cartera y ventas)' }`), `src/app/(app)/reports/page.tsx` (tarjeta con el módulo encendido), `src/lib/modules.ts` (`{ prefix: '/reports/vehiculos', module: 'motoprestamos' }` antes de `/reports`)
- Test: `scripts/tests/motos.test.mjs`

**Interfaces:**
- Produces:
  - `carteraDeVehiculos(vehicles, saldoPorVenta: Map<string, { pendiente: number; atrasado: boolean }>)` → `{ porEstado: Record<VehicleStatus, number>; inventarioACosto: number; vendidosACuotas: { cantidad: number; pendiente: number; atrasados: number } }`.
  - `ventasDeVehiculos(vehicles, ventas: { id: string; createdAt: Date; paymentMethod: string; downPayment?: number; installments?: number; frequency?: string }[], desde: Date, hasta: Date)` → `{ porModelo: { modelo: string; contado: number; financiado: number }[]; contado: number; financiado: number; inicialPromedio: number; plazoPromedio: number }` (inicial y plazo solo de las financiadas).
- [ ] **Step 1: Pruebas** con 4 vehículos (2 disponibles con costo 50,000 y 60,000; 1 vendido financiado con saldo 30,000 atrasado; 1 vendido de contado): `inventarioACosto = 110000`, `vendidosACuotas = { cantidad: 1, pendiente: 30000, atrasados: 1 }`; ventas en el período: `contado 1, financiado 1`, inicial y plazo promedio de la financiada; una venta fuera del período no cuenta.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Página** con período (como los demás reportes): tarjetas de cartera, tabla por estado, tabla por modelo, exportar CSV. Saldos desde `useSales().financingSales` con `calculateFinancingStatus`.
- [ ] **Step 6:** `npx tsc --noEmit`; `npm test`; commit: `Motopréstamos: reportes de vehículos`.

---

### Task 9: Aplicar, probar en pantalla y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit`, `next build`.
- [ ] **Step 2:** Huellas de lo vivo iguales a las de la Task 3; aplicar con `apply_migration` las dos migraciones (son compatibles con el front de producción: columnas nuevas nulas, `vehicle_id` opcional en el JSON de líneas, ningún artículo es vehículo todavía). Suites contra lo aplicado; `get_advisors`; logs sin `42501`.
- [ ] **Step 3: En pantalla (empresa demo, con la sesión de Louis):** encender el módulo; crear artículo "Honda CG 150" vehículo; ingresar 2 unidades; abrir el cobro de una a un cliente de prueba y ver el selector de chasis, la línea y los avisos. La demo emite e-CF al ambiente de pruebas de la DGII con cada venta: **cobrar solo si Louis lo autoriza**; si no, la venta y la anulación quedan cubiertas por la suite SQL. Ver la ficha, el stock y el reporte de vehículos. Borrar todo lo de prueba y apagar el módulo si estaba apagado.
- [ ] **Step 4:** Spec con el estado de 2A, commit, push, PR contra `main`. No fusionar sin Louis.
