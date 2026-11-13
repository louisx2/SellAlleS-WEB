// Datos del cliente que se imprimen en la factura a pedido: para el chofer que
// entrega (Comercial GP manda los electrodomésticos con un empleado y él
// necesita la dirección y el teléfono). La empresa elige en Ajustes qué datos
// salen; el cajero decide en cada venta si los incluye.
//
// Lo usan las pruebas con `node --test`: solo sintaxis TS borrable.

export type CampoCliente = 'address' | 'phone' | 'email';

/** Orden en que se ofrecen en Ajustes y se imprimen en la factura. */
export const CAMPOS_CLIENTE: ReadonlyArray<{ campo: CampoCliente; etiqueta: string }> = [
  { campo: 'address', etiqueta: 'Dirección' },
  { campo: 'phone', etiqueta: 'Teléfono' },
  { campo: 'email', etiqueta: 'Correo' },
];

/** Lo que venga de la base, limpio: solo campos conocidos, sin repetir, en el
 *  orden de la factura. */
export function normalizarCamposCliente(raw: unknown): CampoCliente[] {
  if (!Array.isArray(raw)) return [];
  return CAMPOS_CLIENTE.map((c) => c.campo).filter((campo) => raw.includes(campo));
}

type DatosDeContacto = { address?: string; phone?: string; email?: string };

/** Las líneas que lleva la factura: los datos elegidos que el cliente tiene.
 *  Un dato vacío no se imprime ("Dirección: " suelto no le sirve al chofer). */
export function lineasDatosCliente(
  customer: DatosDeContacto | undefined,
  campos: CampoCliente[],
): { etiqueta: string; valor: string }[] {
  if (!customer) return [];
  return CAMPOS_CLIENTE.filter((c) => campos.includes(c.campo))
    .map((c) => ({ etiqueta: c.etiqueta, valor: (customer[c.campo] ?? '').trim() }))
    .filter((l) => l.valor !== '');
}

/** La casilla del pago solo aparece si la empresa lo encendió y hay algo que
 *  imprimir de este cliente (el consumidor final no tiene dirección). */
export function puedeIncluirDatosCliente(
  enabled: boolean,
  campos: CampoCliente[],
  customer?: DatosDeContacto,
): boolean {
  return enabled && lineasDatosCliente(customer, campos).length > 0;
}
