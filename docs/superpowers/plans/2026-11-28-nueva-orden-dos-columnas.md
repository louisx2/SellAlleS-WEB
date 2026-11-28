# Nueva orden en dos columnas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/services/nuevo` quepa en menos de 2 pantallas de laptop, con el total y el botón Crear / Cobrar siempre a la vista.

**Architecture:** Solo front. Se compactan dos componentes que solo usa Nueva orden (`ChecklistForm`, `FichaPicker`) y se reacomoda `nuevo-client.tsx` en una grilla de dos columnas con un panel derecho `sticky`. Una función pura nueva (`notaVisible`) decide cuándo se ve la nota de un chequeo y se prueba con `node --test`.

**Tech Stack:** Next 14.2 (export estático), React, Tailwind, componentes shadcn del proyecto.

**Spec:** `docs/superpowers/specs/2026-11-28-nueva-orden-dos-columnas-design.md`

## Global Constraints

- Sin cambios en qué se guarda, validaciones (`validate()`), permisos ni base de datos.
- Textos, ayudas y placeholders actuales se mantienen salvo donde el diseño los cambia. Todo en español.
- En Servicios se usa `<select>` nativo con `SELECT_CLASS`, no el Select de Radix.
- Pantalla ancha = `lg` en adelante. Ancho máximo de la página: `max-w-6xl`. Panel derecho: `24rem`.
- El encabezado de la app es fijo (56/64 px, +28 px con aviso arriba): el panel usa `lg:top-24` y `lg:max-h-[calc(100dvh-7rem)]`.
- Tarjetas de esta pantalla con relleno compacto: `CardHeader className="p-4 pb-2"`, `CardContent className="p-4 pt-0"`.

## Review Focus

1. Panel derecho más alto que la pantalla (varios servicios × varias personas, más la pieza): el total y los botones siguen visibles; lo de arriba se desplaza dentro del panel.
2. Teléfono: la barra de abajo no tapa el último campo (fotos) ni el botón «Agregar fotos».
3. Chequeo contestado «No» → sale la nota; si luego cambia a «Sí» con la nota ya escrita, la nota sigue a la vista (no se pierde lo escrito).
4. Fichas con nombres largos («Honda · CG 150 · K123456») en los botones: se parten en otra línea sin desbordar; se eligen con teclado (Tab + flechas / espacio).
5. Variantes del formulario: garantía (sin «Nada»), negocio sin tipos de ficha (sin tarjetas de ficha, chequeos ni recepción) y Atender ahora con pieza en el panel: todas quedan ordenadas.

El punto 3 tiene prueba unitaria en la Tarea 1; los demás se revisan en el navegador en la Tarea 4.

---

### Task 1: Chequeos compactos en dos columnas

**Files:**
- Modify: `src/lib/taller.ts` (agregar `notaVisible`)
- Modify: `src/components/taller/checklist-form.tsx`
- Test: `scripts/tests/taller.test.mjs`

**Interfaces:**
- Produces: `notaVisible(a: ChecklistAnswer | undefined, abierta: boolean): boolean` exportada de `src/lib/taller.ts`. `ChecklistForm` conserva sus props (`items`, `answers`, `onChange`, `requiredOf`).

- [ ] **Step 1: Prueba que falla** — en `taller.test.mjs`, importar `notaVisible` y agregar `test('la nota del chequeo se ve con «No», con nota escrita o abierta a mano', …)`:

```js
assert.equal(notaVisible(undefined, false), false);
assert.equal(notaVisible(undefined, true), false); // sin respuesta no hay nota
assert.equal(notaVisible({ itemId: 'a', label: 'Prende', answer: 'si' }, false), false);
assert.equal(notaVisible({ itemId: 'a', label: 'Prende', answer: 'no' }, false), true);
assert.equal(notaVisible({ itemId: 'a', label: 'Prende', answer: 'si', note: 'raya leve' }, false), true);
assert.equal(notaVisible({ itemId: 'a', label: 'Prende', answer: 'si', note: '   ' }, false), false);
assert.equal(notaVisible({ itemId: 'a', label: 'Prende', answer: 'np' }, true), true);
```

