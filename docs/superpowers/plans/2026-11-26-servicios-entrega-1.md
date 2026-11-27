# Servicios · Entrega 1 (Servicios para todos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** el Taller pasa a ser **Servicios**, un módulo que sirve a cualquier negocio de
servicios (uñas, peluquería de mascotas, limpieza, lubricentro, reparación…), sin que el taller
de celulares pierda nada.

**Architecture:**
- **Base:** una migración que suma personal sin usuario, varias personas por línea, fichas
  guardadas del cliente, tipos de ficha configurables, el camino «se queda / no se queda», a
  domicilio y los campos nuevos del catálogo. Las RPC del Taller se cambian sobre su definición
  viva.
- **Front:** se generaliza sobre los mismos archivos; las reglas de estados y textos viven en
  `src/lib/taller.ts`, sin React, con pruebas.
- **Compatibilidad:** nada se borra en esta migración (`assigned_to`, `service_technicians`,
  `taller_asignar`, `taller_ve_caso` quedan sin uso). Así el front viejo no se rompe entre
  aplicar la migración y desplegar. La limpieza va después, aparte.

**Tech Stack:** Next.js 14 (export estático), Supabase (Postgres, RLS, plpgsql), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-26-servicios-design.md` (aprobado por Louis el
2026-11-26). Esta entrega es la 1 de 4. Agenda, comisión en la venta y reportes nuevos son de
las entregas 2 a 4.

## Global Constraints

- **Migraciones:** las aplico yo con `apply_migration`; nunca `supabase db push`. Antes, verde
  en `begin … rollback` contra producción. Después: md5 de las funciones contra el archivo,
  `get_advisors` y logs de la API.
- **Objetos nuevos:** `revoke all … from public, anon, authenticated` antes de sus grants;
  grants explícitos a `authenticated` y `service_role` (ver `SUPABASE.md`, «Grants en
  migraciones nuevas»). Funciones `set search_path = public`.
- **Funciones vivas** (`taller_entregar`, `taller_cambiar_estado`, `taller_guardar_servicio`,
  `taller_after_service_event`, `taller_before_update_service`, `taller_seguimiento_publico`,
  `after_service_loyalty_effects`): se parte de `pg_get_functiondef` y la migración comprueba
  la huella md5 del cuerpo antes de reemplazarla (patrón de `20261119120000_taller_base.sql`).
- **Tablas puente:** índice único, nunca restricción `unique` sobre dos columnas con FK. Todo
  embed a `profiles` o `service_staff` desde `services` nombra su FK
  (`service_staff!services_staff_id_fkey`).
- **Dentro de diálogos** no van `Select` de Radix: `<select>` nativo con las clases de `Input`,
  o casillas.
- **Nombres internos no cambian:** clave de módulo `services`, rutas `/services` y
  `/service-types`, tablas, `src/lib/taller.ts`, `src/components/taller/*`, el slug de reporte
  `taller`. Solo cambia lo que ve la gente.
- **Palabras que ve la gente:** Orden (no caso), Personal / Lo atiende (no técnico), Tipo de
  ficha / Qué se atiende (no tipo de equipo), Nueva orden, Atender ahora, Configuración de
  Servicios. «Equipo», «IMEI», «reparación», «técnico» y «taller» solo salen en órdenes cuyo
  tipo de ficha es de reparación (y en las plantillas de reparación).
- **Demo** (`00000000-0000-0000-0000-0000000000aa`): emite e-CF en TesteCF; no se cobran
  ventas en pantalla. Datos de prueba por SQL, y se borran al terminar.
- **Textos** en español dominicano.
- **PR** a `main`. No fusionar sin el OK de Louis. La migración se aplica justo antes de
  fusionar.

## Review Focus

1. **Personal con usuario sin «ver todas»:** ve las órdenes donde es responsable o está en una
   línea, más las sin asignar. Al pasarle la orden a otro deja de verla, sin error. → T2,
   caso F.
2. **«No se queda» nunca pasa por «Listo para retirar»:** ni pide quién retira, y no se puede
   cambiar «El cliente espera» con la orden en Listo. → T2, caso D; T1, `manualStatuses`.
3. **«Usar un artículo que ya existe»** se rechaza si tiene existencias, si es de otra sucursal
   o si ya es otro servicio del catálogo. → T2, caso G.
4. **Un salón sin ficha** no ve palabras de taller en estados ni en textos al cliente. → T1,
   prueba de palabras prohibidas.
5. **Módulo apagado por defecto:** una empresa nueva sin fila no tiene Servicios; Pujols (fila
   en true) y la demo (fila nueva) sí. → T7, prueba de `resolveEnabledModules`; T2, caso A.

---

### Task 1: Reglas de estados, textos y plantillas (`src/lib/taller.ts`)

**Files:**
- Modify: `src/lib/taller.ts`
- Modify: `src/lib/types.ts` (solo `EquipmentType`, `Service`: los campos de abajo)
- Modify: `src/lib/supabase/mappers.ts` (`rowToService` y `rowToEquipmentType`: los campos
  nuevos)
- Test: `scripts/tests/taller.test.mjs`

**Interfaces:**
- Produces:
  - `type StatusCtx = { staysInShop: boolean; isRepair: boolean }`
  - `statusCtx(s: Pick<Service, 'staysInShop' | 'isRepair'>): StatusCtx`
  - `statusLabel(st: ServiceStatus, ctx: StatusCtx): string`
  - `customerText(st: ServiceStatus, ctx: StatusCtx): string`
  - `manualStatuses(ctx: StatusCtx): ServiceStatus[]`
  - `canClose(st: ServiceStatus, ctx: StatusCtx): boolean`
  - `closeLabel(ctx: StatusCtx): 'Entregar' | 'Terminar'`
  - `defaultStaysInShop(type: Pick<EquipmentType, 'staysInShop'> | undefined, atCustomer: boolean): boolean`:
    `!atCustomer && !!type?.staysInShop`.
  - `fichaFields(t: Pick<EquipmentType, 'brandLabel' | 'modelLabel' | 'serialLabel'>): { key: 'brand' | 'model' | 'serial'; label: string }[]`:
    en ese orden, sin los que tienen etiqueta `null`.
  - `mensajeDeEstado(s, cliente, negocio, enlace?)`: `s` suma `staysInShop` e `isRepair`.
  - `EquipmentTemplate` suma `brandLabel: string | null`, `modelLabel: string | null`,
    `serialLabel: string | null`, `staysInShop: boolean`, `isRepair: boolean`.
  - `RUBROS[i]` suma `aDomicilio?: boolean`.
  - En `types.ts`:
    - `EquipmentType` suma `brandLabel: string | null`, `modelLabel: string | null`,
      `staysInShop: boolean`, `isRepair: boolean`; `serialLabel` pasa a `string | null`.
    - `Service` suma `staysInShop: boolean`, `isRepair: boolean`, `atCustomer: boolean`,
      `serviceAddress?: string`, `staffId?: string`, `subjectId?: string`.
- `SERVICE_STATUS[st].label` y `.customerText` quedan como el texto «de reparación que se
  queda», para lo que todavía no pase contexto. `MANUAL_STATUSES` se borra; quien lo usa pasa a
  `manualStatuses`.

Textos (fijos; los que no están en la tabla quedan como hoy):

| Estado | `statusLabel` | `customerText` |
|---|---|---|
| `received` | se queda: «Recibido»; no se queda: «Llegó» | se queda: «Ya lo recibimos»; no se queda: «Ya te anotamos» |
| `in_repair` | reparación: «En reparación»; si no: «En proceso» | reparación: «Lo estamos reparando»; si no: «Lo estamos atendiendo» |
| `ready` | «Listo para retirar» | «¡Ya está listo! Pasa a buscarlo» |
| `delivered` | se queda: «Entregado»; no se queda: «Terminado» | se queda: «Entregado»; no se queda: «¡Gracias por visitarnos!» |
| `cancelled` | «Cancelada» | «Cancelada» |

`mensajeDeEstado`: «Hola Ana, te escribimos de {negocio} sobre {ficha} (orden #0142):
{customerText}.». Sin ficha, «sobre tu orden #0142». Lo del total y el enlace queda como hoy.

Plantillas nuevas en `RUBROS`; las cuatro de hoy suman `staysInShop: true`, `isRepair: true`,
`brandLabel: 'Marca'`, `modelLabel: 'Modelo'`:
- `lubricentro` «Lubricentro / motos»:
  - «Moto» y «Vehículo»: Marca / Modelo / Placa, campos Kilometraje (número) y Año (número);
  - chequeos: Enciende, Rayones, Golpes, Luces funcionan, Nivel de aceite;
  - `staysInShop: true`, `isRepair: false`.
- `mascotas` «Peluquería de mascotas»:
  - «Perro» y «Gato»: Nombre / Raza, sin serie, campos Tamaño (texto) y Peso (número);
  - chequeos: Pulgas, Garrapatas, Heridas, Nudos, Agresivo;
  - `staysInShop: true`, `isRepair: false`.
- `salon` «Salón de belleza y uñas»: sin fichas (`equipos: []`).
- `limpieza` «Limpieza»: sin fichas, `aDomicilio: true`.

- [ ] **Step 1: Pruebas (rojo)** en `taller.test.mjs`:
  - `test('estados según el camino')`:
    - `statusLabel('received', {staysInShop:false,isRepair:false})` = «Llegó»;
    - `statusLabel('delivered', {staysInShop:false,isRepair:false})` = «Terminado»;
    - `statusLabel('in_repair', {staysInShop:true,isRepair:true})` = «En reparación».
  - `test('estados que se ofrecen a mano')`:
    - `manualStatuses({staysInShop:false,isRepair:false})` = `['received','in_repair']`;
    - con `{true,false}` = `['received','in_repair','ready']`;
    - con `{true,true}` = `['received','diagnosing','awaiting_approval','awaiting_parts','in_repair','ready','not_repaired']`;
    - con `{false,true}` = el mismo sin `'ready'`.
  - `test('cerrar la orden')`:
    - se queda: `canClose('ready')` true, `canClose('in_repair')` false;
    - no se queda: `canClose('received')` y `canClose('in_repair')` true;
    - nunca desde `delivered` ni `cancelled`;
    - `closeLabel` = Entregar / Terminar.
  - `test('sin reparación no salen palabras de taller')`: para todo `ServiceStatus` de
    `manualStatuses({x,false})` más `delivered` y `cancelled`, con `x` true y false,
    `statusLabel` y `customerText` no cumplen `/repar|equipo|técnic|taller/i`.
  - `test('campos de la ficha')`:
    - `fichaFields({brandLabel:'Nombre',modelLabel:'Raza',serialLabel:null})` =
      `[{key:'brand',label:'Nombre'},{key:'model',label:'Raza'}]`;
    - `defaultStaysInShop({staysInShop:true}, true)` = false.
  - `test('mensaje sin ficha')`: orden 142 sin marca ni modelo, que no se queda y en
    `delivered` → contiene «sobre tu orden #0142» y «¡Gracias por visitarnos!».
  - La prueba de plantillas que ya existe suma:
    - `mascotas`, `lubricentro`, `salon` y `limpieza` existen;
    - `salon` y `limpieza` no tienen equipos;
    - las de `mascotas` tienen `serialLabel === null` e `isRepair === false`.
- [ ] **Step 2:** `npm test`. Expected: fallan las pruebas nuevas.
- [ ] **Step 3:** implementar en `taller.ts` y los campos en `types.ts`.
  - Arreglar los usos de `MANUAL_STATUSES` y de `mensajeDeEstado` para que compile, pasando
    `statusCtx(service)`.
  - Mappers:
    - `rowToService` llena `staysInShop` e `isRepair` con `true` y `atCustomer` con `false` si
      la columna no viene (la base todavía no las tiene);
    - `rowToEquipmentType` llena `brandLabel` / `modelLabel` con `'Marca'` / `'Modelo'`,
      `staysInShop` con true e `isRepair` con true si no vienen.
- [ ] **Step 4:** `npm test` y `npx tsc --noEmit`. Expected: todo verde.
- [ ] **Step 5:** commit `Servicios: estados y textos según el camino de la orden, plantillas nuevas`.

### Task 2: Base de datos

**Files:**
- Create: `supabase/migrations/20261128120000_servicios_base.sql`
- Create: `supabase/tests/servicios.sql`

**Interfaces:**
- Produces (tablas y columnas):
  - **`service_staff`:**
    - columnas: `id`, `company_id` (default `current_company_id()`), `branch_id` (not null),
      `name` (not null, no vacío), `phone`, `color` (texto `#rrggbb`), `commission_rate
      numeric(5,2) not null default 0` (0–100), `profile_id` (FK `profiles`, on delete set
      null), `is_active` (default true), `position`, `created_at`;
    - índice único `(branch_id, profile_id) where profile_id is not null`.
  - **`service_item_staff`:**
    - columnas: `id`, `company_id`, `service_item_id` (FK, on delete cascade), `staff_id` (FK
      `service_staff`, on delete restrict), `created_at`;
    - índice único `(service_item_id, staff_id)`.
  - **`customer_subjects`** (fichas del cliente): `id`, `company_id`, `customer_id` (FK
    `customers`, on delete cascade), `equipment_type_id` (FK, on delete set null), `brand`,
    `model`, `serial`, `details jsonb` (objeto), `notes`, `is_active`, `created_at`,
    `updated_at`.
  - **`services` suma:**
    - `staff_id` (FK `service_staff`, on delete set null): el responsable;
    - `stays_in_shop boolean not null default true`;
    - `is_repair boolean not null default true`: copia del tipo al crear; los dos `default
      true` son los que deja el front viejo;
    - `at_customer boolean not null default false`;
    - `service_address text`;
    - `subject_id` (FK `customer_subjects`, on delete set null).
  - **`service_equipment_types` suma** `brand_label text default 'Marca'`, `model_label text
    default 'Modelo'`, `stays_in_shop boolean not null default true`, `is_repair boolean not
    null default false`. `serial_label` acepta null (`null` = no lleva). Los tipos que ya
    existen quedan con `is_repair = true`.
  - **`service_types` suma:**
    - `duration_min integer` (> 0);
    - `commission_rate numeric(5,2)` (0–100) y `commission_amount numeric(12,2)` (≥ 0), nunca
      los dos;
    - `repeat_every_days integer` (> 0);
    - `at_customer_default boolean not null default false`.
  - **`taller_settings` suma** `default_at_customer boolean not null default false`.
  - **`service_events` suma** `from_staff` y `to_staff` (FK `service_staff`, on delete set null).
- Produces (funciones):
  - `servicios_ve_orden(p_service_id uuid, p_branch_id uuid, p_staff_id uuid, p_received_by uuid) returns boolean`
    (security definer). Verdadero si se cumple cualquiera:
    - no hay responsable;
    - el responsable o alguna persona de una línea tiene `profile_id = auth.uid()`;
    - `p_received_by = auth.uid()`;
    - `taller_tiene_permiso(p_branch_id, 'services-all', 'view')`.
  - `servicios_asignar(p_service_id uuid, p_staff_id uuid, p_note text default null) returns void`:
    - security definer;
    - las mismas comprobaciones que `taller_asignar`, con `servicios_ve_orden`;
    - la persona tiene que ser activa y de la sucursal de la orden.
  - `servicios_permiso_en_alguna(p_action text) returns boolean`: administrador de la empresa,
    o `taller_tiene_permiso(b, 'services', p_action)` en alguna sucursal suya.
  - Cambiadas sobre la definición viva:
    - **`taller_entregar`:**
      - si `stays_in_shop`, exige `ready` o `not_repaired` (como hoy);
      - si no, cualquier estado abierto, y `picked_up_by_name` queda null.
    - **`taller_cambiar_estado`:** rechaza `ready` si la orden no se queda: «Esta orden no se
      queda en el negocio: termínala cuando acabes.».
    - **`taller_before_update_service`:**
      - `is_repair` no cambia después de crear la orden;
      - `stays_in_shop` no cambia en una orden cerrada ni en `ready`: «Pasa la orden a otro
        estado antes de cambiar si el cliente espera.».
    - **`taller_after_service_event`:** registra los cambios de `staff_id` como `assigned`, con
      `from_staff` y `to_staff`; al crear, `to_staff = new.staff_id`; deja de mirar
      `assigned_to`.
    - **`taller_guardar_servicio(p jsonb)`:**
      - acepta `duration_min`, `commission_rate`, `commission_amount`, `repeat_every_days`,
        `at_customer_default` y `es_servicio` (default true);
      - acepta `link_product_id` solo cuando el servicio todavía no tiene artículo (reglas en
        el paso 3).
    - **`taller_seguimiento_publico`:** suma en `caso`:
      - `se_queda`, `reparacion` y `a_domicilio`;
      - `ficha`: marca y modelo, como `equipo`;
      - `atiende`: el primer nombre del responsable, o null.
    - **`after_service_loyalty_effects`:** `is_module_enabled(new.company_id, 'services', false)`.
  - **RLS:**
    - `services_select` y la parte USING de `services_update` pasan a `servicios_ve_orden(id,
      branch_id, staff_id, received_by)`.
    - `service_staff`: igual que `service_technicians` (ver: la sucursal o su pool
      `servicios`; escribir: `taller_puede_configurar()`).
    - `service_item_staff`:
      - ver: si se ve la línea (subconsulta a `service_items`);
      - escribir: si la orden se ve y `taller_tiene_permiso(branch, 'services', 'edit')`.
    - `customer_subjects`:
      - ver: si se ve el cliente (subconsulta a `customers`);
      - insertar y cambiar: lo mismo, más `servicios_permiso_en_alguna('create')` o
        `servicios_permiso_en_alguna('edit')`;
      - sin borrar (se desactiva).
  - Trigger `servicios_item_staff_guard` (before insert/update/delete en `service_item_staff`):
    - rechaza si la orden ya se cobró o está cerrada (mismos mensajes que
      `taller_service_item_guard`);
    - rechaza si la línea no es `labor`: «Solo los servicios llevan quién los hace.»;
    - rechaza si la persona no está activa o es de otra sucursal: «Esa persona no está en el
      personal de esta sucursal.».
  - Demo: `insert into company_modules (company_id, module_key, enabled) values
    ('00000000-0000-0000-0000-0000000000aa', 'services', true) on conflict do nothing`.

- [ ] **Step 1: Suite (rojo)** `supabase/tests/servicios.sql`, en el formato de
  `motos_sugerencias.sql`:
  - una empresa de prueba propia (`…e7XX`) con dos sucursales;
  - tres usuarios del claim `request.jwt.claims`:
    - un administrador;
    - una persona de personal con usuario, con un rol con `services` view/create/edit y sin
      `services-all`;
    - un cajero sin ser personal.
  - Casos:
    - **A:** la demo tiene `services` en true y `is_module_enabled(<empresa sin fila>,
      'services', false)` es false.
    - **B:** crear personal sin usuario y una orden asignada a él. `servicios_asignar` a una
      persona inactiva o de la otra sucursal falla con su mensaje.
    - **C:** una línea `labor` con dos personas se guarda. A una línea `part` no se le pone
      persona. Con la orden cobrada (`sale_id` puesto bajo `set_config('taller.cobro','si')`)
      ya no se cambian las personas.
    - **D:**
      - una orden con `stays_in_shop = false` no pasa a `ready`;
      - `taller_entregar` la cierra desde `in_repair` con `picked_up_by_name` null;
      - una que se queda y está en `ready` no cambia `stays_in_shop`;
      - `is_repair` no cambia.
    - **E:** el historial tiene un `assigned` con `from_staff` y `to_staff` al reasignar.
    - **F:** como la persona con usuario:
      - ve su orden, la que tiene en una línea y la sin asignar, pero no la de otra persona;
      - después de `servicios_asignar` a otra persona, su orden ya no está en `select` y no
        hubo error.
    - **G:** `taller_guardar_servicio` con `link_product_id`:
      - artículo con existencias 5 → error que contiene «tiene existencias»;
      - artículo de la otra sucursal → «no es de esta sucursal»;
      - artículo ya enlazado a otro servicio → «ya es otro servicio del catálogo»;
      - artículo con existencias 0 → queda enlazado con `tracks_stock = false` y `es_servicio = true`.
    - **H:** `customer_subjects`: el cajero sin `services` create no inserta; la persona con
      usuario sí.
    - **I:** `taller_seguimiento_publico` trae `se_queda`, `reparacion`, `a_domicilio` y
      `atiende` (primer nombre).
    - **J:**
      - `anon` no ejecuta `servicios_ve_orden`, `servicios_asignar` ni
        `servicios_permiso_en_alguna`, y no tiene permisos en las tres tablas nuevas;
      - la persona con usuario no ve el personal, las fichas ni las órdenes de la empresa de
        prueba de otra empresa (una segunda empresa `…e8XX`).
- [ ] **Step 2:** correr la suite sin la migración, en `begin … rollback`. Expected: falla A.
- [ ] **Step 3: Migración.** Comprobar las huellas md5 de las siete funciones vivas antes de
  reemplazarlas. Sacar las huellas de `pg_get_functiondef` en producción al escribir la
  migración y anotarlas en el archivo.

  Reglas de `link_product_id`, en este orden:
  1. El artículo es de la empresa y de la sucursal del servicio. Si no: «El artículo no es de
     esta sucursal.».
  2. No está enlazado a otro `service_types`. Si lo está: «Ese artículo ya es otro servicio del
     catálogo.».
  3. Si `tracks_stock` y `stock > 0`: «Ese artículo tiene existencias (N). Crea un servicio
     nuevo y agrega el artículo a la orden como material.».
  4. Luego se actualiza el artículo: `tracks_stock = false`, `es_servicio`, nombre, precio e
     ITBIS.
- [ ] **Step 4:** verde: migración + suite en `begin … rollback`. Expected: `ok`.
- [ ] **Step 5:** commit `Servicios: personal, fichas del cliente y camino de la orden en la base`.

### Task 3: Tipos, mappers y configuración en el front

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/supabase/mappers.ts`,
  `src/components/taller/use-taller-config.ts`, `src/components/taller/historial.tsx`

**Interfaces:**
- Consumes: las tablas de T2 y los tipos de T1.
- Produces:
  - `type Staff = { id: string; branchId: string; name: string; phone?: string; color?: string; commissionRate: number; profileId?: string; isActive: boolean; position: number }`.
  - `type CustomerSubject = { id: string; customerId: string; equipmentTypeId?: string; brand?: string; model?: string; serial?: string; details: Record<string, string>; notes?: string; isActive: boolean }`.
  - `ServiceType` suma `durationMin?`, `commissionRate?`, `commissionAmount?`,
    `repeatEveryDays?` y `atCustomerDefault: boolean`.
  - `ServiceItem` suma `staffIds: string[]`.
  - `ServiceEvent` suma `fromStaff?` y `toStaff?`.
  - `TallerSettings` suma `defaultAtCustomer: boolean`.
  - `rowToStaff` y `rowToCustomerSubject` en `mappers.ts`.
  - `SERVICE_SELECT` cambia `profiles!services_assigned_to_fkey(...)` por
    `service_staff!services_staff_id_fkey(id,name,profile_id)`, y `Service` suma `staff?: Staff`.
  - `useTallerConfig()` suma `staff: Staff[]` (activos e inactivos, en orden) y `myStaffIds:
    string[]` (los del usuario).
  - El select de líneas suma `service_item_staff(staff_id)`.
- **Se borran en T6, no aquí** (para que cada tarea compile): `technicians` del hook, el tipo
  `Technician`, `Service.assignedTo` y `Service.assignedUser`. Con el select nuevo,
  `assignedUser` llega vacío hasta entonces.
- [ ] **Step 1:** hacer los cambios; `historial.tsx` muestra «Pasó de {persona} a {persona}» con
  los nombres de `staff` (las personas inactivas también).
- [ ] **Step 2:** `npx tsc --noEmit` y `npm test`. Expected: verde.
- [ ] **Step 3:** commit `Servicios: personal y fichas en los tipos y la configuración del front`.

### Task 4: Configuración de Servicios

**Files:**
- Modify: `src/app/(app)/service-types/page.tsx`, `src/components/taller/config/equipment-tab.tsx`,
  `catalog-tab.tsx`, `general-tab.tsx`
- Create: `src/components/taller/config/staff-tab.tsx` (reemplaza a `technicians-tab.tsx`, que se
  borra)
- Create: `src/components/taller/aplicar-plantilla.ts`

**Interfaces:**
- Consumes: `useTallerConfig()` (T3), `RUBROS` y `fichaFields` (T1), `taller_guardar_servicio`
  (T2).
- Produces:
  - `aplicarPlantilla(key: string, opts: { companyId?: string; existentes: string[] }): Promise<{ creados: string[]; error?: string }>`
    - crea los tipos de ficha que falten por nombre, con sus chequeos (los dos primeros
      obligatorios, también en «Atender ahora»);
    - si el rubro es `aDomicilio`, pone `default_at_customer = true` en los `taller_settings`
      de las sucursales de la empresa;
    - `companyId` se pasa solo desde el alta de empresa.

Pantalla «Configuración de Servicios», pestañas **Tipos de ficha · Chequeos · Catálogo ·
Personal · General**:

- **Tipos de ficha:**
  - nombre;
  - los tres campos con su etiqueta y una casilla «Lleva» cada uno (sin «Lleva» = `null`);
  - «Pide clave o patrón»;
  - campos propios;
  - «Se deja en el negocio» y «De reparación»;
  - plantillas con los rubros de T1. Un tipo nuevo arranca con «Se deja» encendido y «De
    reparación» apagado.
- **Catálogo:** suma:
  - duración (min);
  - comisión: «% de la persona» (vacío), % o monto fijo (radio de tres);
  - volver cada (días);
  - a domicilio por defecto;
  - «Factura como servicio (e-CF)».
  
  Al crear, o en un servicio sin artículo, se puede elegir **Usar un artículo que ya existe**:
  buscador de artículos de la sucursal, que manda `link_product_id`. El error de la base se
  muestra tal cual en el toast.
- **Personal:**
  - lista de la sucursal con nombre, teléfono, color, % de comisión, usuario (opcional:
    `<select>` nativo con los usuarios de la sucursal, como hoy salen en técnicos) y activo;
  - agregar, editar y desactivar (no se borra a nadie que tenga órdenes; si no tiene, se borra);
  - texto de ayuda: «Quien no tiene usuario no gasta cupo. Con usuario, entra y ve lo suyo.».
- **General:** suma «Las órdenes nuevas son a domicilio».

- [ ] **Step 1: Prueba (rojo)** en `taller.test.mjs`:
  - `test('plantilla: nombres que faltan')` sobre una función pura
    `tiposQueFaltan(key: string, existentes: string[]): EquipmentTemplate[]` (en `taller.ts`).
    Ignora mayúsculas y espacios: con `existentes = [' perro ']`, `mascotas` devuelve solo
    «Gato».
- [ ] **Step 2:** `npm test`. Expected: falla.
- [ ] **Step 3:** implementar `tiposQueFaltan`, `aplicarPlantilla` y las pestañas. Los diálogos
  de esta pantalla no usan `Select` de Radix.
- [ ] **Step 4:** `npm test` y `npx tsc --noEmit`. Expected: verde.
- [ ] **Step 5:** commit `Servicios: configuración con tipos de ficha, personal y catálogo nuevos`.

### Task 5: Nueva orden y Atender ahora

**Files:**
- Modify: `src/app/(app)/services/nuevo/nuevo-client.tsx`, `src/lib/taller.ts`
- Create: `src/components/taller/ficha-picker.tsx`, `src/components/taller/lineas-nuevas.tsx`
- Test: `scripts/tests/taller.test.mjs`

**Interfaces:**
- Consumes: `useTallerConfig()` (T3), `fichaFields`, `defaultStaysInShop` y `checklistFor` (T1).
- Produces:
  - `ordenNueva(i: { ahora: boolean; tipo?: Pick<EquipmentType, 'staysInShop' | 'isRepair'>; clienteEspera: boolean; atCustomer: boolean; direccion?: string; cliente?: Pick<Customer, 'address' | 'collectionAddress'>; lineas: { staffIds: string[] }[]; responsable?: string }): { status: 'received' | 'in_repair'; stays_in_shop: boolean; is_repair: boolean; at_customer: boolean; service_address: string | null; staff_id: string | null }`.
    Función pura en `taller.ts` con las reglas del paso «Al guardar».
  - `<FichaPicker customerId? types value onChange />`.
    - `value: { mode: 'none' } | { mode: 'saved'; subject: CustomerSubject } | { mode: 'new'; equipmentTypeId: string; brand; model; serial; details; notes }`;
    - con cliente, muestra sus fichas activas;
    - sin cliente (consumidor final), solo «nada» o «nueva»;
    - una ficha nueva se guarda en `customer_subjects` solo si hay cliente.
  - `<LineasNuevas catalog staff value onChange />`.
    - `value: { serviceTypeId: string; staffIds: string[]; price: number }[]`;
    - cada línea con su precio y casillas de personas.
- `?modo=ahora` es «Atender ahora»; `?modo=rapida` redirige a `?modo=ahora`.

Al guardar:
1. Si la ficha es nueva y hay cliente, se crea `customer_subjects`.
2. Se crea `services`:
   - `staff_id` = la primera persona de la primera línea, o la elegida en «Lo atiende»;
   - `stays_in_shop` = `defaultStaysInShop(...)`, o apagado si se marcó «El cliente espera»;
   - `is_repair` del tipo de ficha (sin ficha: false);
   - `at_customer` y `service_address` (por defecto `collection_address` o `address` del
     cliente);
   - `subject_id`, y la copia de la ficha en `equipment_*` y `equipment_details`;
   - `status`: `in_repair` en «Atender ahora» y `received` si no.
3. Se crean las líneas `labor` y sus `service_item_staff`.
4. Recibo de recepción solo si hay ficha que se queda.

Lo que se ve según lo elegido:
- Sin ficha: no salen chequeos, accesorios, clave, fotos ni «quién lo trae».
- Presupuesto y fecha prometida: solo con ficha de reparación.
- «A domicilio» arranca con `at_customer_default` del primer servicio, o con
  `default_at_customer` de la sucursal. Con «a domicilio» encendido se pide la dirección.
- «Garantía» (reingreso) queda como hoy, solo para fichas de reparación.

- [ ] **Step 1: Prueba (rojo)** `test('orden nueva')`:
  - **sin ficha, ahora:** con `lineas [{staffIds:['p1','p2']}]` →
    - `status 'in_repair'`, `stays_in_shop false`, `is_repair false`;
    - `staff_id 'p1'`, `service_address null`.
  - **con responsable:** `responsable 'p9'` gana sobre la primera persona.
  - **tipo que se queda y de reparación, sin «ahora»:** →
    - `status 'received'`, `stays_in_shop true`, `is_repair true`;
    - con `clienteEspera true` → `stays_in_shop false`.
  - **a domicilio:**
    - sin `direccion` y con `cliente {address:'Calle 1', collectionAddress:'Calle 2'}` →
      `stays_in_shop false`, `service_address 'Calle 2'`;
    - con `direccion ' Calle 3 '` → `'Calle 3'`.
  - **sin personas:** `staff_id null`.
- [ ] **Step 2:** `npm test`. Expected: falla.
- [ ] **Step 3:** implementar `ordenNueva`. Construir `FichaPicker` y `LineasNuevas`, y rehacer
  `nuevo-client.tsx` sobre ellos. Títulos «Nueva orden» / «Atender ahora»; botones «Cobrar ahora
  · RD$…» y «Cobrar al final».
- [ ] **Step 4:** `npm test` y `npx tsc --noEmit`. Expected: verde.
- [ ] **Step 5:** commit `Servicios: nueva orden con o sin ficha, varias personas y a domicilio`.

### Task 6: La orden, la lista, el recibo y el seguimiento

**Files:**
- Modify: `src/app/(app)/services/caso/caso-client.tsx`, `src/app/(app)/services/page.tsx`,
  `src/components/taller/status-badge.tsx`, `src/components/taller/recibo-recepcion.tsx`,
  `src/app/(portal)/seguimiento/seguimiento-client.tsx`,
  `src/app/(app)/customers/history/customer-history-client.tsx`

**Interfaces:**
- Consumes:
  - `statusCtx`, `statusLabel`, `customerText`, `manualStatuses`, `canClose`, `closeLabel` (T1);
  - `servicios_asignar` y `taller_entregar` (T2);
  - `useTallerConfig().staff` y `myStaffIds` (T3).
- Produces: `<StatusBadge status ctx />` (el `ctx` es obligatorio).

**Orden (`caso-client`):**
- Encabezado «Orden #0142 · {ficha o servicios} · {cliente}». «días en el taller» pasa a «días
  aquí», y solo sale si se queda.
- «Lo atiende»: diálogo con `<select>` nativo del personal activo; llama a `servicios_asignar`.
  «Tomar» la orden queda para quien está en `myStaffIds`.
- Cada línea de servicio muestra sus personas y deja cambiarlas (diálogo con casillas, que
  escribe en `service_item_staff`). Mientras la orden esté abierta y sin cobrar, se puede
  agregar una línea con personas.
- Menú de estados con `manualStatuses(ctx)`. El botón de cerrar dice `closeLabel(ctx)` y sale
  cuando `canClose`. «Terminar» no pide quién retira.
- Interruptor «El cliente espera» (escribe `stays_in_shop`); escondido en `ready` y en órdenes
  cerradas.
- A domicilio: la dirección en la ficha y en el mensaje de WhatsApp.
- Las notas de la ficha guardada (`subject_id`) salen arriba de la ficha.
- El diálogo de asignar deja de usar `Select` de Radix.

**Lista (`services/page`):**
- Título «Servicios», botones «Nueva orden» y «Atender ahora».
- Pestañas «En curso · Listos · Terminadas · Todas».
- Filtro y columna «Lo atiende» por personal.
- La búsqueda suma el nombre de la ficha.
- Un usuario sin «ver todas» ve lo que le deja la RLS (no hay filtro extra en el front).

**Recibo de recepción:** solo para órdenes que se quedan. Los campos salen con las etiquetas
del tipo de ficha; la clave solo si el tipo la pide.

**Seguimiento (portal):**
- Usa `se_queda`, `reparacion`, `a_domicilio` y `atiende` para el texto y los pasos. Sin ficha
  y cerrada: «¡Gracias por visitarnos!».
- Los pasos que muestra:
  - se queda: Recibido → En proceso → Listo → Entregado (más los de reparación si toca);
  - no se queda: Llegó → En proceso → Terminado.

**Historial del cliente:** «Servicios» en vez de «Taller», con `StatusBadge` con contexto.

**Limpieza del front:** se borran `technicians` del hook, el tipo `Technician`,
`Service.assignedTo` y `Service.assignedUser` (ver T3).

- [ ] **Step 1:** hacer los cambios.
- [ ] **Step 2:** `npx tsc --noEmit` y `npm test`. Expected: verde en todo el proyecto.
- [ ] **Step 3:** `grep -rniE "taller|técnico|tecnico" src --include=*.tsx`. Expected: solo
  comentarios, nombres internos (rutas, imports, `taller.ts`) y textos condicionados a
  `isRepair`. Anotar en el commit lo que quede y por qué.
- [ ] **Step 4:** commit `Servicios: la orden, la lista, el recibo y el seguimiento según el camino`.

### Task 7: Nombre del módulo, menú, permisos, reportes y rubros

**Files:**
- Modify: `src/lib/modules.ts`, `src/lib/business-types.ts`, `src/lib/permissions.ts`,
  `src/app/(app)/authed-layout.tsx`, `src/app/(app)/reports/page.tsx`,
  `src/app/(app)/admin/empresas/page.tsx`, `src/components/admin/company-modules-dialog.tsx`,
  `src/components/pos/cart-display.tsx`, `src/components/pos/product-search.tsx`,
  `src/app/(app)/sales/detail/sale-receipt-client.tsx`
- Move: `src/app/(app)/reports/taller/page.tsx` → `src/app/(app)/reports/servicios/page.tsx`
- Create: `src/app/(app)/reports/taller/page.tsx` (solo redirige a `/reports/servicios`)
- Test: `scripts/tests/taller.test.mjs`

**Interfaces:**
- Consumes: `aplicarPlantilla` (T4), `RUBROS` (T1).
- Produces:
  - `BusinessType` suma `'salon' | 'mascotas' | 'limpieza' | 'lubricentro'`, cada uno con
    `modules: ['services']` y `tallerRubro` con la misma clave.
  - En `modules.ts`, `services` queda así:
    - `label: 'Servicios'`;
    - `description: 'Órdenes de servicio para cualquier negocio: personal, fichas de lo que se atiende, chequeos, materiales del inventario y cobro por el POS.'`;
    - `defaultEnabled: false`.
  - `ROUTE_MODULE` suma `/reports/servicios` → `services`, antes de `/reports`.

Textos:
- **Menú:**
  - «Servicios» con un ícono que no sea `Wrench` (`ConciergeBell` de lucide);
  - «Configuración de Servicios»;
  - reporte «Servicios».
- **Permisos:**
  - `services`: «Servicios»;
  - `services-all`: «Servicios: ver todas las órdenes (sin esto, solo las suyas y las sin
    asignar)»;
  - `service-types`: «Configuración de Servicios»;
  - reporte `taller`: «Servicios (personal, tiempos, materiales)».
- **Reporte:**
  - la página movida usa `staff_id` y `service_staff!services_staff_id_fkey(name)` donde hoy
    usa `assigned_to` y el perfil;
  - la columna «Técnico» pasa a «Lo atiende» y el título a «Servicios»;
  - `porTecnico` no cambia.
- **POS y venta:**
  - la insignia «Taller» del carrito pasa a «Orden #0142»;
  - «del taller» pasa a «de la orden»;
  - «Garantía al taller» pasa a «Ingresar por garantía».
- **Alta de empresa:** reemplaza el bucle de `tallerRubro` por `aplicarPlantilla(key, {
  companyId, existentes: [] })`.
- **Panel de módulos:** al encender `services` se abre un diálogo pequeño con las plantillas de
  `RUBROS` más «Ninguna», que llama a `aplicarPlantilla` con el `companyId` de la empresa.

- [ ] **Step 1: Pruebas (rojo)** en `taller.test.mjs`:
  - `test('Servicios apagado por defecto')`:
    - `resolveEnabledModules([])` no incluye `services`;
    - `resolveEnabledModules([{module_key:'services',enabled:true}])` sí.
  - `test('rubros de servicios')`: `salon`, `mascotas`, `limpieza`, `lubricentro` y
    `reparaciones` encienden `services`, y su `tallerRubro` existe en `RUBROS`.
  - `test('la ruta del reporte nuevo')`: `moduleForRoute('/reports/servicios')` es `services`.
- [ ] **Step 2:** `npm test`. Expected: fallan.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npm test` y `npx tsc --noEmit`. Expected: verde.
- [ ] **Step 5:** commit `Servicios: nombre del módulo, menú, permisos, reporte y rubros nuevos`.

### Task 8: Verificación, aplicar y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit` y `npm run build`, sin `next dev` corriendo.
  Expected: todo verde.
- [ ] **Step 2:** revisión final del branch (subagente) y un pase de arreglos, cada arreglo
  con su prueba fallando primero.
- [ ] **Step 3: Prueba en navegador** con la demo (`localhost`, Louis inicia sesión él mismo).
  Antes: desregistrar el service worker y vaciar las caches. Datos de prueba por SQL, con la
  migración aplicada solo dentro de la prueba, o después del paso 4.
  - **Salón sin ficha:** crear personal sin usuario y servicios del catálogo. Atender ahora
    con dos personas en una línea → En proceso → Terminar. Ninguna palabra de taller.
  - **Mascota:** plantilla Mascotas, ficha guardada «Max», nueva orden. La segunda orden de
    ese cliente ofrece a Max. Recibo con «Nombre» y «Raza».
  - **Teléfono de reparación:** pasa por los estados de reparación, Entregar pide quién retira.
  - **Usar un artículo que ya existe** con un artículo con existencias: sale el mensaje.
  - **No cobrar** ninguna orden en la demo (e-CF en TesteCF).
  - Borrar los datos de prueba.
- [ ] **Step 4: Aplicar**, con el OK de Louis para fusionar a continuación:
  - `apply_migration`;
  - md5 de las funciones contra el archivo;
  - la suite contra lo aplicado;
  - `get_advisors`;
  - logs de la API sin 300 ni 42501.
- [ ] **Step 5:**
  - commit, push y PR a `main` con el resumen y lo que no se probó;
  - memoria del proyecto (`sellalles-modulo-servicios.md`);
  - no fusionar sin Louis;
  - anotar como pendiente la migración de limpieza: borrar `assigned_to`,
    `service_technicians`, `taller_asignar` y `taller_ve_caso` después de ver el despliegue
    sano.
