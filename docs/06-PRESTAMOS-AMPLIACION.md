# Préstamos: estudio de ampliación

Estado del módulo hoy, diseño de las dos funciones pedidas (capital disponible y
envío del comprobante), y el resto de huecos que aparecieron al revisarlo.

Nada de esto está implementado todavía: es el estudio previo para decidir qué
entra y en qué orden.

---

## 1. Qué hay hoy

| Pieza | Dónde |
|---|---|
| Listado + resumen (en la calle, por cobrar, ganancia) | `src/app/(app)/prestamos/page.tsx` |
| Detalle, cronograma y abonos | `src/app/(app)/prestamos/detalle/loan-detail-client.tsx` |
| Alta del préstamo | `src/components/loans/loan-dialog.tsx` |
| Comprobante/contrato imprimible | `src/components/loans/loan-ticket-dialog.tsx` |
| Registrar abono | `src/components/loans/register-loan-payment-dialog.tsx` |
| Estado calculado en el cliente (solo para mostrar) | `src/lib/loan-utils.ts` |
| Datos | `src/context/loan-provider.tsx` |
| Tasas de la empresa | `src/components/company-profile/loan-settings-card.tsx` |

En la base: `loans`, `loan_installments`, `loan_payments`; el trigger
`trg_before_loan_checks` calcula interés y total, `trg_after_loan_effects` genera
el cronograma, y `register_loan_payment` aplica el abono (mora primero, luego
capital a la cuota más vieja). El módulo ya sale en Reportes, en el Portal del
Cliente y en el cierre de caja.

**Nota de mantenimiento:** el esquema de `loans` **no está en
`supabase/migrations/`** — se creó antes de traer el backend al repo. Igual pasa
con `caja_*`. Lo que se agregue de ahora en adelante sí entra como migración, y
tiene que ser aditivo (`add column if not exists`), sin asumir que se puede
recrear la tabla desde cero.

---

## 2. Función pedida: cuánto dinero tengo disponible para prestar

### El problema real

Hoy el prestamista ve *cuánto tiene en la calle*, pero no **cuánto le queda para
seguir prestando**. Y cuando presta, ese dinero sale físicamente de la gaveta sin
que el sistema lo registre en ningún lado (ver el hallazgo del §4).

### Dos formas de resolverlo

**A. Un número fijo en configuración.** La empresa escribe "mi capital es
RD$500,000" y el sistema resta lo prestado. Simple, pero miente en cuanto entra
el primer abono: el dinero que volvió no se ve, y el número hay que corregirlo a
mano cada vez que se mete o se saca plata del negocio.

**B. Un libro de capital (recomendada).** Una tabla chiquita de movimientos de
fondo — *aportes* (metí dinero) y *retiros* (saqué ganancia) — y el resto se
deduce de lo que ya está registrado:

```
disponible = Σ aportes − Σ retiros − Σ capital desembolsado + Σ cobrado
```

donde *cobrado* es `sum(loan_payments.amount)`, que ya incluye capital, interés y
mora. Es literalmente la caja del negocio de préstamos, y tiene la propiedad que
hace falta: **el dinero que el cliente devuelve vuelve a estar disponible solo**,
sin que nadie toque una configuración.

### Esquema propuesto

```sql
create table public.loan_fund_movements (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references public.companies(id) on delete cascade,
  branch_id  uuid references public.branches(id),   -- null = fondo de la empresa
  type       text not null check (type in ('aporte','retiro')),
  amount     numeric not null check (amount > 0),
  reason     text,
  created_by uuid references auth.users(id),
  user_name  text,
  created_at timestamptz not null default now()
);
```

Con RLS por `company_id` igual que el resto, y una RPC
`loan_fund_summary(p_branch_id uuid default null)` que devuelve el jsonb con
`aportes`, `retiros`, `desembolsado`, `cobrado` y `disponible`. Se calcula en el
servidor de un viaje: el navegador hoy no tiene los `loan_payments` de todos los
préstamos cargados, y traerlos para sumarlos sería caro y se desincroniza.

En `companies`, dos banderas:

- `loan_fund_enabled boolean default false` — la función es **opcional**, como
  pediste. Apagada, la pantalla queda exactamente como está hoy.
- `loan_fund_block_overdraft boolean default false` — si prestar de más se
  **bloquea** o solo **avisa**.

### Qué se ve

- **`/prestamos`**: una cuarta tarjeta, *Disponible para prestar*, solo si la
  bandera está encendida. En rojo si quedó en negativo.
- **Botones "Registrar aporte" / "Registrar retiro"** en la misma pantalla, con
  su historial (quién, cuánto, cuándo, por qué) — un prestamista mete y saca
  dinero constantemente y sin ese registro el número no se sostiene.
