# Taller (módulo de servicios rehecho) — diseño

**Fecha:** 2026-11-19 · **Pedido por:** Louis · **Primer cliente:** DelmasTechnology Principal (Pujols Group), taller de reparación de teléfonos.

## Por qué

El módulo "Servicios/Reparaciones" existía pero nadie lo usaba: 0 órdenes en producción.
Los negocios de servicio reales (Michelle Auto Service, Delmas, Anadsll) lo tenían apagado.
Problemas de fondo: el "cobro" solo marcaba la orden como pagada (sin venta, NCF, caja ni
reportes), cancelar no devolvía piezas, la orden caía en la sucursal por defecto del perfil,
la mano de obra era fija y no había historial ni forma de cambiar de técnico.

Delmas quiere un taller de verdad, y Louis quiere que el mismo módulo sirva para otros talleres
(mecánica, electrónica…).

## Lo que decidió Louis

- **Inventario del taller = ubicación dentro de la sucursal** (opción A). Las piezas son
  artículos normales de la sucursal con la ubicación "Taller"; el caso solo ofrece piezas de la
  ubicación de repuestos configurada. Nada de sucursal aparte ni stock por ubicación.
- Los **técnicos entran con su usuario** y ven lo suyo. La caja ingresa los casos desde el
  módulo ("Nuevo ingreso") y explica la falla.
- **Lista de chequeos de llegada configurable** por el administrador (Prende, Suena, Rayones,
  Faltan botones, Faltan teclas…): poner, quitar y ordenar.
- Registrar **quién lo trajo, quién lo recibió, quién lo atiende (y las transferencias), quién
  lo entregó y quién lo retiró**.
- **Transferir el caso** a otro técnico.
- **Reparación rápida**: el cliente llega con el diagnóstico hecho ("cámbiame la pantalla") y se
  le atiende sin tanta vuelta.
- El cliente ve el estado por un **enlace** como el de la factura (entrega 2).
- **Reportes del taller de todo tipo** (entrega 3).
- Que **encaje para otros talleres**.
- Nombre del módulo: **Taller**.
- "Ve iniciando de a duro, confío en ti": el resto de las decisiones son mías y están marcadas
  abajo para que las revise.

## Entregas

1. **Base del taller** (este documento la detalla).
2. Seguimiento del cliente: enlace público por la función `c` y avisos por WhatsApp/correo.
3. Reportes del taller.
4. Garantías enlazadas a la venta original, plantillas por rubro, fotos al ingresar, anticipos.

## Entrega 1 — qué hace

### Pantallas

- **Taller** (`/services`): lista de casos con búsqueda (número, cliente, teléfono, equipo,
  IMEI/serie), filtros por estado y técnico, y pestañas *Activos · Listos · Entregados · Todos*.
  Botones **Nuevo ingreso** y **Reparación rápida**. Un técnico sin "ver todos" ve sus casos y
  la bandeja de *sin asignar*.
- **Nuevo ingreso** (`/services/nuevo`): cliente, quién lo trae (si no es el cliente), tipo de
  equipo y sus datos (marca, modelo, serie/IMEI, clave/patrón y los campos propios del tipo),
  falla reportada, chequeos de llegada del tipo de equipo, accesorios que deja, presupuesto
  aproximado, fecha prometida y técnico. Al guardar imprime el **recibo de recepción**.
- **Reparación rápida** (`/services/nuevo?modo=rapida`): cliente (consumidor final por
  defecto), equipo, servicio del catálogo y pieza de la ubicación del taller, solo los chequeos
  marcados "obligatorio en rápida", técnico. Entra directo en *En reparación*. Botones **Cobrar
  ahora** (abre el POS con el caso) o **Cobrar al entregar**.
- **Caso** (`/services/caso?id=…`): cabecera con estado y acciones, ficha del equipo, chequeos,
  líneas (mano de obra del catálogo + piezas), totales, diagnóstico, historial con notas
  (internas o visibles para el cliente), y acciones: cambiar estado, pasar a otro técnico,
  tomar el caso, cobrar (POS), entregar, reimprimir recibo.
- **Configuración del taller** (`/service-types`): pestañas *Tipos de equipo · Chequeos ·
  Catálogo de servicios · Técnicos · General* (ubicación de repuestos, condiciones del recibo,
  garantía por defecto).

### Estados (fijos, con texto para el cliente) — decisión mía

| Clave | Interno | Lo que verá el cliente (entrega 2) |
|---|---|---|
| `received` | Recibido | Recibimos tu equipo |
| `diagnosing` | En diagnóstico | Lo estamos revisando |
| `awaiting_approval` | Esperando aprobación | Te enviamos el presupuesto |
| `awaiting_parts` | Esperando pieza | Pedimos la pieza para tu equipo |
| `in_repair` | En reparación | Lo estamos reparando |
| `ready` | Listo para retirar | ¡Ya está listo! |
| `not_repaired` | No se pudo reparar | No se pudo reparar; pasa a retirarlo |
| `delivered` | Entregado | Entregado |
| `cancelled` | Cancelado | Cancelado |

