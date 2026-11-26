# Motopréstamos (módulo por rubro) — diseño

**Fecha:** 2026-11-23 · **Pedido por:** Louis · **Primer prospecto:** un motopréstamos de Azua
(todavía no se ha hablado con él).

## Por qué

Louis va a ofertar SellAlleS a un motopréstamos. Al evaluarlo, SellAlleS ya hacía lo central
(ventas financiadas, préstamos, mora configurable, refinanciación, cobros por cobrador, portal
del cliente), pero le faltaban las piezas propias de ese negocio: la ficha de la moto, la
matrícula retenida, la recuperación, el contrato, la cobranza en la calle y los reportes de
todo eso. Además, el motor de cuotas topa en 60 cuotas, no cobra a diario y el dinero prestado
no sale de la caja.

Louis quiere que **SellAlleS sea modular según el rubro**: al activar un módulo, la empresa
recibe todas las funciones de su negocio con sus reportes. Motopréstamos es el segundo módulo
de rubro después de Taller y debe servirle a cualquier motopréstamos de RD, no solo al de Azua.

## Lo que decidió Louis

- **Módulo aparte** ("Motopréstamos"), que al activarse trae todas sus funciones y reportes.
- Sirve **para los dos negocios**: vender motos a cuotas y prestar dinero con la moto del
  cliente en garantía.
- Lo que no es de motos (60 cuotas, cobro diario, desembolso por caja) **se arregla en el motor
  común**, para todas las empresas; el módulo no tiene un motor de cuotas propio.
- **Cobranza en la calle con el teléfono y cuadre del cobrador**: cada cobrador ve su ruta, cobra
  desde el teléfono, el cliente recibe el recibo por WhatsApp, y lo cobrado queda a nombre del
  cobrador hasta que lo entrega en la oficina y se cuadra.
- "Esmérate, planifica bien": el resto de las decisiones son mías y están marcadas
  **(decisión mía)** para que las revise.

## Objetivos

- Que un motopréstamos opere entero en SellAlleS: inventario de motos con chasis, venta a cuotas,
  préstamo con garantía, matrículas en custodia, cobranza diaria o semanal en la calle, cuadre de
  cobradores, recuperación de motos y sus reportes.
- Que el módulo se encienda y se apague por empresa como los demás, y que el rubro
  "Motopréstamos" lo traiga encendido al registrarse.
- Que el motor común (cuotas, mora, caja) mejore para todos sin cambiar nada a quien no use lo
  nuevo.

## Lo que no se hace (por ahora)

- **Trabajar sin internet** en el teléfono del cobrador. La ruta necesita conexión.
- **WhatsApp automático** (API de Meta, de pago). Los avisos y recibos salen con un botón que
  abre WhatsApp con el mensaje ya escrito, igual que en Taller.
- **GPS** de las motos o del cobrador.
- **Registro legal** del contrato (Juzgado de Paz, registro de garantías mobiliarias de la Ley
  45-20). El sistema imprime el contrato; registrarlo lo hace el negocio.
- **Interés sobre saldo** (amortización francesa). Se sigue con el interés fijo de hoy, que es
  como cobran los motopréstamos.
- Feriados en el calendario de cuotas, consulta a buró (DataCrédito) y cobro con tarjeta en la
  calle.

## Lo que haría que fracase aunque funcione

- Que cambie algo para las empresas que ya financian o prestan (Pujols, Delmas): sus planes,
  su mora, su caja.
- Que la caja de la sucursal deje de cuadrar, en especial con los abonos que trae el cobrador.
- Que un cobrador pueda ver o cobrar cuentas que no le tocan sin permiso.
- Que el módulo duplique el motor de cuotas y los dos se vayan separando.
- Que el stock de un artículo-moto no coincida con las motos que hay de verdad.

## Restricciones

- Las migraciones las aplico yo con `apply_migration`, después de probarlas con
  `begin … rollback` y comprobar las huellas md5 de lo vivo.
- `create_sale_with_items`, `annul_sale`, `close_caja_session` y las RPC de abonos se cambian
  **partiendo de la definición viva** (`pg_get_functiondef`), nunca desde el repo.
- Funciones nuevas: `revoke execute … from anon` salvo las públicas a propósito; RLS por empresa
  y sucursal; casts `::text` en los enums de `sales`.
- Grants explícitos en cada migración para todo lo nuevo (`authenticated`, `service_role`), como
  pide `SUPABASE.md` desde el 30-oct-2026.
- Front estático (`output: 'export'`): rutas con `?id=`, nada de segmentos dinámicos.
- Ojo con los embeds ambiguos de PostgREST: tablas con FK a `companies` y `branches` a la vez
  (usar índices únicos, no restricciones, en tablas puente, como `service_technicians`).
- Las pantallas del cobrador se usan en el teléfono: primero móvil.
- Se entrega por partes, cada una con su PR; la entrega 1 no depende del módulo.

## Enfoques considerados