- **`LoanDialog`**: debajo del monto, "Disponible: RD$X". Si el monto lo pasa,
  aviso en ámbar; y si `block_overdraft` está encendida, el botón *Prestar* se
  desactiva con el mensaje de cuánto falta.
- **Configuración** (`LoanSettingsCard`): el switch para encender la función y el
  de bloquear/avisar.

### Decisiones que hay que tomar

1. **¿Fondo por empresa o por sucursal?** El préstamo ya guarda `branch_id`, así
   que se puede separar. Propongo empresa en la v1 y dejar `branch_id` en la
   tabla para no migrar después.
2. **¿La mora y el interés cobrados cuentan como disponible?** Con la fórmula de
   arriba, sí: entró plata a la gaveta. Si prefieres separar "capital" de
   "ganancia", el retiro es la herramienta — sacas la ganancia y deja de contar.
3. **¿Qué pasa con los préstamos que ya existen?** Al encender la función el
   disponible arranca negativo (hay desembolsos y ningún aporte). Se arregla con
   un aporte inicial, y el diálogo de encendido lo puede pedir de una vez.

---

## 3. Función pedida: enviar el comprobante por correo y WhatsApp + descargar PDF

Lo de ventas ya funciona y está bien resuelto; esto es **extenderlo a préstamos**,
no rehacerlo. La cadena de ventas es:

```
receipt-dialog.tsx  →  generateReceiptPdf (html2canvas + jsPDF, a la medida del ticket)
                    →  receipt-link (paso 'subida' → sube a Storage → paso 'enlace')
                    →  sellalles.com/<empresa>/c/<código>  →  función `c` firma y redirige
                    →  send-sale-receipt (Resend, PDF adjunto)
```

De todo eso, **lo único atado a `sales` son dos Edge Functions y la tabla de
enlaces**. El render del PDF (`renderizarRecibo`, `downloadReceiptPdfFile`) ya es
genérico: recibe un `HTMLElement` y no sabe de ventas.

### Lo que hay que tocar

**1. `receipt_links` acepta préstamos** (migración aditiva):

```sql
alter table public.receipt_links add column if not exists loan_id uuid references public.loans(id) on delete cascade;
alter table public.receipt_links alter column sale_id drop not null;
alter table public.receipt_links add constraint receipt_links_uno_u_otro
  check ((sale_id is not null) <> (loan_id is not null));
create index if not exists receipt_links_loan_id_idx on public.receipt_links (loan_id);
```

`limpiar_comprobantes()` y la función `c` no se tocan: trabajan sobre
`storage_path` y `expires_at`, que no cambian.

**2. `receipt-link`** acepta `{ loanId }` además de `{ saleId }`. Resuelve
`company_id` desde `loans` con el mismo chequeo de permiso, ruta
`<company_id>/prestamo-<loan_id>.pdf` y nombre de descarga
`comprobante-prestamo-<8 chars>.pdf`. El resto (código corto, reutilizar el
enlace vigente, 15 días) queda igual.

**3. Correo.** Una función nueva `send-loan-receipt`, hermana de
`send-sale-receipt` — mismo patrón, texto propio: no puede decir "gracias por su
compra", tiene que decir monto prestado, cuota y próxima fecha de vencimiento.
(La alternativa es meterle un `loanId` a `send-sale-receipt`; se ahorra un
despliegue pero deja una función llamada "sale" mandando préstamos. Prefiero la
hermana, que además es como está armado el resto de `supabase/functions/`.)

**4. `src/lib/receipt-sharing.ts`** generaliza el destino: hoy
`shareSalePdfLinkViaWhatsApp` recibe un `Sale` para sacarle el teléfono y arma un
mensaje de compra. Se parte en un núcleo que recibe `{ id, kind, telefono,
mensaje }` y dos envolturas finas, venta y préstamo. `abrirPestanaParaWhatsApp`
(y el porqué del truco de la pestaña en escritorio) se reutiliza tal cual.

**5. `LoanTicketDialog`** pasa de un botón a cuatro — Imprimir · WhatsApp ·
Correo · Descargar PDF — con las mismas dos pantallas de confirmación que
`ReceiptDialog`, y un bloque fuera de pantalla a 100 mm del que se saca el PDF.
Como el comprobante del préstamo lleva el cronograma completo, sale más largo
que una factura: hay que verificar el peso del base64 contra el límite de la
petición de Resend, y si un plan de 60 cuotas se pasa, el correo va con el
enlace en vez del adjunto.

**Cuidado con el permiso:** el comprobante del préstamo lleva el cronograma y los
datos del cliente, y el enlace vive 15 días sin sesión. Es la misma exposición
que una factura, pero conviene decidirlo a propósito, no de rebote.

### Extra que sale casi gratis