Se pasa libremente entre los activos. `delivered` solo por la acción **Entregar**; `cancelled`
devuelve las piezas al inventario (confirmando antes).

### Cobro — decisión mía (la pieza delicada)

El caso se cobra **en el POS**, igual que una cotización: "Cobrar" abre un carrito con las
líneas del caso y el cajero cobra como siempre (forma de pago, NCF/e-CF, caja, vendedor,
recibo). Así el taller entra en caja, reportes, 607, comisiones y e-CF sin duplicar nada.

- **Mano de obra = producto de servicio.** Cada servicio del catálogo crea (y mantiene) un
  artículo de la sucursal con `tracks_stock = false` y `es_servicio = true`. En el e-CF sale
  como servicio sin tocar `ecf-emitir`, y lleva su ITBIS. También se puede vender suelto en el
  POS.
- **Piezas**: se descuentan del inventario **cuando se agregan al caso** (el técnico las
  usa antes del cobro). En la venta van como líneas de producto con `service_item_id`, y el
  trigger de stock **no** las vuelve a descontar.
- `create_sale_with_items` acepta `service_id` en la venta y `service_item_id` en cada línea;
  valida que la línea sea de ese caso, con el mismo producto y cantidad, y marca el caso como
  cobrado en la misma transacción (si ya estaba cobrado, falla).
- `annul_sale` no repone el stock de las líneas del taller (la pieza sigue en el equipo) y deja
  el caso otra vez *por cobrar*.
- En el carrito, las líneas del caso no cambian de cantidad ni se fusionan con líneas sueltas
  del mismo artículo.
- Un caso con total 0 (garantía, no reparado sin costo) se entrega sin pasar por el POS.

### Técnicos y permisos — decisión mía

- **Técnicos** = usuarios marcados en *Configuración → Técnicos* (por sucursal). Solo ellos
  aparecen para asignar.
- Permisos (grilla de Roles):
  - `services` (Taller): ver / crear (ingresar) / editar (estados, líneas, transferir) /
    eliminar (cancelar).
  - `services-all` (nuevo, solo "ver"): **ver todos los casos**. Sin él, el usuario ve los
    casos que tiene asignados y los sin asignar. Se aplica en la **RLS**, no solo en pantalla.
  - `service-types` pasa a llamarse *Configuración del Taller*.
- El rol de cajero por defecto suma `services-all: view` y `services: edit` para poder
  cobrar y entregar.

### Para otros talleres — decisión mía

- **Tipos de equipo** por empresa: nombre, etiqueta del número de serie ("IMEI", "Placa",
  "Serie"), si pide clave/patrón, y campos extra (texto o número) como "Kilometraje".
- **Chequeos** por tipo de equipo (o para todos), cada uno contestado *Sí / No / No se pudo
  probar* + nota, con "obligatorio" y "obligatorio en rápida". El caso guarda una **copia** de
  lo contestado: quitar un chequeo no cambia los casos viejos.
- **Catálogo de servicios** por sucursal: nombre, precio de mano de obra, ITBIS, tipo de
  equipo (opcional), categoría de pieza sugerida (opcional), días de garantía.
- Si un tipo de equipo no existe todavía, el taller crea "Teléfono" con chequeos de ejemplo la
  primera vez que se abre la configuración (decisión mía, se puede borrar).

### Modelo de datos (migración `20261119120000_taller_base.sql`)

- `services` (el caso) gana: `number` (consecutivo por empresa, con advisory lock),
  `equipment_type_id`, `equipment_brand`, `equipment_model`, `equipment_serial`,
  `equipment_password`, `equipment_details jsonb`, `accessories text`, `intake_checklist
  jsonb`, `diagnosis`, `brought_by_name`, `brought_by_phone`, `received_by`, `received_by_name`,
  `estimate`, `promised_at`, `is_quick`, `status_changed_at`, `ready_at`, `delivered_at`,
  `delivered_by`, `delivered_by_name`, `picked_up_by_name`, `outcome` (`repaired` /
  `not_repaired`), `sale_id`. `service_type_id` pasa a opcional. `status` con los 9 valores
  (la tabla está vacía en producción). `description` = falla reportada.
- `service_items` gana `kind` (`labor` / `part`) y `service_type_id`. El trigger reparte los
  importes en `labor_price` / `parts_total` y bloquea cambios en casos cobrados o cerrados.
- `service_types` (catálogo) gana `branch_id`, `product_id`, `equipment_type_id`,
  `part_category_id`, `warranty_days`, `is_active`, `position`.
