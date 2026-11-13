# Datos del cliente en la factura, firmas del plan, envío del plan y estado del financiamiento, logo de Comercial GP

Fecha: 2026-11-12 · Rama: `claude/factura-datos-cliente` (desde `origin/main` 2ac1ef2)

## Por qué

Comercial GP vende electrodomésticos y los manda con un chofer. El chofer
necesita ver en la factura la dirección y el teléfono del cliente. Hoy la
factura solo imprime nombre y RNC. Además: las dos firmas del plan de pagos
quedan apretadas una al lado de la otra; el plan de pagos solo se imprime (no se
manda por WhatsApp/correo como la factura); y GP no tiene logo.

## Objetivos

1. **Datos del cliente en la factura, a pedido.**
   - En Perfil de Empresa, una sección "Datos del cliente en la factura":
     interruptor *Mostrar datos del cliente* + casillas de qué datos salen
     (Dirección, Teléfono, Correo). Se guarda en la empresa (base), no en el
     navegador.
   - Si el interruptor está apagado, nada cambia y no aparece ninguna casilla.
   - Si está encendido, al cobrar (diálogo de pago del POS) aparece la casilla
     *Incluir datos del cliente en la factura*, **desmarcada por defecto** (solo
     las ventas con chofer la marcan). La decisión viaja a la factura que se abre
     al terminar, donde se puede volver a cambiar antes de imprimir/enviar.
   - En el detalle de la venta (Movimientos) la misma casilla, desmarcada, para
     reimprimir o reenviar con los datos.
   - Con la casilla marcada, el encabezado de la factura muestra los datos
     elegidos debajo del nombre del cliente — en pantalla, impreso, PDF y lo que
     se manda por WhatsApp/correo (todos usan `ReceiptHeader`).
   - Consumidor final / cliente sin esos datos: la casilla no aparece o el dato
     vacío simplemente no se imprime.
2. **Firmas una debajo de la otra** en el plan de pagos (`payment-plan-content.tsx`).
3. **Enviar el plan de pagos** por WhatsApp (enlace temporal de 15 días), correo
   y descargar PDF, igual que la factura.
4. **Estado del financiamiento** ("detalles de los pagos"): documento nuevo desde
   el detalle del financiamiento con cliente, totales (total a pagar, pagado,
   balance pendiente), cuotas con su estado y el historial de abonos (fecha,
   monto, mora, método). Se imprime, descarga y manda por WhatsApp/correo.
5. **Logo de Comercial GP**: imagen "Comercial GP", fondo amarillo, letras azul
   marino, la **G en rojo** y la **P en azul marino**. Se sube como logo y como
   logo de ticket (el de ticket se pasa a grises al subirlo: en térmica y PDF el
   amarillo sale gris claro).

## No objetivos

- No se guarda en la venta si llevó los datos del cliente (guardarlo obligaría a
  tocar `create_sale_with_items`, que es delicada). Al reimprimir se vuelve a
  marcar la casilla.
- No hay "dirección de entrega" distinta a la del cliente.
- El plan de pagos y el estado del financiamiento no llevan la casilla de datos
  del cliente.
- No se cambia el recibo de abono.

## Enfoques considerados (datos del cliente)

- **A (elegido por Luis, con su ajuste):** qué datos salen se configura en la
  empresa; en el pago una casilla para incluirlos o no, que solo aparece si la
  configuración está encendida. Un admin decide una vez, el cajero solo marca.
- B: casillas por dato junto al pago, recordadas por computadora. Descartado:
  cada caja se configura aparte y el cajero ve más casillas.
- Siempre visibles en todas las facturas. Descartado: GP solo los quiere en las
  ventas con chofer.

## Cómo (decisiones)

- **Base:** migración que agrega a `companies`
  `receipt_customer_info_enabled boolean not null default false` y
  `receipt_customer_fields text[] not null default '{address,phone}'`
  (valores válidos: `address`, `phone`, `email`; con `check`). Sin funciones
  nuevas, sin grants nuevos (columnas de una tabla existente). La aplica Luis
  antes del merge; nunca `supabase db push`.
- **Front:** `CompanyProfile` + mappers con los dos campos; `ReceiptHeader` y
  `ReceiptContent` reciben `showCustomerInfo?: boolean`; el diálogo de pago pasa
  la casilla al `ReceiptDialog` vía el carrito/`cart-display`.
- **Envíos:** las Edge Functions `receipt-link` y `send-sale-receipt` aceptan
  `documento: 'factura' | 'plan' | 'estado'` (por defecto `factura`, así lo viejo
  sigue igual):
  - `receipt-link`: ruta `<empresa>/<venta>[-plan|-estado].pdf`, nombre de
    descarga propio, y el enlace vigente se reutiliza **por ruta** (hoy es por
    venta: sin esto el plan pisaría el enlace de la factura que el cliente ya
    tiene). `limpiar_comprobantes()` ya trabaja por `storage_path`, no cambia.
  - `send-sale-receipt`: asunto y texto según el documento.
  - Se despliegan **antes** de fusionar el front: un front nuevo contra la
    función vieja subiría el plan encima del PDF de la factura.
- La lógica de WhatsApp/correo/PDF que hoy está copiada en `receipt-dialog` y
  `sale-receipt-client` se saca a un componente reutilizable para no copiarla
  dos veces más.

## Lo que queda al constructor

Textos exactos de los mensajes, diseño visual del estado del financiamiento
dentro del estilo de ticket existente, y el reparto de componentes.