- [ ] **Step 2:** `npm test` → falla con `notaVisible` no exportada.
- [ ] **Step 3: Implementar `notaVisible`** en `src/lib/taller.ts`: sin respuesta → `false`; si no, `answer === 'no' || !!note?.trim() || abierta`.
- [ ] **Step 4:** `npm test` → todo verde.
- [ ] **Step 5: `ChecklistForm` compacto.**
  - Contenedor: `grid gap-2 sm:grid-cols-2`.
  - Cada chequeo: `rounded-md border p-2`; arriba una fila `flex flex-wrap items-center gap-x-2 gap-y-1`: el nombre (con su `*`, `flex-1 min-w-[7rem] text-sm font-medium`), los tres botones Sí / No / No probado (mismas clases que hoy) y un botón de ícono `StickyNote` (`h-7 w-7`, `aria-label={`Nota de ${item.label}`}`, `aria-expanded`), que solo sale cuando el chequeo ya tiene respuesta.
  - Estado local `abiertas: Set<string>`; el ícono alterna el id. La `Input` de nota (`h-8 mt-2`, placeholder «Nota (opcional)», `autoFocus` al abrirla con el ícono) sale cuando `notaVisible(a, abiertas.has(item.id))`.
- [ ] **Step 6:** `npx tsc --noEmit` → sin errores nuevos.
- [ ] **Step 7: Commit** — «Servicios: chequeos de llegada en dos columnas y nota a pedido».

### Task 2: «Qué se atiende» con botones

**Files:**
- Modify: `src/components/taller/ficha-picker.tsx` (solo `Opcion` y el `radiogroup`)

**Interfaces:**
- Consumes/Produces: la API de `FichaPicker` no cambia (`customerId`, `types`, `value`, `onChange`, `allowNone`), ni las funciones exportadas.

- [ ] **Step 1: `Opcion` como botón.** El `<label>` pasa a `inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm`; elegido: `border-primary bg-primary text-primary-foreground`; si no, `hover:bg-muted`; foco visible con `focus-within:ring-2 focus-within:ring-ring`. El `<input type="radio">` sigue adentro con `sr-only` (conserva teclado y lector). El texto puede partirse en dos líneas (`break-words`, sin `truncate`). Nueva prop `notas?: boolean` → ícono `StickyNote` `h-3.5 w-3.5` con `aria-label="Tiene notas"`.
- [ ] **Step 2: Fila y ayuda.** El `radiogroup` pasa a `flex flex-wrap gap-2`. Los textos de ayuda (`hint`) ya no van dentro de cada opción: debajo de la fila, una sola línea `text-xs text-muted-foreground` con la ayuda de la opción elegida (las mismas frases de hoy; para una ficha guardada, el nombre de su tipo). «Nueva ficha» se rotula «+ Nueva ficha». Los avisos de carga y error quedan debajo de la fila.
- [ ] **Step 3:** `npx tsc --noEmit` → sin errores nuevos.
- [ ] **Step 4: Commit** — «Servicios: qué se atiende se elige con botones».

### Task 3: Nueva orden en dos columnas

**Files:**
- Modify: `src/app/(app)/services/nuevo/nuevo-client.tsx` (solo el JSX del `return` principal; la lógica no cambia)

**Interfaces:**
- Consumes: `ChecklistForm` (Tarea 1) y `FichaPicker` (Tarea 2) con sus props de siempre.

- [ ] **Step 1: Encabezado en una línea.** Página `mx-auto max-w-6xl`. Una fila `mb-4 flex flex-wrap items-center gap-2`: botón fantasma «← Servicios», `h1` `text-2xl font-bold tracking-tight` («Atender ahora» / «Nueva orden») y, a la derecha (`ml-auto`), el botón que alterna el modo (el mismo de hoy). Ya no se usa `PageHeader` aquí. La ayuda de Atender ahora y el aviso de garantía quedan debajo, a lo ancho.
- [ ] **Step 2: Grilla.** El `<form>` pasa a `grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start`. Hijos en este orden del DOM (es el orden en el teléfono):
  1. Bloque A (`space-y-4 lg:col-start-1 lg:row-start-1`): Cliente y Qué se atiende.
  2. Panel (`lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col`): una `Card`.
  3. Bloque B (`space-y-4 lg:col-start-1 lg:row-start-2`): Falla / Notas, Cómo llega, Recepción y fotos.
  4. Barra de acciones del teléfono (`lg:hidden`, ver Step 5).
