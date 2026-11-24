// Contrato de Motopréstamos: los textos base, los marcadores y el llenado. Lógica
// pura (la usan Configuración para la vista previa y la página del contrato).
// Sin importaciones en tiempo de ejecución: los tests la cargan con node --test.

export type TipoContrato = 'venta' | 'prestamo';

export type Segmento = { tipo: 'texto'; texto: string } | { tipo: 'plan' };

export const MARCADORES: { clave: string; descripcion: string }[] = [
  { clave: 'empresa.nombre', descripcion: 'Nombre del negocio' },
  { clave: 'empresa.rnc', descripcion: 'RNC del negocio' },
  { clave: 'empresa.direccion', descripcion: 'Dirección del negocio' },
  { clave: 'empresa.telefono', descripcion: 'Teléfono del negocio' },
  { clave: 'cliente.nombre', descripcion: 'Nombre del cliente' },
  { clave: 'cliente.cedula', descripcion: 'Cédula del cliente' },
  { clave: 'cliente.direccion', descripcion: 'Dirección del cliente' },
  { clave: 'cliente.telefono', descripcion: 'Teléfono del cliente' },
  { clave: 'vehiculo.marca', descripcion: 'Marca' },
  { clave: 'vehiculo.modelo', descripcion: 'Modelo' },
  { clave: 'vehiculo.año', descripcion: 'Año' },
  { clave: 'vehiculo.color', descripcion: 'Color' },
  { clave: 'vehiculo.chasis', descripcion: 'Chasis' },
  { clave: 'vehiculo.motor', descripcion: 'Número de motor' },
  { clave: 'vehiculo.placa', descripcion: 'Placa' },
  { clave: 'vehiculo.matricula', descripcion: 'Número de matrícula' },
  { clave: 'monto', descripcion: 'Precio de la moto o monto prestado' },
  { clave: 'inicial', descripcion: 'Pago inicial (venta)' },
  { clave: 'cuotas', descripcion: 'Cantidad de cuotas' },
  { clave: 'frecuencia', descripcion: 'Frecuencia de las cuotas (semanales, mensuales…)' },
  { clave: 'cuota', descripcion: 'Monto de cada cuota' },
  { clave: 'tasa', descripcion: 'Interés con su unidad (5% mensual, 5% por cuota)' },
  { clave: 'total', descripcion: 'Total a pagar' },
  { clave: 'primera_cuota', descripcion: 'Fecha de la primera cuota' },
  { clave: 'fecha', descripcion: 'Fecha del contrato' },
  { clave: 'garantes', descripcion: 'Garantes del cliente (nombre, cédula y teléfono)' },
  { clave: 'plan', descripcion: 'Tabla de cuotas (número, fecha y monto)' },
];

const CONOCIDAS = new Set(MARCADORES.map((m) => m.clave));
// Todo lo que va entre llaves (sin saltos de línea) es un marcador: así se avisa
// también de los mal escritos ({monto1}, {cliente-nombre}). Espacios en los
// bordes y mayúsculas no cuentan.
const MARCADOR = /\{([^{}\n]+)\}/gu;
const claveDe = (crudo: string) => crudo.trim().toLowerCase();
const HUECO = '________';

const AVISO = 'Este es un modelo de referencia. Revíselo con su abogado antes de usarlo.';

const PARTES = `Entre {empresa.nombre}, RNC {empresa.rnc}, con domicilio en {empresa.direccion}, teléfono {empresa.telefono}`;
const CLIENTE = `y {cliente.nombre}, cédula {cliente.cedula}, con domicilio en {cliente.direccion}, teléfono {cliente.telefono}`;
const MOTO = `marca {vehiculo.marca}, modelo {vehiculo.modelo}, año {vehiculo.año}, color {vehiculo.color}, chasis {vehiculo.chasis}, motor {vehiculo.motor}, placa {vehiculo.placa}, matrícula {vehiculo.matricula}`;