- Nuevas: `service_equipment_types`, `service_checklist_items`, `service_technicians`,
  `service_events` (historial) y `taller_settings` (ubicación de repuestos por sucursal,
  condiciones, garantía por defecto). `service_technicians` lleva **índice** único
  `(branch_id, profile_id)`, no restricción: con restricción PostgREST la tomaría por
  tabla puente entre branches y profiles (el 300 del incidente de `branch_sharing`).
- `taller_asignar` es SECURITY DEFINER (migración `20261119140000`): un técnico sin
  "ver todos" que pasa su caso a otro deja de verlo, y Postgres rechaza un UPDATE cuya
  fila nueva no pasa la política de SELECT. La función comprueba antes lo mismo que la
  RLS.
- Historial automático: un trigger en `services` registra creación, cambios de estado,
  asignaciones, cobro y entrega; la nota opcional llega por `set_config('taller.nota', …)`
  desde las RPC `taller_cambiar_estado`, `taller_asignar` y `taller_entregar`.
- `sales.service_id`, `sale_items.service_item_id`; cambios en `create_sale_with_items`,
  `decrement_product_stock_for_sale_item` y `annul_sale` partiendo de la definición viva (huellas
  md5 comprobadas antes de aplicar).

## Entregas 2 a 4 (hechas el mismo día: "termina todo el módulo")

### 2. Seguimiento del cliente
- Cada caso tiene `tracking_code` (10 caracteres del alfabeto de los enlaces de
  factura, 56^10). La página pública es **`app.sellalles.com/seguimiento?c=…`**
  (grupo `(portal)`, sin sesión), que llama a `taller_seguimiento_publico(code)`
  (SECURITY DEFINER, abierta a `anon` a propósito). Muestra negocio, caso, equipo,
  estado con el texto para el cliente, pasos, avance con las notas marcadas como
  visibles, total si está listo y por cobrar, garantía, y botones de llamar y
  WhatsApp. Nada de IMEI, clave, notas internas ni nombres del personal.
- **Decisión mía:** no va por la función `c` (`sellalles.com/<empresa>/c/<código>`)
  porque Supabase sirve como `text/plain` todo HTML que devuelve una Edge Function:
  la página saldría como código. (Esto ya pasa hoy con las páginas de error de los
  enlaces de factura: queda anotado como seguimiento aparte.)
- En el caso: botón **Enlace** (copia) y **Avisar** (WhatsApp con el estado y el
  enlace). El recibo de recepción imprime un **QR** con el enlace.
- Avisos automáticos por WhatsApp quedan fuera: necesitan la API de pago de Meta.

### 3. Reportes (`/reports/taller`)
Período y sucursal como el resto de reportes. Indicadores (ingresados, entregados,
en el taller, listos sin retirar, cobrado, mano de obra, piezas con costo y ganancia,
tiempo de reparación y de entrega, no reparados, rápidas, garantías), por técnico
(asignados, terminados, en curso, tiempo promedio, mano de obra, reingresos por
garantía), casos abiertos por estado, tiempo en cada etapa, servicios más pedidos,
piezas más usadas, equipos más reparados y listos sin retirar (exportables a CSV).
La lógica está en `src/lib/taller-reportes.ts`, con pruebas.

### 4. Extras
- **Garantías:** `warranty_of_service_id` / `warranty_sale_id` y `warranty_until`. Al
  entregar reparado se fija hasta cuándo cubre (días del servicio del catálogo que
  más da, o los del taller). "Reingreso por garantía" desde el caso entregado, y
  "Garantía al taller" desde el detalle de una venta. Lo que se agrega a un caso de
  garantía entra en RD$0 (se puede cambiar). Los reingresos cuentan contra el
  técnico original en el reporte.
- **Plantillas por rubro:** celulares y tablets, computadoras, electrónica y
  electrodomésticos, mecánica (con kilometraje, año, color, combustible). Desde
  Configuración → Tipos de equipo, y al crear una empresa del rubro "Reparación".
- **Fotos del equipo:** bucket privado `taller` (`<empresa>/<caso>/<uuid>`), máximo
  12 por caso, comprimidas en el navegador; al ingresar o desde el caso.
- **Anticipos: no se hicieron.** Tocan caja y cobro (un anticipo en efectivo hoy y
  la venta completa mañana contarían doble en la caja), y hay que decidir cómo se
  registran ante la DGII. Queda para cuando Louis decida.

## Fuera de alcance

Anticipos, avisos automáticos por WhatsApp/correo, estados configurables por empresa,
citas/agenda.

## Riesgos

- Tocar `create_sale_with_items` y `annul_sale` en la empresa con más ventas. Se cambian solo
  las líneas necesarias sobre la definición viva y se prueba con `begin … rollback`.
- La RLS de visibilidad por técnico: un error dejaría a alguien sin ver sus casos. Se prueba con
  usuarios de cada tipo.