- [ ] **Step 3: Tarjetas de la izquierda.**
  - Cliente: `Card` sin título; `CardContent className="p-3"` con la fila de hoy (rótulo `text-xs text-muted-foreground` «Cliente», nombre, teléfono, Quitar / Elegir o Cambiar). «Lo trae otra persona» y sus campos siguen debajo, igual que hoy.
  - Qué se atiende y Falla: iguales, con el relleno compacto de Global Constraints.
  - Cómo llega: igual (ya compacto por la Tarea 1).
  - Recepción y fotos (solo `conFicha`): una sola `Card` titulada «Recepción». Adentro: lo que deja (chips + «Otro»), la fila de presupuesto / prometido para (como hoy) y, al final, las fotos (lista de fotos + «Agregar fotos», con la ayuda de hoy en `text-xs`).
- [ ] **Step 4: Panel derecho.** Dentro de la `Card` del panel:
  - Parte que se desplaza (`lg:min-h-0 lg:flex-1 lg:overflow-y-auto`, `p-4 space-y-4`): título «Servicios» y su descripción, `LineasNuevas`, Lo atiende (o el aviso sin personal), la pieza (si `muestraPieza`) y, separado con `border-t pt-3`, lo de «Dónde se atiende» (A domicilio, dirección, El cliente espera), con el mismo texto y la misma lógica.
  - Pie fijo del panel (`hidden lg:block border-t p-4 space-y-3`): `acciones` (ver Step 5).
- [ ] **Step 5: Acciones una sola vez en el código.** Una constante JSX `acciones` con: la fila Total (si hay líneas o pieza), la nota del ITBIS y los botones de hoy (Cancelar · Crear orden / Crear orden e imprimir recibo, o Cobrar al final · Cobrar ahora · total), mismos `type`, `disabled` y textos. Se pone en el pie del panel (pantalla ancha) y en la barra del teléfono: `lg:hidden sticky bottom-0 z-10 -mx-4 border-t bg-background px-4 py-3 sm:-mx-6 sm:px-6`, como último hijo del `<form>`. Con `display: none`, la copia oculta no recibe foco ni se lee.
- [ ] **Step 6:** `npx tsc --noEmit` y `npm test` → sin errores nuevos.
- [ ] **Step 7: Commit** — «Servicios: Nueva orden en dos columnas con el panel de servicios fijo».

### Task 4: Verificación

- [ ] **Step 1:** `npm run build` → termina (el `.env.local` y los `node_modules` del worktree tienen que estar).
- [ ] **Step 2: Navegador, 1366×768** (Louis entra él a la demo en `localhost:3001`; antes, desregistrar el service worker y borrar caches). En Nueva orden de reparación con cliente, ficha guardada y 6 chequeos: medir `document.documentElement.scrollHeight` (meta < 1,180 px ≈ 2 pantallas) y comprobar que el botón Crear se ve al bajar hasta el final y arriba del todo. Recorrer los 5 puntos de Review Focus.
- [ ] **Step 3: Navegador, teléfono (375×812):** orden Cliente → Qué se atiende → Servicios → Falla → Cómo llega → Recepción, barra de abajo visible y sin tapar las fotos.
- [ ] **Step 4:** crear una orden de prueba en la demo, comprobar que se guardó igual que antes (servicios, chequeos con nota, recibo), y borrarla.
- [ ] **Step 5:** capturas de pantalla ancha y teléfono para Louis; subir la rama y abrir el PR (sin fusionar: lo fusiona Louis).