1. **Módulo de rubro encima del motor existente, como Taller (elegido).** Tablas propias del
   módulo (vehículos, custodia, cobranza) enganchadas a las ventas y préstamos que ya existen,
   con ganchos en `create_sale_with_items`, `annul_sale` y la creación de préstamos. Las cuotas,
   la mora, la refinanciación, el portal, la caja y los reportes de cobros siguen siendo los de
   siempre.
2. **Motor de préstamos propio del módulo.** Más libertad, pero duplica cuotas, mora,
   refinanciación, caja, portal y reportes, que ya están probados con dinero real. Es justo lo
   que Louis no quiere: dos sistemas que se separan.
3. **Solo ajustes y textos sobre lo existente** (la moto en "Notas", categorías, un rol). Sale
   rápido, pero no da ficha de la moto, custodia, ruta ni cuadre: lo que hace vendible el módulo.

Para el dinero del cobrador se consideraron dos formas:

- **Una "caja del cobrador"** como sesión de caja aparte. Se descartó: hoy hay una sola caja
  abierta por sucursal y varias funciones (`has_open_caja`, `register_caja_movement`, el cierre)
  dan eso por hecho.
- **Abonos "en la calle" + entrega del cobrador (elegida).** El abono se registra a nombre del
  cobrador y queda fuera del cierre de caja hasta que lo entrega; la entrega mete el total a la
  caja como un movimiento de entrada. Solo cambia un filtro del cierre y agrega la entrega.

## Entregas

1. **Motor común** — cobro diario, más cuotas, desembolso por caja, antigüedad de cartera.
   Para todas las empresas. No necesita el módulo.
2. **Módulo base** — catálogo y rubro, vehículos con chasis, venta por chasis en el POS,
   préstamo con garantía, matrículas en custodia, garantes y referencias, contrato, sus
   reportes.
3. **Cobranza en la calle** — cobradores, asignación de cartera, ruta del día, cobro y visitas
   desde el teléfono, recibo y avisos por WhatsApp, cuadre del cobrador, sus reportes.
4. **Recuperación** — recuperar la moto vendida y ejecutar la garantía del préstamo, con su
   reporte.

Cada entrega es un PR con su migración. Orden: 1 → 2 → 3 → 4 **(decisión mía)**: 2 y 3 son lo
que se ve en la demo; la recuperación hace falta cuando el negocio ya lleva meses operando.

---

## Entrega 1 — Motor común

