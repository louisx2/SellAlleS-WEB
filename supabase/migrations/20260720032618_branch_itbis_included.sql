-- Precios con ITBIS incluido, configurable por sucursal.
-- false (default) = comportamiento actual: precio + 18% encima.
-- true = el precio ya trae el ITBIS; el impuesto se desglosa "hacia adentro"
--        (base = precio / 1.18) y el total no cambia.

alter table public.branches add column itbis_included boolean not null default false;

-- El modo se congela en cada venta para que los recibos históricos siempre
-- se impriman con el desglose correcto, aunque la sucursal cambie de modo.
alter table public.sales add column itbis_included boolean not null default false;
