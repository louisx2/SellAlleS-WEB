# SellAlleS — Backend Supabase (nube)

Proyecto en la nube. **La app ya usa este backend**: auth, providers de datos,
ventas con NCF automático y abonos de crédito están conectados.

## Conexión

- Project ref: `qwpjclqinruhtxgkrxwr`
- URL: `https://qwpjclqinruhtxgkrxwr.supabase.co`
- Clave publishable (segura, protegida por RLS): ya está en `.env.local`
- Región: us-east-1

## Modelo multi-empresa (multi-tenant)

Base de datos compartida con aislamiento por `company_id` vía Row Level Security (RLS).
Cada usuario solo ve y modifica datos de su propia empresa. Un `super_admin`
(dueño del SaaS) puede ver/gestionar todas las empresas.

Funciones helper (SECURITY DEFINER) usadas por las políticas:
- `current_company_id()` — empresa del usuario actual.
- `is_super_admin()` — si el usuario actual es administrador de la plataforma.

## Tablas

Plataforma (SaaS): `plans`, `companies`, `subscriptions`
Empresa (tenant): `branches`, `profiles`, `roles`, `customers`, `suppliers`,
`products`, `expenses`, `sales`, `sale_items`, `credit_payments`,
`financing_installments`, `ncf_sequences`, `supplier_invoices`,
`supplier_invoice_items`, `supplier_payments`

Todas las tablas tenant llevan `company_id` y tienen RLS activado.

## Formalización DGII (OPCIONAL)

Una empresa puede operar sin estar formalizada en DGII. Campos en `companies`:
- `rnc` (nullable) — RNC, solo si está formalizada.
- `is_formalized` (default false) — si está formalizada en DGII.
- `ncf_enabled` (default false) — si emite comprobantes fiscales (NCF/e-CF).

Mientras `ncf_enabled = false`, las ventas se registran sin NCF (`sales.ncf` queda
nulo). Al formalizarse, se activa `ncf_enabled`, se cargan las secuencias en
`ncf_sequences` y las ventas empiezan a emitir comprobantes.

## Planes sembrados

- Gratis (RD$0): 1 sucursal, 2 usuarios.
- Pro (RD$1,500): 3 sucursales, 10 usuarios, financiamiento.
- Empresarial (RD$4,500): ilimitado, e-CF DGII, soporte prioritario.

## Notas de seguridad (advisors)

Quedan 2 avisos WARN: `authenticated` puede ejecutar `current_company_id()` e
`is_super_admin()`. Es intencional y seguro: RLS las necesita y solo devuelven datos
del propio usuario. Si se quiere cero avisos, moverlas a un esquema `private` no
expuesto por la API.

## Asignación de NCF (migración `ncf_assignment_trigger`)

El trigger `trg_set_sale_ncf` (BEFORE INSERT en `sales`) llama a `assign_ncf`:
si la empresa tiene `ncf_enabled`, toma con lock (`FOR UPDATE`) la secuencia
activa de `ncf_sequences` que coincida con `tipo` = `ncf_type` de la venta
('consumer' o 'fiscal'), arma `prefix + número de 8 dígitos` (p. ej.
`B0200000001`) e incrementa el contador — todo dentro de la transacción del
insert, sin saltos ni duplicados. Si `ncf_enabled` es false, la venta queda
con `ncf` NULL. Para empezar a emitir: activar `ncf_enabled` en la empresa y
cargar filas en `ncf_sequences` (tipo 'consumer' prefix 'B02', tipo 'fiscal'
prefix 'B01', con su rango autorizado por DGII).

## Unidad de medida y cantidades decimales (migración `products_unit_of_measure`)

`products.unit` (text + CHECK, default `'und'`) define la unidad de medida del
producto y con ella si admite cantidades fraccionadas: las contables (`und`,
`caja`, `doc`, `par`, `rollo`, `saco`, `paq`) solo enteros; las medibles (`lb`,
`kg`, `g`, `oz`, `qq`, `m`, `pie`, `yd`, `plg`, `gal`, `l`, `ml`) hasta 3
decimales. Esa escala no es casual: `products.stock` y `sale_items.quantity`
ya eran `numeric(12,3)`, así que **la base siempre admitió decimales** — lo que
faltaba era el catálogo y desbloquear la captura en el cliente.

El catálogo vive en el código (`src/lib/units.ts`), no en una tabla editable;
el CHECK es red de seguridad. `sale_items.unit` y `quote_items.unit` guardan
una **copia** de la unidad al vender/cotizar (sin CHECK) para que un recibo
histórico se reimprima igual aunque el producto cambie de unidad o se elimine.

