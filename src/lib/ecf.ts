// Lógica pura de la factura electrónica (e-CF) en la app. Sin dependencias de
// React ni de Supabase, y solo `import type`: las pruebas
// (`scripts/tests/ecf.test.mjs`) cargan este archivo directamente con Node,
// que quita los tipos pero no resuelve imports de valores.
import type { EcfDocumento, EcfEstado, NcfType } from './types';

// Nombre del tipo de comprobante tal como sale en el ticket.
export const ECF_NOMBRE: Record<number, string> = {
  31: 'Factura de Crédito Fiscal Electrónica',
  32: 'Factura de Consumo Electrónica',
  33: 'Nota de Débito Electrónica',
  34: 'Nota de Crédito Electrónica',
  44: 'Comprobante Electrónico para Regímenes Especiales',
  45: 'Comprobante Electrónico Gubernamental',
};

/** ¿Es un e-NCF? E + tipo (2 dígitos) + secuencia (10): 13 caracteres. La serie B no lo es. */
export function esEcf(ncf?: string | null): boolean {
  return /^E\d{12}$/.test(ncf ?? '');
}

/** Tipo (31, 32, 34…) que lleva un e-NCF en los dos dígitos que siguen a la E; undefined si no es e-NCF. */
export function tipoDeEncf(ncf?: string | null): number | undefined {
  return esEcf(ncf) ? Number((ncf as string).slice(1, 3)) : undefined;
}

// Cuando el tipo no está en ECF_NOMBRE (un documento sin tipo, que el mapper
// deja en 0): el ticket nunca debe imprimir "undefined".
const ECF_NOMBRE_GENERICO = 'Comprobante Fiscal Electrónico';

/** Nombre con que el ticket titula el comprobante de este e-NCF. */
export function nombreDeEncf(ncf?: string | null): string {
  const tipo = tipoDeEncf(ncf);
  return (tipo === undefined ? undefined : ECF_NOMBRE[tipo]) ?? ECF_NOMBRE_GENERICO;
}

/**
 * ¿Hay que impedir el cobro porque el comprobante electrónico no se podría
 * armar? El E31, E44 y E45 identifican al comprador y exigen su RNC (9 dígitos)
 * o cédula (11); sin ellos `assign_ncf` gastaría el número y el documento
 * terminaría en error_datos. Solo aplica con e-CF: la serie B sigue como hoy
 * (advertencia, sin bloquear).
 */
export function ecfFaltaRncCliente(ecfActiva: boolean, ncfType: NcfType, customerIdIsValid: boolean): boolean {
  const exigeComprador = ncfType === 'fiscal' || ncfType === 'gubernamental' || ncfType === 'regimen_especial';
  return ecfActiva && exigeComprador && !customerIdIsValid;
}

/**
 * El documento que vale hoy: el más reciente que nadie ha reemplazado. Un
 * documento rechazado que se vuelve a emitir queda con `reemplazadoPor`; el
 * nuevo ocupa su lugar. No altera la lista que recibe.
 */
export function documentoVigente(docs: EcfDocumento[]): EcfDocumento | undefined {
  let vigente: EcfDocumento | undefined;
  for (const d of docs) {
    if (d.reemplazadoPor) continue;
    if (!vigente || d.createdAt.getTime() > vigente.createdAt.getTime()) vigente = d;
  }
  return vigente;
}

const ETIQUETAS: Record<EcfEstado, { texto: string; tono: 'ok' | 'espera' | 'error' }> = {
  por_enviar:           { texto: 'Por enviar',                 tono: 'espera' },
  enviando:             { texto: 'Por enviar',                 tono: 'espera' },
  recibido:             { texto: 'En la DGII',                 tono: 'espera' },
  aceptado:             { texto: 'Aceptado',                   tono: 'ok' },
  aceptado_condicional: { texto: 'Aceptado con observaciones', tono: 'ok' },
  rechazado:            { texto: 'Rechazado',                  tono: 'error' },
  error_datos:          { texto: 'Con error',                  tono: 'error' },
  sin_cupo:             { texto: 'Sin cupo',                   tono: 'error' },
};