El **recibo de abono** (`PaymentReceiptDialog`, compartido con crédito) hoy solo
se imprime. Es el papel que más se entrega en un negocio de préstamos — mucho más
que el contrato, que se entrega una vez. Con la cadena ya generalizada, dárselo
también por WhatsApp es un rato de trabajo.

---

## 4. Dos cosas que aparecieron revisando

### El desembolso no sale de la caja *(esto es un fallo, no una mejora)*

`close_caja_session` suma los abonos de préstamo en efectivo como entrada, pero
**el dinero que se entrega al crear el préstamo no se resta nunca**. Con los
módulos Caja y Préstamos encendidos a la vez, todo préstamo en efectivo aparece
como faltante en el cierre del turno, y el cajero no tiene cómo explicarlo.

Arreglo: al crear un préstamo con desembolso en efectivo, registrar un
`caja_movements` de tipo `out`, o sumar los desembolsos del turno al cálculo de
`close_caja_session`. Lo primero es más honesto — deja rastro del movimiento — y
además exige que haya caja abierta para entregar efectivo, igual que ya pasa con
cobrar.

Esto se cruza con la función 1: si se hace, el disponible del fondo y la caja
cuentan la misma historia.

### Falta cómo se entregó el dinero

`loans` no guarda método ni referencia del desembolso. Si el préstamo se dio por
transferencia, no queda constancia. Es una columna (`disbursement_method`,
`disbursement_reference`) y dos campos en el diálogo, y es lo que hace posible
distinguir el efectivo —que toca caja— del que no.

---

## 5. Otras funciones que sugiero

Ordenadas por lo que le rinde a un prestamista contra lo que cuesta hacerlas.

**Alto valor, poco trabajo**

1. **Ruta de cobro del día.** Una pantalla con las cuotas que vencen hoy y las
   vencidas, por sucursal, con el total que se espera cobrar y el botón de
   WhatsApp al lado de cada una. Es la lista de trabajo diaria del negocio; hoy
   hay que entrar préstamo por préstamo para armarla.
2. **Recordatorio de cuota por WhatsApp.** `loan_installments` ya tiene
   `reminder_sent_at` y existe la función `send-due-reminders`. Falta el botón
   manual "recordarle" con el mensaje armado (monto, fecha, mora si aplica).
3. **Saldar por adelantado.** Hoy no hay forma de cerrar un préstamo antes de
   tiempo con descuento del interés no devengado; hay que cobrar cuota por cuota.
4. **Cancelar / anular préstamo.** El estado `cancelled` existe en la base y no
   hay UI que lo use. Un préstamo mal creado no se puede deshacer.
5. **Exposición del cliente al prestar.** El diálogo no dice si el cliente ya
   tiene otro préstamo abierto ni si está atrasado. Un aviso ahí ("este cliente
   debe RD$X y tiene 2 cuotas vencidas") evita el préstamo que no se va a cobrar.

**Alto valor, más trabajo**

6. **Refinanciar / renegociar.** Rearmar el cronograma de un préstamo atrasado
   sin perder el historial: se cierra el viejo y nace uno nuevo enlazado
   (`refinanced_from_id`). Es lo que hace un prestamista con el cliente que no
   puede pagar, y hoy la única salida es inventar un préstamo suelto.
7. **Mora por día en vez de por cuota.** Hoy es un % fijo sobre la cuota
   vencida, no crece con el atraso. Muchos cobran por día. Sería una opción en
   configuración (`por_cuota` / `por_dia`) — ojo, toca `register_loan_payment` y
   `calculateLoanStatus`, que tienen que seguir dando el mismo número.
8. **Garantía, codeudor y documentos.** Foto de la cédula, contrato firmado,
   datos del garante. Hoy todo eso cabe solo en `notes`.
9. **Reportes del prestamista.** Antigüedad de cartera (1-30 / 31-60 / 61-90 /
   +90), tasa de recuperación, capital vs. interés cobrado en el mes, mora por
   cobrador. Reportes ya muestra el saldo total, pero no la salud de la cartera.

**Menor prioridad**

10. **Cargo de apertura** que se descuenta al desembolsar.
11. **Enlace del comprobante en el Portal del Cliente** — el portal ya muestra
    los préstamos; darle ahí el PDF le quita llamadas al negocio.
12. **Historial de cambios del préstamo** (quién lo creó, quién lo canceló).

---

## 6. Orden que propongo

1. El fallo de la caja (§4) — es un fallo, y de paso deja el terreno listo.
2. Comprobante por correo/WhatsApp/PDF (§3) — está acotado y es todo reúso.
3. Capital disponible (§2) — antes hay que cerrar las tres decisiones abiertas.
4. Ruta de cobro del día + recordatorio por WhatsApp (§5.1, §5.2).
5. Saldar por adelantado y cancelar (§5.3, §5.4).

Los puntos 1 a 3 son una tanda razonable; lo demás depende de qué tanto se apoya
el negocio en el módulo.