export const CONTRATO_BASE: Record<TipoContrato, string> = {
  venta: `CONTRATO DE VENTA CONDICIONAL DE VEHÍCULO

${PARTES}, en lo adelante EL VENDEDOR; ${CLIENTE}, en lo adelante EL COMPRADOR, se ha convenido lo siguiente:

PRIMERO: EL VENDEDOR vende a EL COMPRADOR, bajo la modalidad de venta condicional, el vehículo ${MOTO}.

SEGUNDO: El precio de venta es de {monto}. EL COMPRADOR entrega un inicial de {inicial} y se obliga a pagar el resto en {cuotas} cuotas {frecuencia} de {cuota} cada una, con un interés de {tasa}, para un total de {total}. La primera cuota vence el {primera_cuota}, según el plan siguiente:

{plan}

TERCERO: La propiedad del vehículo queda reservada a EL VENDEDOR hasta el pago total del precio. La matrícula original queda en poder de EL VENDEDOR hasta ese pago.

CUARTO: Si EL COMPRADOR deja de pagar las cuotas en la forma convenida, EL VENDEDOR podrá recuperar el vehículo conforme a la ley.

QUINTO: Garantes solidarios: {garantes}.

Hecho y firmado en dos originales, en fecha {fecha}.


_________________________                _________________________
EL VENDEDOR                                        EL COMPRADOR

${AVISO}
`,
  prestamo: `CONTRATO DE PRÉSTAMO CON GARANTÍA DE VEHÍCULO

${PARTES}, en lo adelante EL ACREEDOR; ${CLIENTE}, en lo adelante EL DEUDOR, se ha convenido lo siguiente:

PRIMERO: EL ACREEDOR presta a EL DEUDOR la suma de {monto}, que EL DEUDOR declara haber recibido.

SEGUNDO: EL DEUDOR pagará {cuotas} cuotas {frecuencia} de {cuota} cada una, con un interés de {tasa}, para un total de {total}. La primera cuota vence el {primera_cuota}, según el plan siguiente:

{plan}

TERCERO: En garantía del pago, EL DEUDOR afecta el vehículo de su propiedad ${MOTO}, y entrega en custodia su matrícula original, que le será devuelta al saldar la deuda.

CUARTO: Si EL DEUDOR deja de pagar las cuotas en la forma convenida, EL ACREEDOR podrá ejecutar la garantía conforme a la ley.

QUINTO: Garantes solidarios: {garantes}.

Hecho y firmado en dos originales, en fecha {fecha}.


_________________________                _________________________
EL ACREEDOR                                          EL DEUDOR

${AVISO}
`,
};

/** Reemplaza cada {clave} conocida con su valor (o `________` si falta) y parte
 *  el texto donde va {plan}. Las claves desconocidas quedan como están. */
export function llenarContrato(plantilla: string, valores: Record<string, string | undefined>): Segmento[] {
  const segmentos: Segmento[] = [];
  let texto = '';
  let desde = 0;
  for (const m of plantilla.matchAll(MARCADOR)) {
    texto += plantilla.slice(desde, m.index);
    desde = (m.index ?? 0) + m[0].length;
    const clave = claveDe(m[1]);
    if (clave === 'plan') {
      if (texto) segmentos.push({ tipo: 'texto', texto });
      segmentos.push({ tipo: 'plan' });
      texto = '';
    } else if (CONOCIDAS.has(clave)) {
      texto += valores[clave]?.trim() || HUECO;
    } else {
      texto += m[0];
    }
  }
  texto += plantilla.slice(desde);
  if (texto) segmentos.push({ tipo: 'texto', texto });
  return segmentos;
}

/** Los {marcadores} que no existen, sin repetir, en el orden en que aparecen. */
export function marcadoresDesconocidos(plantilla: string): string[] {
  const vistos: string[] = [];
  for (const m of plantilla.matchAll(MARCADOR)) {
    if (!CONOCIDAS.has(claveDe(m[1])) && !vistos.includes(m[0])) vistos.push(m[0]);
  }
  return vistos;
}

const pesos = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });

/** RD$12,500.00, como formatCurrency; vacío si no hay monto. */
export function montoRD(n: number | undefined | null): string {
  return n == null || Number.isNaN(n) ? '' : pesos.format(n);
}

/** "Juana Pérez, cédula 001-…, tel. 809-…; Pedro Gómez". */
export function garantesComoTexto(garantes: { name: string; idDoc?: string; phone?: string }[]): string {
  return garantes
    .map((g) => [g.name.trim(), g.idDoc?.trim() ? `cédula ${g.idDoc.trim()}` : '', g.phone?.trim() ? `tel. ${g.phone.trim()}` : '']
      .filter(Boolean).join(', '))
    .join('; ');
}

/** La tasa con su unidad: "5% mensual" o "5% por cuota" (financiamiento con
 *  interés por cuota). Los préstamos usan tasa mensual. */
export function tasaComoTexto(tasa: number | undefined | null, modo?: 'monthly_prorated' | 'per_installment'): string {
  if (tasa == null || Number.isNaN(tasa)) return '';
  return `${tasa}% ${modo === 'per_installment' ? 'por cuota' : 'mensual'}`;
}
