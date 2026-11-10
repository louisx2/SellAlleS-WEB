// Ganancia de un artículo, calculada SOBRE EL COSTO (markup): un teléfono que
// costó RD$1,000 con 30 % de ganancia se vende en RD$1,300 y deja RD$300.
// Es como lo dice el comerciante ("le quiero ganar el 30 %"), y es la misma
// cuenta en el formulario del producto, en las presentaciones y en Inventario.
//
// Si la sucursal vende con el ITBIS incluido y el producto lo lleva, el precio
// trae el impuesto adentro: la ganancia se calcula sobre el precio sin ITBIS
// (factorItbis), para no contar el impuesto como ganancia.
//
// Lógica pura y sin imports de valor: la prueban scripts/tests/margen.test.mjs
// con `node --test`.

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 1 + tasa si el precio trae el ITBIS adentro; 1 si no. */
export function factorItbis(itbisIncluido: boolean, aplicaItbis: boolean, tasa: number): number {
  return itbisIncluido && aplicaItbis ? 1 + tasa : 1;
}

/** Precio de venta para ganar `porcentaje` sobre el costo, en centavos. */
export function precioConGanancia(costo: number, porcentaje: number, factor = 1): number | null {
  if (!(costo > 0) || !Number.isFinite(porcentaje)) return null;
  return redondear2(costo * (1 + porcentaje / 100) * factor);
}

/** Cuánto se gana con ese precio: en dinero (por unidad) y en % del costo. */
export function gananciaDelPrecio(
  costo: number, precio: number, factor = 1,
): { monto: number; porcentaje: number } | null {
  if (!(costo > 0) || !Number.isFinite(precio) || precio < 0) return null;
  const neto = precio / factor;
  return { monto: redondear2(neto - costo), porcentaje: ((neto - costo) / costo) * 100 };
}

/** "30", "33.33": hasta dos decimales, sin ceros de relleno. */
export function formatoPorcentaje(n: number): string {
  return String(redondear2(n));
}