Reglas al tocar cantidades: toda aritmética pasa por `roundQty` (3 decimales,
la misma escala de la columna) y todo render por `formatQty`/`formatQuantity`.
`numeric(12,3)` redondea en silencio **antes** de que el trigger antisobreventa
lea `NEW.quantity`, así que si el cliente admitiera 4 decimales el stock
descontado no sería el mostrado.

⚠️ `create_sale_with_items` necesita castear `payment_method`, `payment_status`
y `ncf_type` a sus ENUM: el cuerpo de una función plpgsql no se valida al
crearla, así que omitir los casts solo revienta al vender (ver migración
`fix_create_sale_with_items_enum_casts`).

## Productos sin inventario (migración `products_without_stock`)

`products.tracks_stock` (default `true`). En `false` el producto no maneja
existencias — plato preparado, servicio, tarifa —: se vende siempre, no
descuenta stock y nunca aparece agotado. Su `stock` queda en 0 y no representa
mercancía, así que se excluye de la valorización de inventario y de las
alertas de bajo stock.

Cuatro puntos de la base lo respetan: el trigger `decrement_product_stock_for_sale_item`
(sale temprano, igual que con las líneas sin producto), `annul_sale` (no repone
lo que nunca se descontó), `handle_service_item_stock` y `create_supplier_invoice`
(no suman existencias). En el cliente hay que mirar `tracksStock` antes de
cualquier comparación contra `stock`.

Fase 1 de la idea de restaurante. La fase 2 son las **recetas**: vender una
hamburguesa descontaría 1 pan y 150 g de carne, mediante una tabla
producto→ingredientes; se construirá sobre esta misma bandera.

## Precios con ITBIS incluido (migración `branch_itbis_included`)

`branches.itbis_included` (default false) configura por sucursal si los
precios de venta ya traen el 18%: el POS desglosa el impuesto hacia adentro
(base = precio / 1.18) sin cambiar el total. En false, el ITBIS se suma
encima (comportamiento clásico). El modo se congela por venta en
`sales.itbis_included` para que los recibos históricos siempre desglosen
igual. El cálculo vive en el cliente (`useCart` en
`src/context/cart-provider.tsx`); `sales.subtotal` guarda siempre la base
sin impuesto y `sales.itbis_amount` el ITBIS, en ambos modos.

Se configura en Ajustes → "Impuestos de la sucursal actual"
(`src/components/company-profile/tax-settings-card.tsx`), con un diálogo para
el resto de las sucursales. La tarjeta solo aparece con el módulo POS o
Cotizaciones activo (son los únicos que cobran con ITBIS) y solo los
administradores pueden cambiar el modo.

## Caja por sucursal (migraciones `caja_por_sucursal` y `caja_por_sucursal_en_los_cobros`)

El control de efectivo se decide en dos niveles, y hacen falta los dos:

- `company_modules.caja` — si la EMPRESA ve el módulo (menú, `/caja`, ajustes).
- `branches.caja_enabled` — si ESA sucursal exige caja abierta para mover
  efectivo. Default `false`, que es lo que protege a las sucursales que ya
  existían: encender el módulo no les cambia la rutina de un día para otro.

Una empresa puede tener una sucursal con caja y otras sin ella (el caso de
Pujols Group). Por eso ningún cobro debe preguntar solo por el módulo: hacerlo
dejaba a las sucursales sin caja pidiendo abrir una que no usan y que ni
siquiera les aparece en el menú.

El criterio vive en `caja_blocks_cash(p_company_id, p_branch_id)`: bloquea si la
empresa usa caja **y** la sucursal la exige **y** no hay ninguna abierta. Sin
sucursal bloquea igual, porque no hay caja que comprobar. Lo consultan las RPC
`register_sale_payment`, `register_customer_payment`, `register_loan_payment`,
`register_supplier_payment` y `annul_sale` (devolución en efectivo). El trigger
`fn_require_open_caja_for_cash_sale` — ventas en efectivo y abonos iniciales en
efectivo — aplica el mismo criterio con sus propias comprobaciones, apoyado en
`branch_uses_caja()` y `has_open_caja()`.

En el navegador el mismo criterio sale de un solo sitio, `CajaProvider`
(`cashBlocked` y `branchUsesCaja`), para que ninguna pantalla pida caja donde la
sucursal no la usa.

## Cuentas por Pagar / Compras (migración `payables_module`)

