# Modelo de datos multitenant (borrador)

Traducción del esquema SQL Server actual a PostgreSQL, agregando `tenant_id` a todo. Este es el borrador de arranque; se refina módulo por módulo contra las tablas reales de LhEs_Ventas antes de aplicar cada migración.

## Núcleo SaaS (Fase 1)

```sql
-- Empresas clientes del SaaS
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  rnc           text,                    -- para DGII
  razon_social  text,
  logo_url      text,
  plan          text not null default 'trial',  -- trial | basico | pro
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

-- Sucursales (equivale a GestionSucursales actual)
create table sucursales (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  nombre     text not null,
  direccion  text,
  telefono   text,
  activa     boolean not null default true
);

-- Perfil de usuario (Supabase Auth maneja credenciales; esto es el perfil)
create table usuarios (
  id         uuid primary key references auth.users(id),
  tenant_id  uuid not null references tenants(id),
  nombre     text not null,
  rol        text not null default 'cajero',  -- owner|admin|cajero|consulta
  activo     boolean not null default true
);

-- Equivale a UsuarioSucursal actual
create table usuario_sucursal (
  usuario_id  uuid references usuarios(id),
  sucursal_id uuid references sucursales(id),
  primary key (usuario_id, sucursal_id)
);

-- Secuencias de comprobantes fiscales (preparación DGII)
create table secuencias_ncf (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  tipo             text not null,   -- B01,B02,B04,B14,B15 / E31,E32,E34...
  prefijo          text not null,
  desde            bigint not null,
  hasta            bigint not null,
  proximo          bigint not null,
  vence_en         date,
  electronica      boolean not null default false,
  activa           boolean not null default true
);
```

## Catálogo e inventario (Fase 2)

```sql
create table categorias (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  nombre    text not null
);

create table productos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  categoria_id uuid references categorias(id),
  codigo       text,                -- código de barras / SKU
  nombre       text not null,
  descripcion  text,
  precio       numeric(12,2) not null default 0,
  costo        numeric(12,2) not null default 0,
  itbis_pct    numeric(5,2) not null default 18,  -- 18 | 16 | 0 (exento)
  imagen_url   text,
  activo       boolean not null default true
);

-- Stock POR SUCURSAL (como el sistema actual)
create table inventario (
  producto_id  uuid references productos(id),
  sucursal_id  uuid references sucursales(id),
  tenant_id    uuid not null references tenants(id),
  cantidad     numeric(12,2) not null default 0,
  minimo       numeric(12,2) not null default 0,
  ubicacion    text,               -- equivale a Ubicaciones actual
  primary key (producto_id, sucursal_id)
);

-- Transferencias entre sucursales (equivale a FrmTransferencias)
create table transferencias (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  sucursal_origen_id  uuid not null references sucursales(id),
  sucursal_destino_id uuid not null references sucursales(id),
  estado              text not null default 'solicitada', -- solicitada|enviada|recibida|cancelada
  solicitado_por      uuid references usuarios(id),
  creado_en           timestamptz not null default now()
);

create table transferencia_detalle (
  transferencia_id uuid references transferencias(id),
  producto_id      uuid references productos(id),
  cantidad         numeric(12,2) not null,
  primary key (transferencia_id, producto_id)
);
```

## Ventas y caja (Fase 3)

```sql
create table clientes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  nombre     text not null,
  cedula_rnc text,
  telefono   text,
  email      text,
  direccion  text,
  limite_credito numeric(12,2) default 0
);

-- Sesiones de caja (equivale a frm_AbrirCaja / cuadre)
create table cajas (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  sucursal_id  uuid not null references sucursales(id),
  abierta_por  uuid references usuarios(id),
  monto_inicial numeric(12,2) not null default 0,
  abierta_en   timestamptz not null default now(),
  cerrada_en   timestamptz,
  monto_cierre numeric(12,2)
);

create table facturas (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  sucursal_id  uuid not null references sucursales(id),
  caja_id      uuid references cajas(id),
  cliente_id   uuid references clientes(id),
  usuario_id   uuid references usuarios(id),
  -- fiscal
  tipo_comprobante text,           -- B01, B02... / E31, E32...
  ncf          text,
  ecf_track_id text,               -- reservado DGII e-CF
  ecf_estado   text,
  ecf_qr       text,
  -- montos (calculados en servidor)
  subtotal     numeric(12,2) not null,
  descuento    numeric(12,2) not null default 0,
  itbis        numeric(12,2) not null,
  total        numeric(12,2) not null,
  metodo_pago  text not null default 'efectivo', -- efectivo|tarjeta|transferencia|mixto|credito
  estado       text not null default 'emitida',  -- emitida|anulada|devuelta
  cotizacion_id uuid,              -- si vino de una cotización
  creado_en    timestamptz not null default now()
);

create table factura_detalle (
  id          uuid primary key default gen_random_uuid(),
  factura_id  uuid not null references facturas(id),
  tenant_id   uuid not null,
  producto_id uuid references productos(id),
  descripcion text not null,       -- snapshot del nombre al momento de venta
  cantidad    numeric(12,2) not null,
  precio      numeric(12,2) not null,  -- snapshot del precio
  descuento   numeric(12,2) not null default 0,
  itbis_pct   numeric(5,2) not null,
  total       numeric(12,2) not null
);
```

## Fases 4–5 (esbozo, se detalla al llegar)

- `cotizaciones`, `cotizacion_detalle`, `cotizacion_seguimiento` — estados y conversión a factura (patrón `PrecargarDesdeCotizacion` actual, match exacto por ID, respetando precios cotizados).
- `ventas_credito`, `credito_pagos` — saldo, plan de pagos, histórico (equivale a HistoricoPagosVentaCredito + Financiamiento).
- `ordenes_servicio` (reparaciones) + `citas` — flujo de estados y agenda.
- `pedidos`, `pedido_detalle` — replicar el patrón moderno del módulo Pedidos actual.
- `gastos`, `proveedores`.

## RLS — plantilla para TODAS las tablas de negocio

```sql
alter table productos enable row level security;

create policy tenant_isolation on productos
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

Reglas fijas del proyecto:

1. **Ninguna tabla de negocio sin RLS.** Se verifica con `get_advisors` de Supabase antes de cada release.
2. Los montos de facturas **siempre** se recalculan en el servidor (función SQL), nunca se confía en los enviados por el navegador.
3. El NCF se asigna dentro de una transacción con `select ... for update` sobre `secuencias_ncf` para no duplicar números.
