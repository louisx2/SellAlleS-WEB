# Servicios (el Taller pasa a ser un módulo de servicios para cualquier negocio) — diseño

**Fecha:** 2026-11-26 · **Pedido por:** Louis · **Primer cliente:** ninguno todavía. Casos que
lo motivan: POPI Pets Shop (peluquería de mascotas), un motopréstamos que hace cambios de
aceite, un salón de uñas, una empresa de limpieza.

## Por qué

SellAlleS es un software modular para vender de todo, también servicios. Hoy el único módulo
de servicios se llama **Taller** y habla de equipos, IMEI y reparaciones. Louis no le va a
encender «Taller» a un negocio que no tiene taller: lo que da son servicios.

Sus palabras: *«hagamos un modulo para dar servicios que no se llame taller»*, *«no siempre es
un servicio de un articulo que se deja y no siempre es un taller; podria ser un servicio de
hacer uñas o de limpieza»*, *«popi pets hace servicios de peluqueria a las mascotas, no podria
ponerles taller»*, *«si el moto prestamos hace un cambio de aceite deberia ser un servicio»*.

Lo que se encontró al revisar (2026-11-26):

- El Taller (PR #74, entregas 1–4) está en producción y tiene **0 órdenes** en todas las
  empresas. Pujols lo tiene encendido y no lo usa.
- Vender un servicio suelto ya se puede: un artículo sin existencias (`tracks_stock = false`,
  `es_servicio = true`) se cobra en el POS con su NCF o e-CF. Lo que falta es lo que rodea al
  servicio: agenda, quién lo hizo, comisión por servicio, historial del cliente, recordatorios.
- Lo que hace el Taller (ficha de lo que el cliente deja, chequeos de llegada, estados, piezas
  del inventario, enlace de seguimiento, cobro por el POS) **no es solo de talleres**: POPI
  recibe un perro, le anota la raza y si tiene pulgas, lo baña y avisa que está listo; el cambio
  de aceite es una moto que entra con aceite y filtro del inventario.
- POPI ya cargó **13 servicios** en el catálogo del Taller el 2026-11-21 (baño, peluquería
  canina, corte de uñas, vacuna, microchip, cuidado de día, papeles de viaje…), con el módulo
  apagado y sin artículo creado. Además tiene en el inventario «corte de uñas», «VACUNA»,
  «MICROCHIP» y «VACUNA Y DEPARASITANTE» como artículos **con existencias y marcados como bien**.
- La comisión de hoy (módulo Comisiones) es **por factura y a un solo vendedor**. En un salón
  una misma cuenta lleva el trabajo de varias personas.
- El personal que da el servicio hoy tiene que ser **usuario** (`service_technicians` apunta a
  `profiles`), y cada sucursal tiene tope de usuarios (`branches.max_users`).

## Lo que decidió Louis

- **Un solo módulo «Servicios» que absorbe el Taller** (opción A). Se descartaron: un módulo
  nuevo con el Taller aparte (dos catálogos, dos listas de personal, dos cobros, y POPI necesita
  igual la ficha y los chequeos del Taller) y Servicios de base con el Taller como complemento
  (POPI tendría que encender «Taller» para recibir un perro). Cambiarle solo el nombre tampoco
  alcanza: las pantallas siguen hablando de reparaciones.
- Debe servir para **cualquier negocio de servicios**, no solo los que reciben un artículo.
- No respondió en contra de lo propuesto en la conversación: catálogo con duración y comisión,
  personal sin usuario, agenda por día y por persona con «atender ahora», cobro por el POS con
  quién hizo cada línea, historial del cliente con notas, botón de WhatsApp, reportes; y para
  después paquetes, servicios fijos cada semana, reserva en línea y descontar materiales.

El resto de las decisiones son mías y están marcadas **(decisión mía)** para que Louis las
revise.

## Objetivos

- Que un negocio de servicios de cualquier tipo (uñas, peluquería de mascotas, limpieza,
  lubricentro, reparación de celulares…) opere en SellAlleS con un módulo que se llame
  **Servicios** y hable su idioma.
- Que el taller de celulares siga funcionando igual que hoy, con otro nombre de módulo.
- Que los servicios entren a caja, ventas, 607, e-CF y reportes por el POS, como ya hace el
  Taller.
- Que se sepa quién hizo cada servicio y cuánto se le debe de comisión.

## Lo que no se hace (por ahora)

- **Paquetes y membresías** (10 baños pagados por adelantado), **anticipos** y **depósitos de
  cita**: tocan caja y cómo se declara ante la DGII (la misma razón por la que el Taller dejó
  fuera los anticipos).
- **Servicios fijos automáticos** (limpieza todos los martes que se crean solas). Sí hay
  «Repetir cita» a mano (entrega 2).
- **Reserva en línea** por el cliente.
- **Descontar materiales** por servicio (gel, champú). Es la misma pieza que las recetas del
  restaurante (pendiente aparte). Las piezas y materiales se pueden agregar a mano a la orden,
  como hoy.
- **WhatsApp automático** (API de pago de Meta). Los avisos salen con un botón que abre WhatsApp
  con el mensaje escrito, como en Taller y Motopréstamos.
- **Cobro en la calle** del servicio a domicilio (el personal cobrando con el teléfono). Se cobra
  por el POS, de contado o a crédito.
- **Horarios del personal**, días libres y turnos.
- **Historia clínica** (consultorios, veterinaria). Datos sensibles que piden otro cuidado.

## Lo que haría que fracase aunque funcione

- Que a un salón de uñas le salga en cualquier pantalla «IMEI», «reparación», «equipo» o
  «técnico».
- Que el taller de celulares pierda algo de lo que hace hoy.
- Que cambie algo en ventas, caja, comisiones o e-CF para las empresas que no encienden el
  módulo.
- Que una comisión se pague dos veces, o que una venta anulada siga comisionando.
- Que para registrar a sus manicuristas un negocio tenga que gastar cupos de usuario.

## Restricciones del proyecto

- Migraciones por `apply_migration` del MCP de Supabase, nunca `supabase db push`; probadas
  antes en `begin … rollback` contra producción; cada objeto nuevo con `revoke all … from
  public, anon, authenticated` antes de sus grants (ver `SUPABASE.md`).
- Una función viva (`create_sale_with_items`, `annul_sale`, RPC del Taller…) se cambia partiendo
  de `pg_get_functiondef` y comprobando la huella md5 del cuerpo, como hizo el Taller.
- Tablas puente: un índice único sobre dos columnas con FK, **no** una restricción `unique`
  (si no, PostgREST la toma por puente y los embeds responden 300). `services` ya tiene tres FK
  a `profiles`: todo embed nuevo nombra su FK.
- Dentro de diálogos no van `Select` de Radix.
- La demo (`…0aa`) emite e-CF en TesteCF: no se cobran ventas en pantalla; los datos de prueba
  se crean por SQL y se borran al terminar.
- Textos en español dominicano.

## Cómo queda el módulo

### Nombre y lugar en el menú

- La clave del módulo sigue siendo `services` (no hay datos que mover y Pujols lo conserva
  encendido). Se llama **Servicios** en el catálogo de módulos, el menú, los roles, los reportes
  y el panel de administración.
- Menú: **Servicios** (órdenes), **Agenda** (entrega 2) y **Configuración de Servicios**.
  Reporte: **Servicios** (hoy «Taller»). Ícono nuevo; no la llave inglesa (decisión mía).
- Las rutas internas (`/services`, `/service-types`) se quedan; `/reports/taller` pasa a
  `/reports/servicios` y la vieja redirige (decisión mía).
- `defaultEnabled` pasa a **false**: una tienda no debe ver «Servicios» en el menú sin pedirlo.
  Hoy solo dos empresas no tienen fila propia (la demo y Abajate, suspendida); la demo recibe
  una fila `enabled = true` para no perderlo (decisión mía).

### Palabras (decisión mía)

| Hoy (Taller) | Servicios |
|---|---|
| Caso | **Orden** («Orden #0142»). En la agenda se le dice **cita**. |
| Técnico | **Personal** («Lo atiende») |
| Tipo de equipo | **Tipo de ficha** («Qué se atiende») |
| Equipo | La ficha: «Max · Poodle», «Honda CG 150 · K123456», «iPhone 13» |
| Nuevo ingreso | **Nueva orden** |
| Reparación rápida | **Atender ahora** |
| Configuración del Taller | **Configuración de Servicios** |

Las palabras de reparación («En diagnóstico», «Esperando pieza», «No se pudo reparar»,
garantía de reparación) solo salen en órdenes cuya ficha es de un tipo marcado **de
reparación** (ver abajo).

### Qué se atiende (tipos de ficha)

`service_equipment_types` pasa a ser el **tipo de ficha**: lo que el cliente trae o lo que se
atiende. Una orden puede no tener ficha: el servicio es a la persona (uñas, corte de pelo) o al
lugar (limpieza).

Cada tipo de ficha dice **qué campos lleva y cómo se llaman** (decisión mía):

- Los tres campos que hoy tiene el equipo (marca, modelo, número de serie) se pueden renombrar
  o quitar. Ejemplos: mascota → «Nombre», «Raza», sin serie; moto → «Marca», «Modelo», «Placa»;
  teléfono → «Marca», «Modelo», «IMEI».
- Si pide clave o patrón (solo tiene sentido en equipos).
- Campos propios (texto o número), como hoy: «Tamaño», «Peso», «Kilometraje», «Color».
- Sus chequeos de llegada, como hoy («Pulgas», «Heridas», «Nudos» para una mascota).
- **De reparación** sí o no. Activa los estados de reparación, la «Garantía al taller» desde una
  venta y el texto «Lo estamos reparando» para el cliente. Las plantillas de celulares,
  computadoras, electrónica y mecánica vienen marcadas.

Cómo se guardan los nombres de los campos (columnas nuevas o dentro de `extra_fields`) lo decide
quien construya; las órdenes viejas no existen (0 filas).

### Fichas guardadas del cliente (decisión mía)

El mismo perro vuelve cada mes y la misma moto cada tres. Llenar la ficha cada vez cansa.

- Tabla nueva de **fichas del cliente**: cliente, tipo de ficha, los campos, notas («muerde»,
  «alérgico a…») y activa sí o no.
- Al crear una orden se elige una ficha del cliente o se crea una nueva (que queda guardada).
- La orden sigue guardando **una copia** de la ficha como hoy (columnas `equipment_*` y
  `equipment_details`) más el enlace a la ficha. Cambiar la ficha después no cambia órdenes
  viejas.
- Las notas de la ficha se ven en la orden y en la agenda.
- En el detalle del cliente, pestaña **Servicios**: sus fichas y su historial de órdenes (fecha,
  servicios, quién lo atendió, total, notas visibles).
- Si Motopréstamos está encendido, las motos del cliente (`vehicles`) podrían aparecer como
  fichas. **Queda para después**; por ahora el lubricentro de un motopréstamos crea la ficha
  «Moto» a mano.

### A domicilio (decisión mía)

La orden lleva **a domicilio** sí o no, con la dirección del servicio (por defecto la del
cliente, o su dirección de cobro si está). Sirve para limpieza, peluquería de mascotas a
domicilio, instalaciones. La dirección sale en la agenda, en el WhatsApp del aviso y en el
recibo. El servicio de catálogo puede venir marcado «a domicilio» por defecto.

### Estados (decisión mía)

Hay dos caminos según la orden:

- **Con ficha** (lo que el cliente deja y vuelve a buscar: mascota, moto, equipo):
  Agendada → Recibido → En proceso → Listo para retirar → Entregado.
- **Sin ficha** (persona o lugar):
  Agendada → Llegó → En proceso → Terminado.

Para todas: **Cancelada** y **No vino** (solo desde Agendada). Si la ficha es de reparación, se
suman los cuatro de hoy: En diagnóstico, Esperando aprobación, Esperando pieza y No se pudo
reparar; y «En proceso» se lee «En reparación».

- **Confirmada** no es un estado: es una marca de la cita (`confirmed_at`), que se pone al
  confirmar por WhatsApp o a mano.
- Una orden sin cita (el que llega sin cita) empieza en Recibido / Llegó, o en En proceso con
  «Atender ahora».
- Sin ficha, «Terminado» equivale a lo que hoy es «Entregado»: cierra la orden. Se llega a él
  cobrando o con el botón **Terminar** (orden en RD$0 o cobrada antes).
- Las claves internas (reusar `in_repair` como «En proceso» o renombrarla) las decide quien
  construya: no hay filas que convertir.

El texto para el cliente se adapta a la ficha: «Recibimos a Max», «Tu moto está lista», «Tu
cita es el jueves 26 a las 10:00 a. m.».

### Personal (decisión mía)

- Tabla nueva **personal de servicios** por sucursal: nombre, teléfono, color en la agenda, % de
  comisión, activo, y **usuario opcional**. Reemplaza a `service_technicians` (0 filas).
- Sin usuario no entra al sistema y no gasta cupo. La caja o la administración le maneja la
  agenda.
- Con usuario entra y, sin el permiso «ver todas las órdenes», ve las órdenes y citas donde
  aparece él (como responsable o en alguna línea) y las sin asignar. Hoy la RLS compara
  `assigned_to` con `auth.uid()`; pasa a comparar el usuario del personal.
- La orden tiene un **responsable** (el de hoy: a quién se le pasa el caso). Cada línea de
  servicio tiene **quién la hace**, que por defecto es el responsable.
- Pasar la orden a otra persona sigue igual que «transferir» hoy, con su historial.

### Catálogo de servicios

El catálogo de hoy (`service_types`, por sucursal, cada servicio con su artículo de servicio en
el POS) suma (decisión mía):

- **Duración** en minutos (para la agenda).
- **Comisión** propia: % o monto fijo. Si no tiene, vale el % de la persona.
- **Volver cada** N días (opcional): «baño cada 30 días», «cambio de aceite cada 90». Alimenta
  «Clientes a los que les toca volver» (entrega 4).
- **A domicilio** por defecto (opcional).
- Tipo de ficha (hoy «tipo de equipo») opcional.
- **Usar un artículo que ya existe** en vez de crear uno nuevo, convirtiéndolo en servicio sin
  existencias. Es lo que necesita POPI: sus 13 servicios del catálogo no tienen artículo, y
  cuatro de ellos ya existen en el inventario como bien con existencias.

### Nueva orden y «Atender ahora»

La pantalla de nueva orden se arma según lo elegido:

- **Cliente** (consumidor final por defecto en «Atender ahora»).
- **Qué se atiende**: nada, o una ficha del cliente, o una ficha nueva de un tipo. Solo con
  ficha salen los chequeos, los accesorios, la clave y las fotos.
- **Servicios** del catálogo, cada uno con quién lo hace (y en la agenda, a qué hora).
- **A domicilio** y dirección.
- Cuándo: **ahora**, o una **fecha y hora** (eso la vuelve cita, entrega 2).
- Notas, presupuesto y fecha prometida (estos dos solo con ficha de reparación, como hoy).
- El recibo de recepción se imprime solo con ficha (hoy siempre).

«Atender ahora» reemplaza a «Reparación rápida»: ficha corta, solo los chequeos marcados
obligatorios en rápida, entra en En proceso y ofrece **Cobrar ahora** o **Cobrar al final**.

### Agenda (entrega 2)

Una cita es **la misma orden** con fecha y hora (decisión mía): así la cita y el servicio tienen
un solo historial, un solo cobro y un solo enlace para el cliente.

- Cada **línea de servicio** tiene su persona, su hora de inicio y su duración (la del
  catálogo, editable). Por defecto la primera empieza a la hora de la cita y las siguientes de
  la misma persona van una detrás de otra. Dos personas pueden atender a la vez al mismo
  cliente.
- **Vista del día**: una columna por persona, franjas de 15 o 30 minutos (ajuste por sucursal),
  bloques con el color del estado, el cliente, el servicio y la ficha. Columna «Sin asignar».
- **Vista de la semana** de una persona.
- En el teléfono: lista del día por persona.
- Tocar una franja vacía crea la cita con esa persona y esa hora.
- Si una persona ya está ocupada a esa hora, **avisa pero deja** guardar.
- Mover una cita: cambiar fecha, hora o persona en su diálogo. Sin arrastrar en esta entrega.
- Acciones desde la cita: **Llegó / Recibido**, **No vino**, **Confirmar por WhatsApp**,
  **Recordar por WhatsApp**, **Repetir** (copia la cita a otra fecha), cancelar.
- Horario que muestra: de apertura a cierre de la sucursal (ajuste nuevo; 8:00 a 20:00 si no se
  pone).

### Cobro

Igual que el Taller hoy: la orden abre un carrito del POS con sus líneas, y el cajero cobra como
siempre (forma de pago, NCF/e-CF, caja, crédito). Las piezas y materiales se descuentan del
inventario al agregarlos a la orden; anular la venta no los repone y deja la orden por cobrar.

Lo nuevo (decisión mía):

- Cada línea de venta guarda **quién hizo el servicio** y su **comisión congelada** (% o monto),
  copiadas de la línea de la orden. Se guarda en la línea de venta (`sale_items`) y no solo en la
  orden, para que también sirva lo del punto siguiente. `create_sale_with_items` lo acepta
  partiendo de la definición viva.
- En el POS, si el módulo está encendido, una línea de un **servicio del catálogo vendido
  suelto** (sin orden) deja elegir **¿quién lo hizo?**. Así un salón que no usa la agenda igual
  paga comisiones.
- La base de la comisión es lo cobrado de esa línea **sin ITBIS**, después de su descuento y de
  la parte que le toca del descuento general. Una venta anulada no comisiona. Igual que
  Comisiones, el interés de una venta financiada no comisiona.
- **Comisiones por servicio y Comisiones por vendedor son independientes**: cada módulo calcula
  lo suyo y no se descuentan entre sí. Si una empresa enciende los dos, el vendedor cobra su %
  de la factura y quien hizo el servicio cobra el suyo. No se toca el módulo Comisiones.
- Una orden en RD$0 (garantía, cortesía) se termina sin pasar por el POS, como hoy.

### Avisos por WhatsApp

Botón que abre WhatsApp con el mensaje escrito (como hoy en el Taller):

- Confirmar la cita (día, hora, servicios, dirección si es a domicilio).
- Recordar la cita.
- Estado de la orden con el enlace de seguimiento (lo de hoy, con textos según la ficha).
- «Te toca volver» (entrega 4).

Textos fijos con el nombre del negocio en esta etapa; editables por empresa queda para después
(Motopréstamos ya tiene el mecanismo en `cobranza-mensajes.ts`) (decisión mía).

### Enlace de seguimiento

Sigue igual (`sellalles.com/<empresa>/c/<código>` → `/seguimiento`), para todas las órdenes. Con
cita muestra la fecha y hora; con ficha, el estado; sin ficha y terminada, «¡Gracias por
visitarnos!». Nada del personal más que el nombre de pila de quien atiende (decisión mía; hoy no
muestra nombres del personal: Louis puede preferir que siga sin mostrarlos).

### Permisos

- `services` (**Servicios**): ver / crear / editar / eliminar (cancelar), como hoy.
- `services-all`: **ver todas las órdenes y la agenda completa**. Sin él, cada quien ve lo suyo
  y lo sin asignar (en la RLS).
- `service-types`: **Configuración de Servicios**.
- El reporte de comisiones por servicio solo lo ve quien tiene Reportes y es administrador, como
  el de Comisiones (decisión mía).

### Plantillas por rubro y alta

Plantillas (tipos de ficha con sus campos y chequeos; el catálogo con precios lo arma cada
negocio, como hoy):

- **Celulares y tablets**, **Computadoras**, **Electrónica**, **Mecánica** (las de hoy, marcadas
  de reparación).
- **Lubricentro / motos**: ficha «Moto» y «Vehículo» con placa y kilometraje, sin reparación.
- **Mascotas**: «Perro» y «Gato» con nombre, raza, tamaño, peso; chequeos «Pulgas», «Garrapatas»,
  «Heridas», «Nudos», «Agresivo».
- **Salón de belleza y uñas**: sin ficha.
- **Limpieza**: sin ficha, servicios a domicilio por defecto.

Rubros nuevos en el alta de empresa (`business-types.ts`): Salón de belleza / uñas, Peluquería
de mascotas, Limpieza, Lubricentro. Cada uno enciende `services` y aplica su plantilla. El rubro
«Reparación de teléfonos» sigue igual. Al encender el módulo a mano desde el panel se ofrece
elegir una plantilla, como las sugerencias de Motopréstamos (decisión mía).

### Reportes (entrega 4)

`/reports/servicios`, período y sucursal como el resto:

- Servicios vendidos: cantidad, total, ticket promedio, los más pedidos.
- **Por persona**: servicios hechos, horas ocupadas, vendido sin ITBIS, **comisión**. Detalle
  por línea, exportable a CSV.
- Citas: agendadas, atendidas, no vino, canceladas, ocupación de la agenda por persona.
- Clientes: nuevos y que vuelven; **a los que les toca volver** (según «volver cada»), con botón
  de WhatsApp.
- Lo de hoy del Taller (tiempos, piezas, garantías, listos sin retirar) cuando hay órdenes con
  ficha.

La lógica va en `src/lib/` con pruebas, como `taller-reportes.ts`.

## Entregas

Cada una se puede fusionar y desplegar sola.

1. **Servicios para todos.** Nombre y textos, tipos de ficha configurables (campos, de
   reparación), órdenes sin ficha, fichas guardadas del cliente, estados por camino, personal
   sin usuario, a domicilio, catálogo con duración, comisión, «volver cada» y «usar un artículo
   que ya existe», «Atender ahora», plantillas y rubros nuevos, `defaultEnabled` en false.
   El taller de celulares queda funcionando igual.
2. **Agenda.** Citas con hora por línea y persona, vistas de día y semana, avisos de choque,
   Llegó / No vino / Confirmar / Recordar / Repetir, horario de la sucursal.
3. **Comisión por servicio.** Quién lo hizo en la línea de venta, comisión congelada, «¿quién lo
   hizo?» en el POS para servicios sueltos, reporte de comisiones por persona.
4. **Reportes e historial.** Reporte de Servicios, clientes a los que les toca volver, pestaña
   Servicios en el cliente.

## Datos actuales que hay que cuidar

- 0 órdenes y 0 líneas: los cambios de estados y de técnico a personal no convierten nada.
- 15 servicios de catálogo (13 de POPI, 2 de la demo), 2 tipos de equipo y 15 chequeos: se
  conservan.
- 0 filas en `service_technicians` y en `taller_settings`.

## Lo que queda para quien construya

- Nombres de tablas y columnas nuevas, y si los campos renombrables del tipo de ficha van en
  columnas o en `extra_fields`.
- Las claves internas de los estados.
- El ícono del menú, colores y el diseño visual de la agenda dentro de las reglas de interfaz del
  proyecto (`.agents/AGENTS.md`).
- Cómo se reparte el descuento general entre líneas para la base de la comisión, mientras dé lo
  mismo que lo cobrado sin ITBIS.
- El orden de las tareas dentro de cada entrega.

## Riesgos

- Volver a tocar `create_sale_with_items` (la venta de todas las empresas). Solo las líneas
  necesarias, sobre la definición viva, con `begin … rollback` y con una venta sin orden para
  confirmar que nada cambia.
- La RLS de visibilidad por persona: un error deja a alguien sin ver su agenda. Se prueba con un
  usuario de personal, uno sin «ver todas» y un administrador.
- Nuevas FK a `profiles` desde `services` o la tabla de personal: embeds con nombre de FK para
  no volver al 300.