Facturas de suplidores a nivel documento con los campos del Formato 606 de
DGII (tipo de gasto 01-11, NCF recibido, ITBIS facturado/retenido,
retención ISR, ISC, propina, forma de pago 01-07). Módulos configurables por
empresa: `payables` (el módulo) y `purchases` (flag: las líneas con
`product_id` suman `products.stock` al registrar la compra).

- `supplier_invoices` — `balance` es columna generada:
  `total - itbis_retenido - isr_retention_amount - amount_paid` (las
  retenciones se remiten a DGII, no al suplidor). `status`
  pending/partial/paid lo escriben SOLO las RPCs. NCF único por
  (company, supplier) vía índice parcial. RLS: INSERT exige
  `is_module_enabled(company_id, 'payables', false)`; DELETE solo con
  `amount_paid = 0`.
- RPC `create_supplier_invoice(...)` — valida suplidor/NCF/retenciones,
  calcula `total` en el servidor, inserta factura + items, suma stock si
  `purchases` está activo, y registra el pago inicial si `p_initial_payment > 0`.
- RPC `register_supplier_payment(p_invoice_id, p_amount, p_method,
  p_branch_id, p_notes, p_reference)` — lock de la factura, valida contra
  `balance`, actualiza `amount_paid`/`payment_date`/`status`. Con método
  `cash` donde la sucursal usa caja: exige caja abierta e inserta un
  `caja_movements` tipo 'out' ("Pago a suplidor: …") para que el cierre cuadre.
- Roles: el rol de sistema `admin` incluye el recurso `payables`
  (backfill + `seed_system_roles()` actualizado). `seed_system_roles` ya no es
  ejecutable vía REST (revoke en migración `payables_hardening`).
- El Formato 606 (TXT pipe-delimited) se genera en el cliente desde
  `src/lib/dgii-606.ts` + `/reports/compras-606`, solo para empresas con
  `is_formalized`.

## Motor de crédito y financiamiento (migración `credit_financing_engine`)

Los montos se calculan SIEMPRE en el servidor; el navegador solo propone
parámetros (tasa y cantidad de cuotas) y muestra estados.

- **`trg_before_sale_credit`** (BEFORE INSERT en `sales`, antes de `trg_set_sale_ncf`
  por orden alfabético): para ventas `credit`/`in_financing` exige cliente,
  valida `customers.credit_limit` (NULL = sin límite) con lock del cliente, y
  para financiamiento **recalcula** `financing_details` con interés simple
  mensual (`interés = principal × tasa% × cuotas`), guardando también
  `downPayment`. Si el límite se excede, la venta se rechaza con mensaje en
  español (llega al toast del POS).
- **`trg_after_sale_credit`** (AFTER INSERT en `sales`): sube
  `customers.credit_balance` (deuda = principal + interés para financiamiento;
  total − inicial para crédito) y genera las cuotas en `financing_installments`
  (vencimiento mensual desde la fecha de venta; la última cuota absorbe el
  redondeo para que la suma sea exacta).
- **RPC `register_sale_payment(sale_id, amount, method, branch_id, notes)`**
  (SECURITY INVOKER — RLS aplica): abono a una venta. En una transacción cobra
  primero la **mora** (`companies.late_fee_rate`% por cuota vencida, cargo
  único por cuota, persistida en `late_fee_paid` de cuota y abono), luego
  aplica capital FIFO a las cuotas, sube `sales.amount_paid` (solo capital),
  marca `paid` al saldar y baja `customers.credit_balance`. El usuario se
  captura en servidor (`auth.uid()`). Devuelve jsonb para el recibo de abono.
- **RPC `register_customer_payment(customer_id, amount, method, branch_id, notes)`**:
  abono a la deuda general; se aplica FIFO a las ventas `credit` abiertas del
  cliente y baja su balance.
- `companies.late_fee_rate` (default 5) y `companies.default_interest_rate`
  (default 3.5) se editan en Perfil de Empresa → "Crédito y Financiamiento".
- La mora exigible NO se materializa: se deriva al leer (cuota vencida ×
  tasa − ya cobrada), igual en SQL y en `calculateFinancingStatus` del cliente.
- `customers.credit_balance` solo lo escriben los triggers/RPCs; el mapper
  `customerToRow` ya no lo envía desde el navegador.

## Imágenes y transferencia (bucket `product-images`)

Un solo tenant con 240 fotos sin optimizar consumió **5.13 GB de transferencia
en 24 horas** — el cupo mensual entero del plan gratuito. El almacenamiento
nunca fue el problema (360 MB de 1 GB); lo fue el egress: la misma foto se
llegó a descargar 39 veces en un día. Con más tenants ese coste crece en
proporción, así que el gasto se ataca en cuatro capas más una red de seguridad.

