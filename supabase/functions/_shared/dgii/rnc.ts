// Consulta de un RNC o una cédula en la página pública de la DGII (módulo puro:
// recibe `fetch` como parámetro, así las pruebas lo reemplazan por uno falso).
//
// La DGII no tiene API: la página `rnc.aspx` es un formulario de ASP.NET. Se
// hace lo mismo que el navegador: un GET para sacar los campos ocultos y la
// cookie, y un POST asíncrono (UpdatePanel) con el documento. La respuesta trae
// la tabla `cphMain_dvDatosContribuyentes`, o un mensaje en `cphMain_lblInformacion`.
// Es lo mismo que hacen las librerías que usa el POS de escritorio LHES.
//
// Lo comparten la Edge Function `dgii-rnc` (Deno) y las pruebas de `npm test`
// (Node), que lo cargan quitando los tipos: solo sintaxis borrable, sin APIs de
// Node ni de Deno y con imports `.ts`.

export const URL_CONSULTA_RNC = 'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx';

const PLAZO_MS = 10_000;
const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36';

export interface DatosDgii {
  rnc: string; // solo dígitos
  razonSocial: string;
  nombreComercial: string;
  categoria: string;
  regimenPagos: string;
  estado: string; // ACTIVO, SUSPENDIDO, DADO DE BAJA...
  actividadEconomica: string;
  administracionLocal: string;
  facturadorElectronico: boolean;
}

export type LecturaDgii = { encontrado: true; datos: DatosDgii } | { encontrado: false };

/** La DGII no respondió o devolvió algo que no se reconoce (cambió la página, error suyo). */
export class ErrorDgii extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDgii';
  }
}

// ---------------------------------------------------------------------------
// Dígito verificador
// ---------------------------------------------------------------------------

export function digitosDeDocumento(texto: string): string {
  return (texto ?? '').replace(/\D/g, '');
}

const PESOS_RNC = [7, 9, 8, 6, 5, 4, 3, 2];

function rncValido(d: string): boolean {
  let suma = 0;
  for (let i = 0; i < 8; i++) suma += Number(d[i]) * PESOS_RNC[i];
  const resto = suma % 11;
  const verificador = resto === 0 ? 2 : resto === 1 ? 1 : 11 - resto;
  return verificador === Number(d[8]);
}

// Luhn sobre los 10 primeros dígitos, con pesos 1, 2, 1, 2...
function cedulaValida(d: string): boolean {
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    let p = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    if (p > 9) p -= 9;
    suma += p;
  }
  return (10 - (suma % 10)) % 10 === Number(d[10]);
}

/** 9 dígitos con el verificador del RNC, u 11 que pasan Luhn (cédula). */
export function documentoValido(digitos: string): boolean {
  if (!/^\d+$/.test(digitos ?? '')) return false;
  if (digitos.length === 9) return rncValido(digitos);
  if (digitos.length === 11) return cedulaValida(digitos);
  return false;
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

export interface CamposFormulario {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
}

function campoOculto(html: string, id: string): string {
  const m = html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`)) ?? html.match(new RegExp(`value="([^"]*)"[^>]*id="${id}"`));
  return m ? m[1] : '';
}

export function camposDelFormulario(html: string): CamposFormulario {
  const campos = {
    viewState: campoOculto(html, '__VIEWSTATE'),
    viewStateGenerator: campoOculto(html, '__VIEWSTATEGENERATOR'),
    eventValidation: campoOculto(html, '__EVENTVALIDATION'),
  };
  if (!campos.viewState || !campos.viewStateGenerator || !campos.eventValidation) {
    throw new ErrorDgii('La página de consulta de la DGII no trae el formulario esperado.');
  }
  return campos;
}

export function cuerpoDeConsulta(digitos: string, campos: CamposFormulario): URLSearchParams {
  const b = new URLSearchParams();
  b.set('ctl00$smMain', 'ctl00$cphMain$upBusqueda|ctl00$cphMain$btnBuscarPorRNC');
  b.set('ctl00$cphMain$txtRNCCedula', digitos);
  b.set('ctl00$cphMain$txtRazonSocial', '');
  // Sin la pestaña activa la DGII responde "Ocurrió un error al intentar realizar la búsqueda".
  b.set('ctl00$cphMain$hidActiveTab', 'rnc');
  b.set('__EVENTTARGET', '');
  b.set('__EVENTARGUMENT', '');
  b.set('__VIEWSTATE', campos.viewState);
  b.set('__VIEWSTATEGENERATOR', campos.viewStateGenerator);
  b.set('__EVENTVALIDATION', campos.eventValidation);
  b.set('__ASYNCPOST', 'true');
  b.set('ctl00$cphMain$btnBuscarPorRNC', 'BUSCAR');
  return b;
}

// ---------------------------------------------------------------------------
// Respuesta
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** El carácter de una entidad numérica; si no es un código válido, la entidad queda tal cual. */
function caracter(codigo: number, original: string): string {
  return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : original;
}

