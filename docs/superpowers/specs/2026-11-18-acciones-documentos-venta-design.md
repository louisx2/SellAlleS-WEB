# Acciones de documentos de la venta (Movimientos, recibo y abonos)

Fecha: 2026-11-18 · Tamaño: cambio pequeño (solo interfaz, sin base de datos)

## Por qué

Louis quiere que, desde Movimientos, un financiamiento se pueda consultar y
mandar al cliente sin pasar por el módulo de Financiamientos, y que los botones
de los documentos (recibo, estado, plan) se vean ordenados y profesionales.

## Qué se pidió

1. En Movimientos, en el menú de los tres puntitos de una venta financiada: un
   botón «Estado del financiamiento».
2. En ese mismo menú: enviar el recibo/factura y los documentos del
   financiamiento.
3. En el cuadro «Abonos de esta venta» (debajo del recibo): los mismos botones
   que tiene el recibo.
4. Ordenar esos botones con un diseño mejor.

## Diseño elegido: «Imprimir + Enviar al cliente ▾ + PDF»

Elegido por Louis entre tres opciones (mosaico, este, fila agrupada):

```
[🖨 Imprimir]  [➤ Enviar al cliente ▾]  [⬇ PDF]
                ├ 💬 WhatsApp
                └ ✉ Correo
```

Las otras dos: mosaico de 4 botones (más grande, más espacio) y fila agrupada
con títulos (más parecida a lo de hoy).

Ajuste al probarlo (decisión mía, a revisar por Louis): con «Enviar al
cliente» los tres botones medían 383 px y los diálogos del ticket tienen 335,
así que se partían en tres filas. Quedó así:

- Los tres botones en columnas iguales que ocupan todo el ancho.
- El botón dice «Enviar ▾»; el menú se titula «Enviar al cliente por».
- En teléfono (columnas de ~84 px) van sin ícono; desde tableta, con ícono.
- En los diálogos, «Atrás»/«Cerrar» bajan a su propia fila.

Se usa igual en todos los sitios donde se manda un documento de la venta:
detalle de la venta (recibo), cuadro de abonos, diálogo de estado del
financiamiento, diálogo de plan de pagos y diálogo de recibo del POS.

## Piezas

- **Barra de documento** (`BotonesDocumento`): los tres botones, presentacional.
  `CompartirDocumento` la usa con sus diálogos de WhatsApp/Correo; el recibo del
  POS la usa con sus pantallas internas.
- **Menú de Movimientos** (`SalesActions`):
  - Ver recibo · Ver financiamiento (si es financiamiento)
  - Sección «Enviar al cliente»: Factura (o Recibo si no lleva NCF) → diálogo
    del recibo; Estado del financiamiento → su diálogo; Plan de pagos → su
    diálogo. Los dos últimos solo en financiamientos.
  - Anular venta (igual que hoy)
  - Una venta anulada no ofrece enviar nada: el estado le diría que debe, y la
    factura anulada no es lo que se le manda.
  - Los diálogos se montan solo al abrirse (la tabla tiene una fila por venta).
- **Diálogo de estado**: si no le pasan los abonos, los carga al abrirse y
  muestra un indicador mientras tanto (para no mandar un estado sin pagos).
- **Cuadro de abonos** (`SalePaymentsCard`), solo en financiamientos vigentes:
  bloque «Estado del financiamiento» con la barra, y debajo «Plan de pagos» y
  «Ver financiamiento →». La venta a crédito simple sigue con su enlace a
  «Estado de cuenta».

## Fuera de alcance

- El recibo de un abono suelto: el servidor de enlaces no lo conoce
  (`DocumentoVenta` = factura | plan | estado). Haría falta tocar la Edge
  Function.
- La botonera del encabezado de /financing/detail.