/** Texto y tono (color) con que se muestra un estado. */
export function ecfEstadoEtiqueta(e: EcfEstado): { texto: string; tono: 'ok' | 'espera' | 'error' } {
  return ETIQUETAS[e];
}

/** Estados que el servidor no reintenta solo: los resuelve una persona (el aviso, el filtro de Movimientos y el ticket los comparten). */
export const ECF_ESTADOS_CON_PROBLEMA: EcfEstado[] = ['rechazado', 'error_datos', 'sin_cupo'];

/** ¿Está el comprobante en un estado que pide a una persona corregir algo? Sin estado (venta sin e-CF) no. */
export function ecfConProblema(estado?: EcfEstado | null): boolean {
  return !!estado && ECF_ESTADOS_CON_PROBLEMA.includes(estado);
}

/**
 * ¿Es un problema que alguien tiene que resolver? Un comprobante con problemas
 * cuya venta se anuló ya no: annul_sale anula un rechazado sin nota de crédito y
 * deja el documento como estaba, y no queda nada que corregir. El aviso, el
 * filtro de Movimientos y el detalle comparten este criterio.
 */
export function cuentaComoProblemaEcf(estado: EcfEstado | null | undefined, ventaAnulada: boolean): boolean {
  return ecfConProblema(estado) && !ventaAnulada;
}

type VentaEmbebida = { cancelled_at?: string | null };

/**
 * Fila de ecf_documentos con su venta embebida: null en una nota de crédito (no
 * tiene sale_id). El cliente de Supabase tipa un embed sin esquema como lista
 * aunque sea muchos-a-uno, así que se acepta de las dos formas.
 */
export type FilaProblemaEcf = { estado: EcfEstado; sales?: VentaEmbebida | VentaEmbebida[] | null };

/** Cuántas de estas filas son un problema por resolver (ver `cuentaComoProblemaEcf`). */
export function contarProblemasEcf(filas: FilaProblemaEcf[]): number {
  return filas.filter((f) => {
    const venta = Array.isArray(f.sales) ? f.sales[0] : f.sales;
    return cuentaComoProblemaEcf(f.estado, !!venta?.cancelled_at);
  }).length;
}

export type ResultadoEcf = 'listo' | 'en_proceso' | 'con_problemas' | 'desconocido';

/**
 * Cómo quedó un comprobante después de reintentar, reemitir o reimprimir, para
 * decirle a quien pulsó el botón lo que de verdad pasó: "se sigue enviando" solo
 * vale mientras el servidor lo reintenta solo (por_enviar, enviando, recibido);
 * un rechazado, con error o sin cupo no avanza hasta que alguien lo resuelva.
 */
export function resultadoDeEcf(doc?: EcfDocumento | null): ResultadoEcf {
  if (!doc) return 'desconocido';
  if (ecfConProblema(doc.estado)) return 'con_problemas';
  if (doc.qrUrl) return 'listo';
  return doc.estado === 'por_enviar' || doc.estado === 'enviando' || doc.estado === 'recibido'
    ? 'en_proceso'
    : 'desconocido';
}

/** Se vuelve a enviar tal cual: faltaba un dato que ya se corrigió, o faltaba cupo. */
export function puedeReintentar(d: EcfDocumento): boolean {
  return d.estado === 'error_datos' || d.estado === 'sin_cupo';
}

/** La DGII lo rechazó: no se corrige, se emite uno nuevo que lo reemplaza. */
export function puedeReemitir(d: EcfDocumento): boolean {
  return d.estado === 'rechazado';
}

// ---------------------------------------------------------------------------
// Perfil → Facturación fiscal: secuencias E, certificado y corte de la serie B
// ---------------------------------------------------------------------------

/** Los seis tipos de comprobante que acepta `ncf_sequences_tipo_check`. */
export type TipoSecuencia = NcfType | 'nota_credito' | 'nota_debito';