function decodificar(texto: string): string {
  return texto
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => caracter(Number(n), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => caracter(parseInt(h, 16), m))
    .replace(/&([a-z]+);/gi, (m, nombre) => ENTIDADES[nombre.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** El rótulo de la fila, sin tildes, en minúsculas y sin espacios de más. */
function rotulo(texto: string): string {
  return decodificar(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/');
}

const CAMPOS: Record<string, keyof Omit<DatosDgii, 'facturadorElectronico'> | 'facturador'> = {
  'cedula/rnc': 'rnc',
  'nombre/razon social': 'razonSocial',
  'nombre comercial': 'nombreComercial',
  categoria: 'categoria',
  'regimen de pagos': 'regimenPagos',
  estado: 'estado',
  'actividad economica': 'actividadEconomica',
  'administracion local': 'administracionLocal',
  'facturador electronico': 'facturador',
};

export function leerRespuesta(texto: string): LecturaDgii {
  const tabla = (texto ?? '').match(/id="cphMain_dvDatosContribuyentes"[\s\S]*?<\/table>/);
  if (tabla) {
    const valores: Record<string, string> = {};
    const fila = /<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
    let m: RegExpExecArray | null;
    while ((m = fila.exec(tabla[0])) !== null) {
      const clave = CAMPOS[rotulo(m[1])];
      if (clave) valores[clave] = decodificar(m[2]);
    }
    const rnc = digitosDeDocumento(valores.rnc ?? '');
    if (rnc) {
      const nombreComercial = valores.nombreComercial ?? '';
      return {
        encontrado: true,
        datos: {
          rnc,
          razonSocial: valores.razonSocial || nombreComercial,
          nombreComercial,
          categoria: valores.categoria ?? '',
          regimenPagos: valores.regimenPagos ?? '',
          estado: (valores.estado ?? '').toUpperCase(),
          actividadEconomica: valores.actividadEconomica ?? '',
          administracionLocal: valores.administracionLocal ?? '',
          facturadorElectronico: (valores.facturador ?? '').toUpperCase() === 'SI',
        },
      };
    }
  }

  const aviso = (texto ?? '').match(/id="cphMain_lblInformacion"[^>]*>([\s\S]*?)<\/span>/);
  const mensaje = aviso ? decodificar(aviso[1]) : '';
  if (/no se encuentra inscrito/i.test(mensaje)) return { encontrado: false };
  throw new ErrorDgii(mensaje ? `La DGII respondió: ${mensaje}` : 'La DGII devolvió una respuesta que no se reconoce.');
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

/** `name=value` de cada Set-Cookie, juntos para el encabezado Cookie. */
function cookiesDe(r: Response): string {
  const h = r.headers as Headers & { getSetCookie?: () => string[] };
  const lista = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [];
  const crudas = lista.length > 0 ? lista : (r.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/);
  return crudas
    .map((c) => c.split(';')[0].trim())
    .filter((c) => c.includes('='))
    .join('; ');
}

const sinRespuesta = (e: unknown) =>
  new ErrorDgii(`Sin respuesta de la DGII (${e instanceof Error ? e.message : String(e)}).`);

/** Un pedido a la página de consulta. Cualquier fallo, también al leer el cuerpo, sale como ErrorDgii. */
async function pedir(f: typeof fetch, init: RequestInit, plazo: AbortSignal): Promise<{ r: Response; texto: string }> {
  let r: Response;
  try {
    r = await f(URL_CONSULTA_RNC, { ...init, signal: plazo });
  } catch (e) {
    throw sinRespuesta(e);
  }
  if (!r.ok) throw new ErrorDgii(`La DGII respondió ${r.status}.`);
  try {
    return { r, texto: await r.text() };
  } catch (e) {
    throw sinRespuesta(e);
  }
}

/**
 * Consulta el documento (solo dígitos) en la DGII. Lanza ErrorDgii si no responde
 * o no se reconoce. Las dos llamadas comparten un solo plazo de 10 segundos.
 */
export async function consultarDgii(digitos: string, f: typeof fetch): Promise<LecturaDgii> {
  const plazo = AbortSignal.timeout(PLAZO_MS);
  const formulario = await pedir(f, { method: 'GET', headers: { 'User-Agent': AGENTE } }, plazo);
  const campos = camposDelFormulario(formulario.texto);
  const cookie = cookiesDe(formulario.r);

  const encabezados: Record<string, string> = {
    'User-Agent': AGENTE,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-MicrosoftAjax': 'Delta=true',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: URL_CONSULTA_RNC,
  };
  if (cookie) encabezados.Cookie = cookie;

  const respuesta = await pedir(
    f,
    { method: 'POST', headers: encabezados, body: cuerpoDeConsulta(digitos, campos).toString() },
    plazo,
  );
  return leerRespuesta(respuesta.texto);
}
