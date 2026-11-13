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

/** Cómo se nombra cada dato dentro de una frase, y si es femenino (para decir
 *  "agrégala" o "agrégalo"). */
const EN_FRASE: Record<CampoCliente, { nombre: string; femenino: boolean }> = {
  address: { nombre: 'la dirección', femenino: true },
  phone: { nombre: 'el teléfono', femenino: false },
  email: { nombre: 'el correo', femenino: false },
};

/** "a", "a y b", "a, b y c". */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** Texto bajo la casilla: lo que se va a imprimir de ESTE cliente y, si le
 *  falta algún dato de los configurados, el aviso para que el cajero lo agregue
 *  antes de mandar al chofer sin la dirección. */
export function textoCasillaDatosCliente(customer: DatosDeContacto | undefined, campos: CampoCliente[]): string {
  const elegidos = CAMPOS_CLIENTE.filter((c) => campos.includes(c.campo)).map((c) => c.campo);
  const tiene = (campo: CampoCliente) => (customer?.[campo] ?? '').trim() !== '';
  const presentes = elegidos.filter(tiene);
  const faltan = elegidos.filter((campo) => !tiene(campo));

  let texto = `Para el chofer o mensajero: agrega ${enumerar(presentes.map((c) => EN_FRASE[c].nombre))} del cliente.`;
  if (faltan.length > 0) {
    const verbo = faltan.length === 1 ? 'Falta' : 'Faltan';
    const agregalo = faltan.length > 1 ? 'agrégalos' : EN_FRASE[faltan[0]].femenino ? 'agrégala' : 'agrégalo';
    texto += ` ${verbo} ${enumerar(faltan.map((c) => EN_FRASE[c].nombre))}: ${agregalo} en Clientes.`;
  }
  return texto;
}

/** El cliente tal como está en la base, si está en la lista; si no (el
 *  consumidor final, o una lista que aún no carga), el que se recibió. El
 *  carrito guarda una copia: si el cajero le agregó la dirección en Clientes
 *  después de elegirlo, la factura del chofer debe salir con ella. */
export function clienteVigente<T extends { id: string }>(customers: T[], seleccionado: T | undefined): T | undefined {
  if (!seleccionado) return undefined;
  return customers.find((c) => c.id === seleccionado.id) ?? seleccionado;
}