> **Estado (2026-11-23):** fusionada (PR #78 y #80) y desplegada. Migraciones
> `20261124120000`, `20261124130000` y `20261124140000` (correcciones de la revisión: primer
> pago en domingo y sucursal de otra empresa) **aplicadas en producción**. Cambios respecto a lo de abajo: "Al día" se
> llama "Por vencer" y cada cuota va al tramo de su propio atraso; el ticket y el plan
> térmico se recortan solo en papel; las tablas arrancan en la próxima cuota a cobrar.

### Cobro diario

- Dos frecuencias nuevas en préstamos y financiamiento, al lado de semanal, quincenal y mensual:
  **`daily` "Diario (lun–sáb)"** y **`daily_all` "Diario (todos los días)"** **(decisión mía)**.
  Se eligen al crear el plan como cualquier frecuencia. Al ir en la frecuencia, los domingos
  quedan **congelados en el plan** sin columnas ni ajustes nuevos, y todas las funciones que ya
  reciben la frecuencia (fechas, meses, mora, refinanciación, reprogramación) la entienden sin
  cambiar de firma. (Primero había pensado un ajuste de empresa "incluye domingos"; se cambió
  por esto al planificar: hace lo mismo con mucho menos.)
- **Fechas:** en `daily`, la cuota *k* cae *k* días después del inicio saltando los domingos;
  en `daily_all`, *k* días corridos. Primera cuota elegida: igual que hoy, contando desde ella.
- **Interés mensual prorrateado:** meses = n / 26 en `daily` y n / 30 en `daily_all`
  **(decisión mía)**: así 26 cuotas de lunes a sábado son un mes de interés. En modo "por cuota"
  no cambia nada.
- **Mora:** el período de un plan diario es 1 día (`late_fee_period_days = 1` para las dos).
- **Recordatorios por correo:** los planes diarios no reciben el aviso de "tu cuota vence en 3
  días" (sería un correo diario); se cobran por la ruta **(decisión mía)**.
- Dónde toca (todo desde la definición viva): `loans_payment_frequency_check`,
  `validate_financing_params`, `trg_before_loan_checks`, `trg_after_loan_effects`,
  `financing_due_date`, `financing_schedule_due_date`, `build_financing_schedule`,
  `financing_months`, `financing_plan`, `late_fee_period_days`, `before_sale_credit_checks`,
  `amend_sale_financing`, `refinance_financing`, `refinance_loan`, `refinance_quote_data`,
  `reschedule_financing_installments`, `pending_due_reminders`, `resolve_portal_customers`.
  En el front: `lib/frequency.ts`, `lib/late-fee.ts` y todos los selectores y etiquetas de
  frecuencia (POS, préstamo, enmienda, refinanciación, ajustes de empresa y sucursal, portal,
  tickets, reportes).

### Más cuotas

- El tope pasa de 60 cuotas a **312 cuotas y 60 meses de duración**, lo que se cumpla primero
  **(decisión mía)**: mensual 60, quincenal 120, semanal 240, diario 312 (un año de lunes a
  sábado).
- Una sola función en la base (`max_installments(freq)`) y su espejo en `lib/frequency.ts`; reemplaza los cuatro `MAX_INSTALLMENTS = 60` del front y los topes de
  `validate_financing_params` y `trg_before_loan_checks`.
- **Planes largos en papel (decisión mía):** el ticket térmico del préstamo y del financiamiento
  imprime el resumen y las próximas 12 cuotas; el plan completo va en el PDF tamaño carta que ya
  se comparte por WhatsApp. En pantalla, la tabla de cuotas se pagina.

### Desembolso por caja

- El préstamo gana `disbursement_method` (`cash` / `transfer`) y `disbursement_reference`.
- Si es en efectivo y la sucursal usa caja: exige caja abierta y crea un movimiento de **salida**
  en la caja ("Desembolso de préstamo: <cliente>") en la misma transacción. Lo hacen los
  triggers del préstamo (`trg_before_loan_checks` y `trg_after_loan_effects`), así que vale
  para cualquier forma de crearlo: el diálogo y la refinanciación. Por transferencia solo queda
  registrado.
- `caja_movements` gana `loan_id` (nulo) para enlazar el movimiento con su préstamo.
- **Refinanciación con dinero adicional:** sale de la caja igual que el desembolso. Esto **cambia
  lo que Louis decidió el 2026-10-15** ("el dinero adicional no pasa por caja, igual que los
  desembolsos hoy"): como ahora los desembolsos sí pasan, lo dejo igual **(decisión mía, a
  confirmar)**.
- Los préstamos viejos quedan sin método ("sin registro"); no se rellenan. Hoy no hay forma de
  cancelar un préstamo desde la app, así que no hay devolución a caja que resolver.

### Antigüedad de cartera (reporte para todos)

- `/reports/antiguedad`: préstamos, financiamientos y crédito simple, por cliente y en total,
  en tramos **Al día · 1–7 · 8–15 · 16–30 · 31–60 · 61–90 · +90 días (decisión mía)**: tramos
  cortos al principio porque estos negocios cobran por semana o por día. Exportable a CSV.
- Lo pidió Louis el 2026-08-30 para todos; el módulo lo muestra también en su sección de
  reportes.

---

## Entrega 2 — Módulo base

> Se construye en tres partes que se fusionan por separado: **2A** vehículos e inventario por
> chasis (módulo, ficha, venta y anulación por chasis, reportes de vehículos); **2B** garantía
> en préstamos, matrículas en custodia y datos del cliente; **2C** contrato, configuración
> general, fotos y portal. El stock de un artículo-vehículo es derivado: lo recalcula la base
> con las unidades disponibles y bloquea cualquier otro cambio (así quedan fuera compras,
> transferencias y ajustes manuales sin tocarlos uno por uno).
>
> **Estado 2A (2026-11-24):** construida en la rama `claude/motoprestamos-entrega-2`.
> Migraciones `20261124150000_motos_vehiculos`, `20261124160000_motos_venta_por_chasis` y
> `20261124170000_motos_ajustes_revision` (arreglos de la revisión final) **aplicadas en producción**, con las suites `motos_vehiculos.sql` y `motos_venta.sql`
> pasando contra lo aplicado. Probada en pantalla en la demo (módulo, artículo-vehículo,
> ingreso, chasis repetido, ficha, edición, baja, tipos, selector del POS, avisos de
> cantidad y de cliente, reporte) sin cobrar: el cobro y la anulación por chasis los cubre
> la suite. Front sin fusionar. Diferencias con lo de abajo: el cajero ve las unidades con
> `pos:view` para elegir el chasis; el selector se abre desde el carrito, así que sale por
> tarjeta, búsqueda o código igual.
>
> **Estado 2B (2026-11-24):** construida en la rama `claude/motoprestamos-entrega-2b` (sobre
> 2A). Migraciones `20261124180000_motos_datos_del_cliente` y
> `20261124190000_motos_garantia_y_matriculas` **aplicadas en producción**, con las suites
> `motos_clientes.sql` y `motos_garantia.sql` pasando contra lo aplicado. Diferencias con lo de
> abajo: el enlace préstamo ↔ moto es `vehicles.loan_id` (como `sale_id`), no la tabla
> `loan_collaterals` (el historial queda en `vehicle_events.loan_id`); el préstamo sin
> garantía sigue por el insert de siempre y la RPC `motos_crear_prestamo` solo se usa con
> garantía; saldar, anular el abono y refinanciar los resuelven triggers sobre `loans` y
> `sales` (no se tocaron las funciones de abonos ni de refinanciación); la venta de una moto
> que después se dio en garantía ya no se puede anular. Pasan a 2C: exigir garante, custodia
> por defecto, fotos de la cédula, contrato y portal.
>
> **Estado 2C (2026-11-24):** construida en la rama `claude/motoprestamos-entrega-2c` (sobre
> 2B). Migraciones `20261124200000_motos_ajustes_y_fotos` y `20261124210000_motos_reglas_y_portal`
> **aplicadas en producción**, con `motos_ajustes.sql` pasando contra lo aplicado. Diferencias con
> lo de abajo: los ajustes son por empresa (`motos_settings`; sin fila = lo de 2A/2B); las
> plantillas vacías usan el texto base (no se siembran); con «custodia en contado» la matrícula
> queda «lista para entregar»; exigir garante aplica a todo préstamo nuevo (no a refinanciaciones)
> y a la venta de una moto a plazo, solo con el módulo encendido; las fotos de la cédula viven en
> el «Expediente del cliente»; el texto de WhatsApp pasa a la entrega 3.

### Catálogo, rubro y menú

- Módulo `motoprestamos`, "Motopréstamos", apagado por defecto. Necesita Préstamos y
  Financiamiento: al encenderlo desde el panel del súper admin se enciende también Préstamos, y
  el panel avisa si Caja está apagada **(decisión mía)**.
- Rubro "Motopréstamos" en `business-types.ts`: enciende Préstamos, Motopréstamos, Caja y Portal
  de Clientes; siembra el tipo de vehículo "Motor" y las plantillas de contrato.
- Menú "Motopréstamos": **Vehículos**, **Matrículas**, **Cobranza** (entrega 3) y
  **Configuración**. Rutas bajo `/motos` en `ROUTE_MODULE`.
- Permisos (grilla de Roles): `motos` (ver / crear / editar / eliminar vehículos) y
  `motos-config`.

### Vehículos (la ficha)

- **Tipos de vehículo** por empresa (Motor, Pasola, Carro…), como los tipos de equipo del Taller:
  nombre y campos extra (texto o número). Los campos fijos son: marca, modelo, año, color,
  chasis, número de motor, placa, número de matrícula y cilindraje **(decisión mía)**. El chasis
  es único por empresa entre los vehículos activos.
- Cada vehículo tiene:
  - **Origen:** `inventario` (es del negocio) o `garantia` (es del cliente).
  - **Estado:** `disponible` (en inventario) · `vendido` · `en_garantia` · `recuperado` (en el
    patio del negocio) · `liberado` (deuda saldada) · `baja`.
  - **Matrícula:** `en_custodia` · `lista_para_entregar` · `entregada` · `no_aplica`, con dónde
    se guarda (gaveta o archivo, texto libre) y desde cuándo.
  - Condición (nuevo o usado), costo, precio propio (opcional), cliente, venta o préstamo
    enlazado, fotos (bucket privado como el del Taller, hasta 12) y notas.
- **Historial** (`vehicle_events`): ingreso, venta, garantía, cambios de estado y de matrícula,
  entrega, recuperación; con usuario y fecha. Lo llena un trigger y las RPC, como
  `service_events`.
- Pantallas: **Vehículos** (`/motos`), lista con búsqueda por chasis, placa, cliente o modelo y
  pestañas por estado; **Ficha** (`/motos/ficha?id=`) con datos, fotos, cuenta enlazada con su
  saldo y atraso, matrícula, contrato e historial.

### Motos del negocio: inventario por chasis

- Artículo con la marca **"Es un vehículo (cada unidad con su chasis)"** (`products.is_vehicle`),
  visible en el diálogo de producto solo con el módulo encendido. El artículo es el modelo y el
  precio de lista; cada moto física cuelga de él.
- **Ingresar unidad** (desde el artículo o desde Vehículos): llena la ficha y suma 1 al stock en
  la misma transacción. El stock de un artículo-vehículo **solo lo mueven sus unidades**: el
  ajuste manual de stock se bloquea para esos artículos **(decisión mía)**.
- **Compras a Inventario y Transferencias entre sucursales:** en esta versión no admiten
  artículos-vehículo (avisan "ingresa las motos desde Vehículos"), para no crear ni mover stock
  sin chasis. Tampoco llevan presentaciones (paquete/caja) **(decisión mía)**.
- La línea de la factura (y del e-CF) lleva en la descripción los datos de la unidad: "Honda CG
  150 · Chasis … · Motor … · 2025 · Roja" **(decisión mía)**: así se acostumbra facturar
  vehículos y la factura identifica cuál se vendió. Chasis y motor van antes que año y color
  porque el e-CF corta el nombre del artículo a 80 caracteres.
- **En el POS:** al agregar un artículo-vehículo se elige cuál unidad (chasis) de las
  disponibles; la línea va con cantidad 1 fija y toma el precio propio de la unidad si lo tiene.
  Vender un vehículo exige cliente **(decisión mía)**: hace falta saber de quién es.
- `create_sale_with_items` acepta `vehicle_id` por línea (`sale_items.vehicle_id`) y llama a un
  gancho `motos_vincular_venta(sale_id)`, como `taller_vincular_venta`. El gancho comprueba que la
  unidad esté disponible, sea de ese artículo, vaya con cantidad 1 y no se repita; la pasa a
  `vendido` con el cliente y la venta; pone en la línea **el costo de esa unidad** (cada moto
  cuesta distinto); y deja la matrícula en custodia si la venta es a crédito o financiada, o
  `no_aplica`/entregada si es de contado, según el ajuste del módulo.
- `annul_sale`: el stock vuelve como hoy y el gancho devuelve la unidad a `disponible`.
- Al saldar la venta financiada, la matrícula pasa a `lista_para_entregar`.

### Motos del cliente: préstamo con garantía

- En **Nuevo préstamo**, con el módulo encendido, aparece la sección **Garantía**: registrar el
  vehículo del cliente (la misma ficha, origen `garantia`) o elegir uno suyo ya registrado, y si
  la matrícula queda en custodia.
- Enlace préstamo ↔ vehículo en `loan_collaterals` (un préstamo puede tener más de una garantía;
  la pantalla de esta versión maneja una) **(decisión mía)**.
- El préstamo y su garantía se crean **en una sola transacción**, con una RPC nueva
  (`crear_prestamo`) en lugar del insert directo de hoy (el desembolso por caja ya va en los
  triggers del préstamo desde la entrega 1).
- **Refinanciación:** el préstamo nuevo hereda las garantías del viejo (lo hace
  `refinance_loan`).
- Al saldar el préstamo: vehículo `liberado` y matrícula `lista_para_entregar`.

### Matrículas en custodia

- Pantalla **Matrículas** (`/motos/matriculas`) con pestañas: *En custodia* (deuda activa, con
  saldo y atraso), *Listas para entregar* (deuda saldada) y *Entregadas*.
- **Entregar matrícula:** a quién (nombre y cédula de quien la retira), fecha y usuario; imprime
  una constancia de entrega. Solo se puede si la deuda está saldada; un administrador puede
  forzarla con motivo **(decisión mía)**.

### Datos del cliente para este negocio

- Con el módulo encendido, el cliente gana: apodo, lugar de trabajo o parada, **sector o zona**
  (la usa la cobranza), dirección de cobro con referencia, y fotos de la cédula (mismo bucket).
- **Garantes o fiadores** (`customer_guarantors`): nombre, cédula, teléfono, dirección,
  parentesco. **Referencias** (`customer_references`): nombre, teléfono, relación.
- Garantes y referencias van **por cliente**, no por operación **(decisión mía)**: el contrato
  imprime los garantes del cliente. Un ajuste del módulo puede exigir al menos un garante para
  financiar o prestar (apagado por defecto).
- La cédula sigue siendo el campo RNC/Cédula de hoy (el portal ya entra con él).

### Contrato

- Dos plantillas editables en Configuración: **Venta condicional** (moto vendida a cuotas) y
  **Préstamo con garantía**. Texto con marcadores: `{cliente.nombre}`, `{cliente.cedula}`,
  `{vehiculo.chasis}`, `{vehiculo.placa}`, `{monto}`, `{inicial}`, `{cuotas}`, `{frecuencia}`,
  `{cuota}`, `{tasa}`, `{plan}` (tabla de cuotas), `{garantes}`, `{empresa.*}`, `{fecha}`…
- Se imprime en tamaño carta desde la venta, el préstamo y la ficha del vehículo.
- Los textos por defecto son un modelo base con el aviso "revise este texto con su abogado"
  **(decisión mía)**: SellAlleS no da asesoría legal.

### Configuración del módulo (`/motos/config`)

Pestañas: *Tipos de vehículo · Contratos · General*. General tiene: matrícula en custodia por
defecto (venta financiada, venta de contado, préstamo), exigir garante, y el texto del mensaje de
WhatsApp de avisos y recibos (entrega 3).

### Portal del cliente

- En "Mi estado de cuenta", el préstamo o financiamiento muestra su vehículo (marca, modelo,
  placa) y si la matrícula está lista para retirar **(decisión mía)**.

### Reportes de la entrega 2

- **Cartera de vehículos:** cuántos hay por estado, valor del inventario a costo, saldo
  pendiente de los vendidos a cuotas y de los préstamos con garantía, al día y atrasados.
- **Matrículas:** en custodia, listas para entregar (y desde cuándo), entregadas en el período.
- **Ventas de vehículos:** por modelo, contado frente a financiado, inicial promedio, plazo
  promedio y frecuencia.

---

## Entrega 3 — Cobranza en la calle

> **Estado 3A (2026-11-24):** cobradores, cartera, ruta, cobro en la calle, visitas y cuadre,
> construida en la rama `claude/motoprestamos-entrega-3a` (sobre 2C). Migraciones
> `20261125120000_cobranza_base` y `20261125130000_cobranza_cobro_y_cuadre` **aplicadas en
> producción**, con `cobranza.sql` pasando contra lo aplicado. Diferencias con lo de abajo:
> la columna es `collector_id` (no `collected_by`); el cobro lleva un identificador para que
> repetirlo sin señal no cobre dos veces; la entrega rechaza si lo esperado cambió mientras el
> cajero contaba; un cobrador con abonos o entregas no se puede borrar (se desmarca); el rol
> Cobrador ve las motos de su sucursal (solo lectura, para la placa en la ruta); solo cobra
> desde la ruta quien está marcado como cobrador en la sucursal (un admin con «ver todas las
> rutas» las ve, pero cobra desde la oficina). Quedan para 3B: recibo y avisos por WhatsApp e
> imprimir al cobrar, y los reportes de cobranza.
>
> **Estado 3B (2026-11-24):** recibo del abono, avisos por WhatsApp y reportes de cobranza,
> construida en la rama `claude/motoprestamos-entrega-3b` (sobre 3A). Migración
> `20261125140000_cobranza_recibos_y_reportes` **aplicada en producción** y `receipt-link` v10
> desplegada (sin `abono` hace lo mismo que antes). Diferencias con lo de abajo: el recibo es el
> mismo recibo de abono de la oficina (imprimir, o PDF con enlace corto de 15 días); un cobro
> repetido por falta de señal no trae recibo; anular un abono borra el enlace de su recibo; las
> plantillas (aviso y recibo) viven en `motos_settings` y vacías usan el texto base; «enviado
> hoy» en Avisos se guarda en el teléfono; el reporte de cobranza lo calcula la base
> (`cobranza_reporte`), con por cobrar según la cartera actual y una promesa cumplida solo por
> un abono hecho después de la visita; quien tiene Reportes ve entregas y cartera.

### Cobradores y cartera

- **Cobradores** = usuarios marcados como cobradores por sucursal (como los técnicos del Taller,
  `collectors` con índice único `(branch_id, profile_id)`).
- Al encender el módulo se crea el rol **Cobrador**: ruta (ver y cobrar), clientes (ver), sin
  ventas, préstamos ni reportes **(decisión mía)**.
- **Asignación por cliente y sucursal** (`collection_assignments`, único `(branch_id,
  customer_id)`): el cobrador cobra todo lo de ese cliente en esa sucursal (préstamos,
  financiamientos y crédito), con orden de visita. Un cliente con cuentas en dos sucursales
  puede tener un cobrador en cada una. Pantalla **Asignar cartera**
  (`/motos/cobranza/asignar`): filtrar por zona, sucursal o atraso y asignar en bloque. Lo no
  asignado queda en la bandeja de la oficina **(decisión mía)**.
- Permisos nuevos: `cobranza` (ver la ruta, cobrar), `cobranza-all` (ver todas las rutas y
  asignar), `cobranza-cuadre` (recibir entregas de los cobradores).
- Un cobrador sin `cobranza-all` solo puede cobrar desde la ruta a sus clientes asignados. Lo
  comprueba la RPC de la ruta en la base, no solo la pantalla.

### Ruta del día (`/motos/cobranza`, primero móvil)

```
Ruta de hoy · Pedro (cobrador)              Por cobrar RD$18,400
Cobrado hoy RD$9,200 · En mano RD$7,700 (sin entregar)
──────────────────────────────────────────────────────────────
● Juan Pérez "El Flaco" · Los Jardines      Cuota RD$650 + mora RD$45
  Honda CG 150 · K1234567 · 3 días atrasado   [Cobrar] [No pagó] [WhatsApp] [Llamar]
● María Soto · Parada del parque             Cuota RD$500 · vence hoy
  Promesa: pagaba hoy RD$1,000                [Cobrar] [No pagó] [WhatsApp] [Llamar]
```

- Entran los clientes asignados con cuota que vence hoy, atrasados y promesas para hoy. Se
  ordena por orden de visita (o por atraso si el cobrador lo cambia). Muestra la moto, el monto
  sugerido (cuota + mora), los días de atraso, la dirección y la parada.
- **Cobrar:** elige la cuenta, monto, método (efectivo o transferencia con referencia). El
  "abono general" reparte entre las ventas a crédito y financiadas del cliente, como hoy
  (`register_customer_payment`); cada préstamo se cobra por separado. Al terminar: **Enviar recibo por WhatsApp** (enlace al PDF del
  recibo con el mismo mecanismo de `receipt-link`, ampliado a abonos) e **Imprimir**.
- **No pagó:** resultado de la visita (no estaba, no tenía, promete pagar con fecha y monto, se
  negó, la moto no aparece) y nota. Queda en `collection_visits`; las promesas salen en la ruta
  del día prometido.

### Abonos en la calle y cuadre del cobrador

- El cobro desde la ruta usa las RPC de siempre (`register_loan_payment`,
  `register_sale_payment`, `register_customer_payment`) a través de una RPC de la ruta
  (`cobranza_registrar_abono`), que marca el abono con `collected_by` y `en_calle = true`
  (columnas nuevas en `loan_payments` y `credit_payments`) y **no exige caja abierta** en
  efectivo: el dinero está en el bolsillo del cobrador, no en la gaveta. Se marca con
  `set_config('app.cobranza', …, true)` (solo dura la transacción), el mismo patrón que
  `app.refinance_loan`; nadie más puede ponerlo porque PostgREST no expone `set_config`.
- Las entregas son **por cobrador y sucursal**: lo cobrado para cuentas de una sucursal entra a
  la caja de esa sucursal.
- `close_caja_session` deja fuera los abonos en efectivo `en_calle` que todavía no se han
  entregado.
- **Cuadre** (`/motos/cobranza/cuadre`, permiso `cobranza-cuadre`): por cobrador, lista de abonos
  en efectivo sin entregar con su total. **Recibir entrega:** el cajero cuenta y declara lo
  recibido; se crea la entrega (`collector_settlements`: cobrador, quién recibió, esperado,
  recibido, diferencia, nota), los abonos quedan liquidados y entra **un movimiento de entrada**
  a la caja abierta por lo recibido. Así no se cuenta dos veces.
- Sin el módulo de Caja, la entrega queda registrada igual (es el control del cobrador), sin
  movimiento de caja.
- **Diferencias:** quedan registradas a cargo del cobrador y salen en el reporte; el sistema no
  las cobra ni las descuenta **(decisión mía)**.
- **Anular un abono en la calle** antes de entregarlo no toca la caja; después de entregado,
  sigue la regla de hoy (sale de la caja abierta).
- Abonos por transferencia desde la ruta: no pasan por el cuadre, pero cuentan en los reportes
  del cobrador.

### Avisos por WhatsApp

- **Avisos de hoy** (`/motos/cobranza/avisos`): clientes con cuota mañana, hoy o atrasados, cada
  uno con un botón que abre WhatsApp con el mensaje ya escrito (plantilla editable). El
  cobrador o la oficina los envía uno por uno. Sin API de pago.

### Reportes de la entrega 3

- **Cobranza por cobrador:** por cobrar en el período, cobrado, efectividad (%), visitas,
  promesas cumplidas e incumplidas, clientes atrasados en su cartera.
- **Cuadres de cobradores:** entregas, esperado, recibido y diferencias por cobrador.
- **En mano ahora:** efectivo sin entregar por cobrador y desde cuándo.
- Antigüedad de cartera (entrega 1), filtrable por cobrador.

---

## Entrega 4 — Recuperación

> **Estado 4A (2026-11-26):** recuperación de motos, construida en la rama
> `claude/motoprestamos-entrega-4a` (sobre 3B). Migraciones `20261126120000_motos_recuperacion_base`,
> `20261126130000_motos_recuperacion_rpc` y `20261126140000_motos_recuperacion_arreglos`
> **aplicadas en producción**. Louis pidió «ambas» formas: la venta recuperada se cierra **dando
> de baja el saldo** (4A; la nota de crédito parcial B04/E34 queda para 4B) y la garantía se
> liquida **vendiéndola a un tercero** (abono sin factura; la moto sale de baja) **o quedándosela
> el negocio** (dación en pago: método `dacion`, la moto entra al inventario por la tasación).
> Diferencias con lo de abajo: la venta recuperada queda en `paid` con `recovered_at` y
> `written_off_amount` (no hay estado nuevo; las pantallas dicen «Recuperada», no se cobra, no se
> anula ni se reabre, no manda avisos ni cuenta en el 607 como cobrada); el préstamo con el saldo
> de baja queda `cancelled` con `written_off_amount` (no recibe abonos ni avisos); el sobrante de
> una venta a un tercero no pasa por la caja (solo el de la dación y la devolución de una venta
> recuperada); el abono de una liquidación no se anula; una venta con dos motos no se recupera
> desde una; refinanciar con la moto incautada la pasa al préstamo nuevo. Registro en
> `vehicle_recoveries`; reporte «Recuperaciones de Motos».

> **Estado 4B (2026-11-26):** nota de crédito por lo no cobrado de la venta recuperada, en la rama
> `claude/motoprestamos-entrega-4b` (diseño corto `2026-11-26-motoprestamos-4b-nota-credito-design.md`).
> Migración `20261127120000_motos_nota_credito_recuperacion` **aplicada** y `ecf-emitir` **desplegada**
> (las anulaciones arman igual que antes). Probada en pantalla en la demo: la E34 con
> `CodigoModificacion` 3 la **aceptó la DGII en TesteCF**. La 607 la pone en «Venta a crédito»; en
> Impuestos, la de más de 30 días no rebaja el ITBIS; Anulados la lista como «Recuperación» fuera de
> sus totales.

### Moto vendida a cuotas

- Acción **Recuperar vehículo** en la venta financiada y en la ficha: fecha, motivo, estado de la
  moto, **valor de reingreso** (tasación) y nota.
- Efecto: la cuenta se cierra como **recuperada** (el saldo pendiente se da de baja y deja de
  generar mora), la moto vuelve a `disponible` como usada con costo = valor de reingreso, y el
  stock suma 1. Lo que el cliente pagó se queda como cobrado. Si el negocio le devuelve dinero al
  cliente, sale de la caja.
- **Cómo se reporta ante la DGII** (nota de crédito por lo no pagado, o solo baja del saldo):
  **pendiente de Louis y su contador**. Ver preguntas abiertas.
- Cómo se cierra la cuenta en la base (estado nuevo de la venta, o columnas de baja y cuotas
  marcadas como dadas de baja) se decide al empezar esta entrega, con la respuesta del contador:
  un estado nuevo en `sales` toca todos los reportes que filtran por `payment_status`.

### Moto en garantía de un préstamo

- **Incautar garantía:** el vehículo pasa a `recuperado` (en el patio); el préstamo sigue vivo.
- Si el cliente se pone al día o salda, **Devolver vehículo**: vuelve a `en_garantia` o
  `liberado`.
- **Liquidar garantía:** se registra lo obtenido al venderla. Entra como abono al préstamo (por
  caja si es en efectivo); si sobra, se le devuelve al cliente (sale de la caja); si falta, el
  administrador elige dejarlo como deuda o darlo de baja. No pasa por el POS ni lleva NCF: no es
  una venta del negocio **(decisión mía, a confirmar con el contador)**.

### Reporte de la entrega 4

- **Recuperaciones:** vehículos recuperados en el período, saldo dado de baja, valor de
  reingreso, lo obtenido al liquidar garantías y resultado.

---

## Riesgos

- Tocar `create_sale_with_items`, `annul_sale`, `close_caja_session` y las tres RPC de abonos,
  que usa Pujols todos los días. Se cambian solo las líneas necesarias sobre la definición viva,
  con huellas md5 antes y después y la suite con `begin … rollback`.
- La frecuencia diaria toca casi todo el motor de cuotas. Hay que probar los planes viejos
  (semanal, quincenal, mensual) y comprobar que dan exactamente lo mismo que antes.
- El cuadre del cobrador cambia cómo cuadra la caja. Se prueba el caso completo: cobro en la
  calle, cierre de caja sin entregar, entrega al día siguiente, anulación antes y después.
- El módulo de Préstamos casi no tiene uso real (3 préstamos, 0 abonos al 2026-11-23). Este
  cliente sería el primero en usarlo a fondo: hay que acompañarlo en el arranque.

## Preguntas abiertas para Louis

1. **Refinanciación con dinero adicional:** ¿sale de la caja, como el desembolso nuevo? Cambia lo
   que decidiste el 2026-10-15. Bloquea la entrega 1.
2. **Internet en la calle:** ¿los cobradores del prospecto tienen datos en el teléfono? Si
   cobran en zonas sin señal, trabajar sin internet deja de ser opcional y la entrega 3 crece
   bastante. No bloquea las entregas 1 y 2.
3. **Recuperación ante la DGII** (para tu contador): al recuperar una moto vendida a cuotas, ¿se
   emite nota de crédito por lo que no se pagó o solo se da de baja el saldo? Y al liquidar una
   garantía, ¿basta con registrar lo obtenido como abono, sin factura? Bloquea solo la entrega 4.

## Pendientes que anotó Louis (2026-11-26)

1. **Sugerencias al encender el módulo.** Al activar Motopréstamos en una empresa, cargar solas, como
   sugerencia que se puede borrar, las categorías de vehículos (Motor, Pasola, Carro…) y las del
   inventario (Motos, Repuestos…). Hoy los tipos de vehículo («Motor») solo se crean al dar de alta
   la empresa con el rubro Motopréstamos (`admin/empresas`, `preset.vehicleTypes`); encender el
   módulo después en una empresa que ya existe no carga nada.
2. **Nada de vehículos con el módulo apagado.** Las opciones de Inventario no deben ofrecer «Es
   vehículo» si el módulo está apagado. El formulario del artículo ya lo esconde
   (`product-dialog.tsx`: `showVehicle = isModuleEnabled('motoprestamos') || product.isVehicle`),
   salvo en un artículo que ya era vehículo. Falta confirmar con Louis en qué pantalla lo vio y
   revisar el resto de Inventario (filtros, columnas, importación).

## Decisiones mías para revisar

- Cobro diario como dos frecuencias (lunes a sábado, todos los días); interés diario prorrateado a
  26 o 30 cuotas por mes.
- Tope de 312 cuotas y 60 meses; ticket térmico con las próximas 12 cuotas.
- Tramos de antigüedad 1–7 · 8–15 · 16–30 · 31–60 · 61–90 · +90.
- Encender Motopréstamos enciende Préstamos; el rubro trae Caja y Portal.
- El stock de los artículos-vehículo lo mueven solo sus unidades; sin compras, transferencias ni
  presentaciones en esta versión; vender un vehículo exige cliente; la factura lleva el chasis.
- Garantes y referencias por cliente, no por operación; garante obligatorio apagado por defecto.
- Contratos con texto base para revisar con un abogado.
- Asignación de cartera por cliente y sucursal; rol Cobrador sin acceso a ventas ni reportes.
- Diferencias del cuadre solo registradas, sin descontar al cobrador.
- Liquidar una garantía no pasa por el POS ni lleva NCF (a confirmar con el contador).
- Orden de entregas 1 → 2 → 3 → 4.
