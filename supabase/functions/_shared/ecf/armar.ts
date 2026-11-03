// Armado del JSON del e-CF para MSeller (módulo puro: sin red ni base de datos).
//
// El JSON lleva los mismos nombres y la misma estructura que el XML de la DGII;
// MSeller lo convierte a XML y lo firma. Este archivo lo comparten la Edge
// Function (Deno) y las pruebas de `npm test` (Node), que lo cargan quitando
// los tipos: por eso solo usa sintaxis borrable (nada de enum, namespace ni
// parameter properties), sin APIs de Node ni de Deno y con imports `.ts`.

export type TipoEcf = 31 | 32 | 34 | 44 | 45;

export interface LineaEcf {
  nombre: string;
  cantidad: number;
  precio: number; // lo que se cobra por unidad (el descuento ya está dentro)
  itbis: boolean; // true: gravado al 18%; false: exento
  servicio: boolean;
}

export interface DatosEcf {
  tipo: TipoEcf;
  encf: string;
  fechaEmision: string; // 'YYYY-MM-DD', fecha local de la empresa
  vencimientoSecuencia?: string; // 'YYYY-MM-DD'; no aplica a 32 ni 34
  emisor: { rnc: string; razonSocial: string; nombreComercial?: string | null; direccion: string };
  comprador: { rnc: string; nombre: string } | null;
  itbisIncluido: boolean;
  aCredito: boolean;
  fechaLimitePago?: string; // 'YYYY-MM-DD'
  lineas: LineaEcf[];
  totalGuardado: number; // sales.total o credit_notes.total
  itbisGuardado: number; // sales.itbis_amount o credit_notes.itbis_amount
  referencia?: { encf: string; fechaEmision: string; masDe30Dias: boolean };
}

export type ResultadoArmado = { ok: true; json: Record<string, unknown> } | { ok: false; error: string };

export const ITBIS_TASA = 0.18;

// Mismo redondeo que el carrito (`round2` de src/lib/utils.ts).
const round2 = (n: number) => Math.round(n * 100) / 100;
const aCentavos = (n: number) => Math.round(n * 100);

const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const soloDigitos = (s: string) => s.replace(/\D/g, '');

// La DGII limita el nombre del renglón a 80 caracteres.
const MAX_NOMBRE_ITEM = 80;

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY', el formato de fecha de la DGII. */
export function aFechaDgii(ymd: string): string {
  if (!YMD.test(ymd)) throw new Error(`Fecha inválida (se esperaba AAAA-MM-DD): ${ymd}`);
  const [a, m, d] = ymd.split('-');
  return `${d}-${m}-${a}`;
}

