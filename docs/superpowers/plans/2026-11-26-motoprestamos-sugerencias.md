# Motopréstamos · Sugerencias al encender el módulo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** al encender Motopréstamos se cargan solos, sin duplicar, los tipos de vehículo y las categorías de inventario sugeridos.

**Architecture:** dos funciones de siembra, llamadas por dos triggers:
- uno en `company_modules`, cuando Motopréstamos queda encendido;
- otro en `branches`, para cada sucursal nueva de una empresa con el módulo encendido.

El alta con el rubro deja de sembrar «Motor» desde el front.

**Tech Stack:** Supabase (plpgsql, triggers), Next.js 14, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-26-motoprestamos-sugerencias-design.md`

## Global Constraints

- **Migraciones:** las aplico yo con `apply_migration`; nunca `supabase db push`. Antes, verde en `begin … rollback`; después, md5, `get_advisors` y logs.
- **Funciones nuevas:** `security definer`, `set search_path = public`, y `revoke execute … from public, anon, authenticated` (solo las llaman los triggers).
- **Funciones vivas:** no se toca ninguna.
- **Listas:**
  - tipos de vehículo: Motor, Pasola, Carro, Jeepeta, Camioneta;
  - categorías: Motores, Pasolas, Repuestos, Accesorios.
- **PR:** a `main`. No fusionar sin el OK de Louis.

## Review Focus

1. **Pool de categorías:** dos sucursales que comparten categorías ven cada sugerencia una sola vez, y una sucursal fuera del pool recibe las suyas. → T1.
2. **Nombres que ya existen** con otras mayúsculas («motor», «REPUESTOS») no se repiten. → T1.
3. **Encender, apagar y volver a encender** no duplica. → T1.
4. **Alta de una empresa con el rubro:** el trigger siembra una sola vez y el front ya no inserta «Motor». → T1 y T2.
5. **Otros módulos** encendidos no siembran nada. → T1.

---

### Task 1: Base de datos

**Files:**
- Create: `supabase/migrations/20261127130000_motos_sugerencias.sql`
- Create: `supabase/tests/motos_sugerencias.sql`

**Interfaces:**
- **Produces:**
  - `motos_sembrar_categorias(p_branch_id uuid) returns void`
  - `motos_sembrar_sugerencias(p_company_id uuid) returns void`: siembra los tipos y llama a la anterior por cada sucursal, en orden de creación.
  - Trigger `trg_motos_sugerencias` en `company_modules`, AFTER INSERT OR UPDATE OF enabled.
  - Trigger `trg_motos_sugerencias_sucursal` en `branches`, AFTER INSERT.

- [ ] **Step 1: Suite (rojo).** Con una empresa de prueba propia (`companies` y `branches` solo piden `name`), en el formato de las suites de 4A y 4B (un caso por bloque, lista al final):
  - **A:** encender el módulo (insert) carga los 5 tipos y las 4 categorías en la sucursal.
  - **B:** con «motor» y «REPUESTOS» ya creados, no se repiten (5 tipos y 4 categorías en total).
  - **C:** apagar y volver a encender (update) no duplica.
  - **D:**
    - dos sucursales en un pool de `categorias` tienen las 4 sugerencias una sola vez entre las dos;
    - una tercera fuera del pool tiene sus 4;
    - una sucursal nueva creada con el módulo encendido recibe las suyas.
  - **E:** encender otro módulo (`caja`) no siembra nada.
  - **F:** `authenticated` no puede ejecutar las funciones de siembra.
- [ ] **Step 2:** correr la suite sin la migración. Expected: falla A (no se carga nada).
- [ ] **Step 3: Migración.**
  - **Comparación:** sin importar mayúsculas, con `lower(btrim(name))`.
  - **Tipos:** `position` = máximo actual + 1, 2…
  - **Categorías:** el pool de la sucursal se toma de `branch_sharing` (ámbito `categorias`) cuando `company_branch_sharing.enabled`.
  - **Trigger de `company_modules`:** solo para `module_key = 'motoprestamos'`, cuando queda encendido (insert encendido, o `old.enabled` distinto de true).
  - **Trigger de `branches`:** solo si `is_module_enabled(new.company_id, 'motoprestamos', false)`.
- [ ] **Step 4:** verde: la migración más la suite, en `begin … rollback`. Expected: `SUITE_OK`.
- [ ] **Step 5:** commit: `Motopréstamos: sugerencias de tipos y categorías al encender el módulo`.

### Task 2: El alta con el rubro deja de sembrar «Motor» desde el front

**Files:**
- Modify: `src/app/(app)/admin/empresas/page.tsx` (se quita el bloque `preset.vehicleTypes`)
- Modify: `src/lib/business-types.ts` (se quitan `vehicleTypes` del tipo y del preset)
- Test: `scripts/tests/motos.test.mjs`

- [ ] **Step 1:** la prueba del rubro pasa a afirmar que el preset ya no trae `vehicleTypes`, porque los siembra la base al encender el módulo. Correrla: rojo.
- [ ] **Step 2:** quitar el campo y el bloque. `npm test` y `npx tsc --noEmit` en verde.
- [ ] **Step 3:** commit: `Motopréstamos: el alta con el rubro deja la siembra de tipos a la base`.

### Task 3: Revisión, aplicar y PR

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit` y `next build`.
- [ ] **Step 2:** revisión final (subagente opus) y un pase de arreglos, cada uno con su prueba fallando primero.
- [ ] **Step 3: Aplicar:**
  - `apply_migration`;
  - md5 de las funciones contra el archivo;
  - suite contra lo aplicado;
  - advisors y logs.
- [ ] **Step 4:**
  - en producción, ver que ninguna empresa con el módulo ya encendido recibió nada al aplicar (los triggers solo actúan en lo que cambia después);
  - commit, push y PR a `main`;
  - memoria;
  - no fusionar sin Louis.