**1. Nunca se sube el original.** `src/lib/image-optim.ts` redimensiona y
recomprime en el navegador antes de subir, y devuelve dos variantes:
`full` (1280 px, WebP q82) y `thumb` (400 px, WebP q72). Medido sobre una foto
de 12 MP: 1141 kB → 49 kB + 5 kB. Aplica la orientación EXIF al decodificar,
porque al recomprimir se pierde el metadato y si no las fotos de teléfono
quedan giradas para siempre.

**2. Cada pantalla pide la variante que le toca.** La grilla del POS y el
carrito usan `<ProductImage variant="thumb">`; el detalle y la edición usan la
grande. Aquí está el grueso del ahorro: la grilla dibuja recuadros de 200 px,
y pedir 400 px en vez de 3024 px son ~57× menos píxeles.

Las dos variantes se distinguen por el nombre — `{uuid}.webp` y
`{uuid}.thumb.webp` — así que no hizo falta ninguna columna nueva. Para las
fotos subidas antes de esto el thumb no existe: `ProductImage` baja una
escalera de miniatura → imagen grande → placeholder, de modo que el 404 no se
ve en pantalla.

**3. Caché de un año** (`cacheControl: '31536000'`). Es seguro porque cada URL
lleva un UUID irrepetible y se sube con `upsert: false`: si la foto cambia,
cambia la URL. Antes era una hora, y de ahí salían las descargas repetidas.
Los logos de sucursal son la excepción — se suben con `upsert` sobre un nombre
fijo — así que la URL guardada lleva `?v=<timestamp>` para poder cachearlos
fuerte sin que se quede pegado el logo viejo.

**4. El Service Worker cachea las fotos** (`public/sw.js`, regla 0).
La regla que salta `supabase.co` existe para no cachear auth ni consultas,
pero arrastraba también a las fotos, que son lo contrario: contenido inmutable
pedido decenas de veces al día. Van en una caché **aparte** y sin la versión
del build en el nombre (`sellalles-images-v1`), porque el `activate` borra toda
caché que no sea la del build actual: meterlas ahí habría vuelto a descargar el
catálogo entero en cada despliegue. Verificado en Chromium: la misma imagen se
descarga una sola vez y sobrevive a un despliegue nuevo.

**5. Red de seguridad en el servidor.** La migración
`20260903054459_limites_bucket_imagenes.sql` pone `file_size_limit` de 2 MB y
`allowed_mime_types` al bucket, que estaba sin ninguno de los dos (a diferencia
de `comprobantes`). La compresión vive en el navegador, y un cliente con la PWA
vieja en caché podría saltársela; esto lo corta del lado del servidor.
**Ya aplicada en producción** (el nombre del archivo lleva la misma versión con
la que quedó registrada, para que `db push` no la repita). Los objetos que ya
estaban subidos no se ven afectados: el límite solo rige para subidas nuevas.

### Poner al día lo ya subido

`scripts/optimizar-storage.mjs` arregla lo que se subió antes, en dos fases y
con simulacro por defecto (sin `--aplicar` no escribe nada):

    npm i --no-save sharp
    export SUPABASE_URL=https://qwpjclqinruhtxgkrxwr.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    node scripts/optimizar-storage.mjs recomprimir   # + --aplicar
    node scripts/optimizar-storage.mjs huerfanas     # + --aplicar

`recomprimir` reescribe cada foto a WebP + miniatura, repunta `products.image`
y borra el original. `huerfanas` borra lo que no referencia ningún producto ni
logo: a día de hoy son 23 fotos (21 MB) y 4 logos reemplazados (273 kB) — los
logos se acumulan porque `company-profile` mete un `Date.now()` en el nombre,
así que cada cambio deja atrás el anterior.

Ojo: si algún día se añade otra columna que apunte al bucket, hay que
registrarla en la lista `fuentes` del script o borrará archivos en uso. Hoy son
exactamente cinco: `products.image`, y `logo_url`/`ticket_logo_url` en
`companies` y `branches`.

## Próximos pasos

1. Retirar `src/lib/database.ts` (resto del modo demo, ya sin usos activos).
2. Onboarding de empresas nuevas + panel Super Admin (suscripciones).
3. UI para gestionar `ncf_sequences` (hoy se cargan por SQL).
4. Deploy a Cloudflare (adaptador OpenNext) o Vercel.
5. Módulo de formalización DGII + e-CF (cuando la empresa lo active).