/**
 * Prefijo de cada tipo en la serie E. Espeja `ncf_sequences_prefijo_e_check`:
 * una secuencia electrónica con otro prefijo la rechaza la base.
 */
export const TIPO_PREFIX_E: Record<TipoSecuencia, string> = {
  consumer: 'E32',
  fiscal: 'E31',
  nota_credito: 'E34',
  nota_debito: 'E33',
  regimen_especial: 'E44',
  gubernamental: 'E45',
};

/** Prefijo y número como los arma `assign_ncf`: 10 dígitos en la serie E, 8 en la B. */
export function formatearNcf(prefijo: string | null | undefined, numero: number, electronica: boolean): string {
  return `${prefijo ?? ''}${String(numero).padStart(electronica ? 10 : 8, '0')}`;
}

/** AAAA-MM-DD -> DD/MM/AAAA sin pasar por Date: así la zona horaria no corre el día. */
export function fechaDMA(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

/** Con cuántos días de margen se avisa que el certificado digital está por vencer. */
export const CERTIFICADO_AVISO_DIAS = 30;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Días que faltan desde `hoy` hasta `vence` (ambas AAAA-MM-DD); negativo si ya
 * venció, null si no hay fecha. Se calcula en UTC sobre las dos fechas, así que
 * no depende de la zona horaria ni del horario de verano.
 */
export function diasParaVencer(vence: string | null | undefined, hoy: string): number | null {
  if (!vence) return null;
  const dias = (Date.parse(`${vence}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / MS_POR_DIA;
  return Number.isFinite(dias) ? Math.round(dias) : null;
}

/** ¿Faltan 30 días o menos (o ya venció)? Sin fecha no hay nada que avisar. */
export function certificadoPorVencer(vence: string | null | undefined, hoy: string): boolean {
  const dias = diasParaVencer(vence, hoy);
  return dias !== null && dias <= CERTIFICADO_AVISO_DIAS;
}

/**
 * Por qué ya no se puede cargar una secuencia B. Sin e-CF es el mismo texto del
 * error que lanza `assign_ncf` desde la fecha de corte (con la fecha en
 * DD/MM/AAAA). Con e-CF activo no hay nada que activar: solo se dice que las
 * secuencias nuevas son E. Si no se pudo leer la fecha, se dice sin ella.
 */
export function avisoSerieB(corte: string | null | undefined, ecfActiva = false): string {
  if (ecfActiva) {
    return corte
      ? `La serie B dejó de ser válida el ${fechaDMA(corte)}. Las secuencias nuevas son E.`
      : 'La serie B ya no es válida. Las secuencias nuevas son E.';
  }
  const cuando = corte ? ` el ${fechaDMA(corte)}` : '';
  return `La serie B dejó de ser válida${cuando}. Para emitir comprobantes hay que activar la facturación electrónica.`;
}

/**
 * ¿Hay que pedir la fecha de vencimiento al cargar la secuencia? En la serie E,
 * todos menos el E32 (consumo) y el E34 (nota de crédito) la llevan en el
 * comprobante. Espeja `ncf_sequences_vencimiento_e_check`.
 */
export function secuenciaExigeVencimiento(electronica: boolean, tipo: TipoSecuencia): boolean {
  return electronica && tipo !== 'consumer' && tipo !== 'nota_credito';
}

/** El mayor número de secuencia que cabe en un e-NCF (10 dígitos). Espeja `ncf_sequences_rango_e_check`. */
export const SECUENCIA_E_MAXIMA = 9_999_999_999;

// ---------------------------------------------------------------------------
// Panel de SellAlleS: configuración por empresa y resumen de la plataforma
// ---------------------------------------------------------------------------

/** Los tres entornos de MSeller: `https://ecf.api.mseller.app/{TesteCF|CerteCF|eCF}`. */
export type AmbienteEcf = 'TesteCF' | 'CerteCF' | 'eCF';

export const ECF_AMBIENTES: AmbienteEcf[] = ['TesteCF', 'CerteCF', 'eCF'];

export const ECF_AMBIENTE_NOMBRE: Record<AmbienteEcf, string> = {
  TesteCF: 'Pruebas',
  CerteCF: 'Certificación',
  eCF: 'Producción',
};

/** Estado de `ecf_config.estado`: solo cambia con `ecf_cambiar_estado`. */
export type EstadoEcfConfig = 'preparacion' | 'activa' | 'suspendida';

export const ECF_ESTADO_CONFIG_NOMBRE: Record<EstadoEcfConfig, string> = {
  preparacion: 'En preparación',
  activa: 'Activa',
  suspendida: 'Suspendida',
};

/** Desde qué % del cupo mensual el resumen lo pone en rojo. */
export const CUPO_AVISO_PCT = 80;

/**
 * % del cupo que lleva usado (sin redondear: 79,6 % no es 80 %). Un cupo en 0
 * no deja usar nada: con uso está agotado, sin uso no hay nada que avisar.
 */
export function porcentajeDeUso(usado: number, cupo: number): number {
  if (!(cupo > 0)) return usado > 0 ? 100 : 0;
  return (usado / cupo) * 100;
}

/** El mayor % de uso entre los dos cupos de la empresa (comprobantes y requests); con él se ordena el resumen. */
export function mayorUsoDeCupo(
  comprobantes: number,
  cupoComprobantes: number,
  requests: number,
  cupoRequests: number,
): number {
  return Math.max(porcentajeDeUso(comprobantes, cupoComprobantes), porcentajeDeUso(requests, cupoRequests));
}

/** ¿Ya va por el 80 % del cupo o más? */
export function cupoPorAgotarse(pct: number): boolean {
  return pct >= CUPO_AVISO_PCT;
}

/** Atributo que ReceiptEcf pone en su bloque: "cargando" mientras dibuja el QR,
 *  "listo" cuando ya está, "error" si no se pudo. */
export const ECF_QR_ATRIBUTO = 'data-ecf-qr';

/** El QR del ticket se dibuja después de montar el recibo (la librería se
 *  importa al vuelo). Si el PDF o la impresión salen antes, salen sin QR. Esto
 *  espera a que ningún QR siga "cargando" dentro de `raiz`, como mucho
 *  `limiteMs`: pasado ese tiempo se sigue igual, porque un ticket sin QR es
 *  mejor que uno que no sale. Devuelve si alcanzó a estar listo. */
export async function esperarQrEcf(
  raiz: Pick<ParentNode, 'querySelector'> | null | undefined,
  limiteMs = 3000,
  cadaMs = 50,
): Promise<boolean> {
  if (!raiz) return true;
  const selector = `[${ECF_QR_ATRIBUTO}="cargando"]`;
  const inicio = Date.now();
  while (raiz.querySelector(selector)) {
    if (Date.now() - inicio >= limiteMs) return false;
    await new Promise((listo) => setTimeout(listo, cadaMs));
  }
  return true;
}

/** Qué nota de crédito sale al anular una venta, para avisarlo antes. Sigue la
 *  misma regla que `annul_sale`: depende del comprobante de la venta, no de
 *  `companies.ncf_enabled` (una empresa con e-CF puede tenerlo apagado, y una
 *  que apagó los NCF sigue anulando sus ventas con B con una B04). Un e-CF
 *  rechazado se anula sin nota: la DGII nunca lo aceptó. */
export function avisoNotaAlAnular(ncf: string | null | undefined, estadoEcf: EcfEstado | null | undefined): string {
  if (!ncf) return '';
  if (!esEcf(ncf)) {
    return ' Se emitirá una nota de crédito (B04) que referencia el NCF original: necesitas una secuencia B04 activa.';
  }
  if (estadoEcf === 'rechazado') return '';
  return ' Se emitirá una nota de crédito electrónica (E34) que referencia el e-NCF original.';
}
