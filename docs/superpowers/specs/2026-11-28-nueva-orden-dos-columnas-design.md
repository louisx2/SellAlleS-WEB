# Nueva orden en dos columnas — diseño corto

Fecha: 2026-11-28 · Pantalla: `/services/nuevo` (Nueva orden y Atender ahora)

## Por qué

Louis siente que en Servicios hay que bajar mucho. La que más pesa es Nueva
orden: una sola columna angosta (`max-w-3xl`) con 9 tarjetas una debajo de otra,
≈ 2,800 px en un caso de reparación (unas 5 pantallas de laptop), y el botón de
crear queda al final. La lista y la orden abierta se dejan para después.

## Metas

- Que una orden típica quepa en menos de 2 pantallas de laptop (1366×768).
- Que el total y el botón Crear / Cobrar estén siempre a la vista.
- Mismo orden de llenado que hoy: primero quién y qué, luego los servicios.

**No metas:** no cambia qué se guarda, ni las validaciones, ni los permisos, ni
la base de datos. Solo distribución y presentación.

**Anti-metas (fallaría aunque funcione):** que un chequeo obligatorio quede
escondido y el error salga al final; que en el teléfono el botón quede en el
medio del formulario; que el panel fijo tape campos o no deje llegar a su parte
de abajo.

## Enfoques considerados

1. **Dos columnas con panel fijo (elegido por Louis).** Izquierda: lo que se
   recibe. Derecha: servicios, total y botón, que no se mueven al bajar.
   Menos de la mitad de scroll sin agregar clics.
2. **Por pasos** (cliente y ficha → servicios → recepción). Menos scroll, pero
   más clics en el mostrador. Descartado.
3. **Secciones plegables.** Pueden esconder chequeos obligatorios. Descartado.

## Diseño

**Pantalla ancha (`lg` en adelante)**, ancho máximo ≈ `max-w-6xl`:

- Encabezado en una línea: «← Servicios», título y el botón para cambiar entre
  Nueva orden y Atender ahora. El aviso de garantía sigue debajo, a lo ancho.
- **Columna izquierda** (la ancha), en este orden:
  1. Cliente en una fila (nombre y teléfono, Cambiar / Quitar), sin título de
     tarjeta. «Lo trae otra persona» y sus campos siguen igual debajo.
  2. Qué se atiende: las opciones «Nada», cada ficha guardada del cliente y
     «+ Nueva ficha» pasan de tarjetas con radio a **una fila de botones**
     (chips). Una ficha con notas lleva una marca pequeña. Debajo, los campos
     de la ficha en dos columnas, como hoy, y la clave/patrón.
  3. Falla reportada / Notas.
  4. Cómo llega: **chequeos en dos columnas**. Cada uno: nombre, Sí / No / No
     probado. La nota sale sola al marcar «No», o al tocar un ícono de nota; si
     ya tiene nota, se ve. Los obligatorios llevan el * como hoy.
  5. Recepción y fotos **en una sola tarjeta**: lo que deja (chips + otro),
     presupuesto y prometido para, y el botón «Agregar fotos».
- **Columna derecha** (≈ 22–24 rem), fija al bajar (`sticky` bajo el encabezado
  de la app):
  1. Servicios: las líneas con precio y quién lo hace, y «+ Agregar servicio».
  2. Lo atiende.
  3. Pieza (solo en Atender ahora con ficha de reparación).
  4. A domicilio (y dirección) y «El cliente espera».
  5. Total, la nota del ITBIS y los botones (Cancelar · Crear orden, o Cobrar al
     final · Cobrar ahora).
  Si el panel no cabe en la pantalla, la parte de servicios se desplaza dentro
  del panel y el total con los botones quedan siempre visibles abajo.

**Teléfono y tableta (menos de `lg`):** una columna, en este orden: Cliente →
Qué se atiende → Servicios (con lo atiende, pieza, domicilio) → Falla → Cómo
llega → Recepción y fotos. El total y los botones van en una barra pegada al
borde de abajo de la pantalla.

## Lo que queda a quien lo construya

- Las clases exactas, el alto del panel y el `top` del sticky (el encabezado de
  la app mide 56/64 px, más 28 px si hay aviso arriba).
- Si los chips de ficha y los chequeos compactos viven en sus componentes
  (`ficha-picker.tsx`, `checklist-form.tsx`) o con una variante. Ojo: el
  formulario de chequeos y el selector de ficha solo se usan en Nueva orden
  (verificarlo antes de cambiarlos).
- Mantener los textos, ayudas y placeholders actuales salvo donde el diseño los
  cambie.