/** Día calendario de un instante en la zona horaria de la empresa ('YYYY-MM-DD'). */
export function fechaLocal(iso: string, zona: string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

/** Líneas del comprobante a partir de las filas de `sale_items`. */
export function lineasDesdeItems(
  items: Array<{
    product_name: string;
    quantity: number;
    price: number;
    custom_price: number | null;
    itbis: boolean;
    es_servicio?: boolean | null;
  }>,
): LineaEcf[] {
  return items.map((it) => ({
    nombre: it.product_name,
    cantidad: it.quantity,
    // El precio cobrado manda: custom_price si existe, y si no el del producto.
    precio: it.custom_price ?? it.price,
    itbis: it.itbis,
    servicio: it.es_servicio === true,
  }));
}

/**
 * Arma el JSON que se manda a MSeller. Devuelve `ok: false` con el motivo si
 * faltan datos o si los totales armados no cuadran con lo guardado en la venta.
 */
export function armarEcf(d: DatosEcf): ResultadoArmado {
  const falla = (error: string): ResultadoArmado => ({ ok: false, error });

  const fechas: Array<[string, string | undefined]> = [
    ['de emisión', d.fechaEmision],
    ['de vencimiento de la secuencia', d.vencimientoSecuencia],
    ['límite de pago', d.fechaLimitePago],
    ['del comprobante modificado', d.referencia?.fechaEmision],
  ];
  for (const [nombre, valor] of fechas) {
    if (valor !== undefined && !YMD.test(valor)) {
      return falla(`La fecha ${nombre} no tiene el formato AAAA-MM-DD: ${valor}`);
    }
  }

  // El E32 y el E34 no llevan vencimiento de la secuencia; los demás sí.
  const llevaVencimiento = d.tipo !== 32 && d.tipo !== 34;
  const vencimiento = d.vencimientoSecuencia;
  if (llevaVencimiento && !vencimiento) {
    return falla('Falta la fecha de vencimiento de la secuencia del e-NCF.');
  }

  const referencia = d.referencia;
  if (d.tipo === 34 && !referencia) {
    return falla('La nota de crédito necesita la referencia al comprobante que modifica.');
  }

  const limitePago = d.fechaLimitePago;
  const llevaLimitePago = d.tipo === 31 && d.aCredito;
  if (llevaLimitePago && !limitePago) {
    return falla('Falta la fecha límite de pago de la factura a crédito.');
  }

  // Comprador: sin identificar solo se admite en el E32 y en el E34 (anula una
  // venta de consumo); el E31, E44 y E45 exigen RNC o cédula.
  const cliente = d.comprador;
  const rncCliente = cliente ? soloDigitos(cliente.rnc) : '';
  let comprador: Record<string, string>;
  if (cliente && rncCliente) {
    const nombre = cliente.nombre.trim();
    if (!nombre) return falla('Falta el nombre del cliente.');
    comprador = { RNCComprador: rncCliente, RazonSocialComprador: nombre };
  } else if (d.tipo === 32 || d.tipo === 34) {
    comprador = { RNCComprador: '00000000000', RazonSocialComprador: 'Consumidor Final' };
  } else {
    return falla(`El e-CF tipo ${d.tipo} necesita el RNC del cliente.`);
  }

  if (d.lineas.length === 0) return falla('El comprobante no tiene líneas.');
  for (const l of d.lineas) {
    const valido =
      Number.isFinite(l.cantidad) && l.cantidad > 0 && Number.isFinite(l.precio) && l.precio >= 0;
    if (!valido) return falla(`La línea "${l.nombre}" tiene una cantidad o un precio inválido.`);
  }

  // Renglones y sumas brutas (los precios tal cual se cobran).
  let brutoGravado = 0;
  let brutoExento = 0;
  const items = d.lineas.map((l, i) => {
    const monto = round2(l.cantidad * l.precio);
    if (l.itbis) brutoGravado += monto;
    else brutoExento += monto;
    return {
      NumeroLinea: i + 1,
      IndicadorFacturacion: l.itbis ? 1 : 4,
      NombreItem: (l.nombre.trim() || 'Artículo').slice(0, MAX_NOMBRE_ITEM),
      IndicadorBienoServicio: l.servicio ? 2 : 1,
      CantidadItem: l.cantidad,
      // Con ITBIS incluido el precio y el monto de la línea ya traen el impuesto.
      PrecioUnitarioItem: l.precio,
      MontoItem: monto,
    };
  });
  brutoGravado = round2(brutoGravado);
  brutoExento = round2(brutoExento);

  const hayGravado = d.lineas.some((l) => l.itbis);
  const hayExento = d.lineas.some((l) => !l.itbis);

  // Misma regla que el carrito (cart-provider.tsx): el ITBIS se calcula sobre
  // el total gravado, no línea por línea.
  const itbis = d.itbisIncluido
    ? round2((brutoGravado * ITBIS_TASA) / (1 + ITBIS_TASA))
    : round2(brutoGravado * ITBIS_TASA);
  const baseGravada = d.itbisIncluido ? round2(brutoGravado - itbis) : brutoGravado;
  const montoTotal = round2(baseGravada + itbis + brutoExento);

  // Cuadre en centavos (restar decimales deja ruido: 168.01 - 168 > 0.01).
  const cuadra = (armado: number, guardado: number) => Math.abs(aCentavos(armado) - aCentavos(guardado)) <= 1;
  if (!cuadra(montoTotal, d.totalGuardado)) {
    return falla(`El total del e-CF (${montoTotal}) no cuadra con el total guardado (${d.totalGuardado}).`);
  }
  if (!cuadra(itbis, d.itbisGuardado)) {
    return falla(`El ITBIS del e-CF (${itbis}) no cuadra con el ITBIS guardado (${d.itbisGuardado}).`);
  }

  // Las claves de monto gravado e ITBIS solo van si hay líneas gravadas, y
  // MontoExento solo si hay exentas.
  const totales: Record<string, number> = {};
  if (hayGravado) {
    totales.MontoGravadoTotal = baseGravada;
    totales.MontoGravadoI1 = baseGravada;
  }
  if (hayExento) totales.MontoExento = brutoExento;
  if (hayGravado) {
    totales.ITBIS1 = Math.round(ITBIS_TASA * 100);
    totales.TotalITBIS = itbis;
    totales.TotalITBIS1 = itbis;
  }
  totales.MontoTotal = montoTotal;

  // Las claves van en el orden del esquema de la DGII.
  const idDoc: Record<string, unknown> = { TipoeCF: d.tipo, eNCF: d.encf };
  if (llevaVencimiento && vencimiento) idDoc.FechaVencimientoSecuencia = aFechaDgii(vencimiento);
  if (d.tipo === 34 && referencia) idDoc.IndicadorNotaCredito = referencia.masDe30Dias ? 1 : 0;
  // Sin líneas gravadas no hay precio al que "incluirle" el ITBIS.
  idDoc.IndicadorMontoGravado = d.itbisIncluido && hayGravado ? 1 : 0;
  idDoc.TipoIngresos = '01';
  idDoc.TipoPago = d.aCredito ? 2 : 1;
  if (llevaLimitePago && limitePago) idDoc.FechaLimitePago = aFechaDgii(limitePago);

  const emisor: Record<string, string> = {
    RNCEmisor: soloDigitos(d.emisor.rnc),
    RazonSocialEmisor: d.emisor.razonSocial,
  };
  const nombreComercial = d.emisor.nombreComercial?.trim();
  if (nombreComercial) emisor.NombreComercial = nombreComercial;
  emisor.DireccionEmisor = d.emisor.direccion;
  emisor.FechaEmision = aFechaDgii(d.fechaEmision);

  const ecf: Record<string, unknown> = {
    Encabezado: {
      Version: '1.0',
      IdDoc: idDoc,
      Emisor: emisor,
      Comprador: comprador,
      Totales: totales,
    },
    DetallesItems: { Item: items },
  };
  if (d.tipo === 34 && referencia) {
    ecf.InformacionReferencia = {
      NCFModificado: referencia.encf,
      FechaNCFModificado: aFechaDgii(referencia.fechaEmision),
      CodigoModificacion: 1, // anulación total
    };
  }
  ecf.FechaHoraFirma = ''; // la pone MSeller al firmar

  return { ok: true, json: { ECF: ecf } };
}
