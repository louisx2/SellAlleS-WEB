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
`financing_installments`, `ncf_sequences`

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

## Próximos pasos

1. Retirar `src/lib/database.ts` (resto del modo demo, ya sin usos activos).
2. Onboarding de empresas nuevas + panel Super Admin (suscripciones).
3. UI para gestionar `ncf_sequences` (hoy se cargan por SQL).
4. Deploy a Cloudflare (adaptador OpenNext) o Vercel.
5. Módulo de formalización DGII + e-CF (cuando la empresa lo active).
