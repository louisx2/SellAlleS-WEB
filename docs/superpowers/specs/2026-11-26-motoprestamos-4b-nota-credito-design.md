# Motopréstamos 4B — Nota de crédito de la venta recuperada (diseño corto)

Aprobado por Louis el 2026-11-26. Parte de la entrega 4 de
`2026-11-23-motoprestamos-design.md` (la 4A, recuperación con baja del saldo, ya está en
producción desde el PR #87).

## Intención

Al recuperar una moto vendida a crédito, la 4A da de baja el saldo, pero la factura sigue
diciendo que se vendió por el total. Louis pidió que «se puedan ambas»: además de la baja, una
**nota de crédito parcial** que reverse ante la DGII lo que no se cobró. Así la factura menos la
nota da lo que de verdad quedó cobrado.

## Objetivos

- Emitir la nota al recuperar (casilla en «Recuperar vehículo») o después, desde la venta
  recuperada («Emitir nota de crédito»).
- B04 en las empresas con serie B y E34 en las de e-CF, por el mismo camino que la anulación
  (secuencia, encolado y envío a MSeller).
- Que la 607 y el reporte de impuestos la tomen sin cambios, y que Anulados no la confunda con
  una anulación.

## No objetivos

- No cambia la baja del saldo de la 4A ni el estado de la venta recuperada.
- No anula la factura ni toca el inventario (la moto ya volvió en la 4A).
- No hay notas de crédito parciales fuera de Motopréstamos (devoluciones parciales del POS).

## Anti-objetivos

- Una nota que no cuadre con la venta: la factura menos la nota tiene que dar lo cobrado neto.
- Dos notas para la misma venta (`credit_notes.sale_id` es único).
- Enviar a la DGII algo que no se pueda volver a armar igual (las líneas quedan guardadas).

## Enfoques

**Monto** (elegido por Louis: lo no cobrado):

- **Lo no cobrado** (elegido): lo que no se cobró del valor facturado. Lo cobrado queda como
  venta hecha; cuadra con el saldo que la 4A da de baja.
- Valor de reingreso: trata la recuperación como devolución por lo que vale la moto hoy, pero la
  diferencia con lo no cobrado queda facturada sin que nadie la pague.
- Anular la factura entera: deja lo cobrado sin factura. Descartado.

**Cómo se guardan las líneas** (decisión mía):

- **Instantánea en la nota** (elegido): `credit_notes.items jsonb` con las líneas ya
  prorrateadas. El monto enviado y el guardado no pueden separarse.
- Guardar solo un factor y recalcular al enviar: más chico, pero el armado depende de recalcular
  igual cada vez.
- Tabla `credit_note_items`: más pesada para un caso que siempre es de pocas líneas.

## Decisiones

- **Monto:** `factor = min(1, (dado de baja + devuelto al cliente) / total a pagar)`, donde el
  total a pagar es `financing_details.totalWithInterest` en una venta financiada y `total` en una
  a crédito, y lo dado de baja y lo devuelto son los de la recuperación (`vehicle_recoveries`).
  Nota = `total facturado × factor`. Ejemplos: crédito de 95,000 con 20,000 abonados → 75,000; con
  1,000 devueltos al cliente → 76,000. En una financiada la factura no lleva intereses y lo
  abonado cubrió capital e interés: por eso se prorratea contra el total a pagar.
- **Líneas:** cada línea de la venta por su parte (`precio × factor`), conservando gravada o
  exenta; el redondeo a centavos se ajusta en la última línea para que la suma dé la nota. El
  ITBIS de la nota sale de esas líneas.
- **Comprobante:** el mismo de la anulación (B04 de `ncf_sequences`, o E34 encolado por
  `trg_ecf_encolar_nota_credito`), con `CodigoModificacion` 3 («corrige montos») en vez de 1. El
  `IndicadorNotaCredito` (más de 30 días) se calcula como hoy.
- **Solo con NCF:** sin comprobante en la venta no hay nota que emitir (la opción no aparece).
- **Marca:** `credit_notes.kind` (`anulacion` | `recuperacion`); las existentes quedan en
  `anulacion`.
- **Quién:** solo el administrador, como recuperar la venta.
- **Diálogo:** la casilla aparece marcada si la venta tiene NCF y muestra el monto.
- **Reportes:** la 607 y Impuestos sin cambios; Anulados muestra «Recuperación» en esas notas.
- **Para el contador:** casi siempre sale a más de 30 días de la factura (motos a plazos): queda
  marcada así y no rebaja el ITBIS.

## Lo que decide quien construye

- Nombres de la RPC y de sus parámetros, y si la recuperación la llama por dentro o el front la
  llama después de recuperar.
- Cómo se ve la nota en el detalle de la venta (siguiendo lo que ya se muestra para la anulación).
- El texto de las líneas, dentro del tope de 80 caracteres del e-CF.
