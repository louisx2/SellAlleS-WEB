// Precio con y sin ITBIS de un producto, con la MISMA cuenta que hace la caja
// (context/cart-provider.tsx), para que el formulario nunca muestre un precio
// final distinto al que se cobra.
//
// El producto guarda un solo precio (2 decimales). Qué significa lo decide la
// sucursal:
//   - ITBIS encima   → el guardado es el precio SIN ITBIS; la caja suma
//                      round2(precio × tasa).
//   - ITBIS incluido → el guardado es el precio CON ITBIS; la caja saca
//                      round2(precio × tasa / (1 + tasa)) hacia adentro.
//
// Con 2 decimales y el ITBIS encima no todo precio final existe: 100.00 no lo
// da ningún precio base (84.75 cobra 100.01). Por eso el formulario muestra lo
// que sale de desglosarPrecio(), no lo que se escribió.
//
// Lógica pura y sin imports de valor: la prueba scripts/tests/precio-itbis.test.mjs.

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const valido = (n: number) => Number.isFinite(n) && n >= 0;

export type DesglosePrecio = { sinItbis: number; itbis: number; conItbis: number };

/** Del precio guardado a lo que cobra la caja por una unidad. */
export function desglosarPrecio(
  guardado: number, itbisIncluido: boolean, aplicaItbis: boolean, tasa: number,
): DesglosePrecio | null {
  if (!valido(guardado)) return null;
  const precio = redondear2(guardado);
  if (!aplicaItbis) return { sinItbis: precio, itbis: 0, conItbis: precio };
  if (itbisIncluido) {
    const itbis = redondear2((precio * tasa) / (1 + tasa));
    return { sinItbis: redondear2(precio - itbis), itbis, conItbis: precio };
  }
  const itbis = redondear2(precio * tasa);
  return { sinItbis: precio, itbis, conItbis: redondear2(precio + itbis) };
}

/** Precio a guardar cuando se escribe el precio CON ITBIS (producto que lo lleva). */
export function guardadoDesdeFinal(conItbis: number, itbisIncluido: boolean, tasa: number): number | null {
  if (!valido(conItbis)) return null;
  return redondear2(itbisIncluido ? conItbis : conItbis / (1 + tasa));
}

/** Precio a guardar cuando se escribe el precio SIN ITBIS (producto que lo lleva). */
export function guardadoDesdeBase(sinItbis: number, itbisIncluido: boolean, tasa: number): number | null {
  if (!valido(sinItbis)) return null;
  return redondear2(itbisIncluido ? sinItbis * (1 + tasa) : sinItbis);
}
