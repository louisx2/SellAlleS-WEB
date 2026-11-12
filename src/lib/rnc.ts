// RNC y cédula en la app: dígito verificador, llenado en cascada de un cliente con
// lo que trae la DGII y búsqueda de un cliente por su documento.
//
// El dígito verificador es una copia del de supabase/functions/_shared/dgii/rnc.ts
// (la app no puede importar supabase/: tsconfig lo excluye). Una prueba de
// `npm test` comprueba que los dos dan lo mismo. Node carga este archivo quitando
// los tipos: solo puede tener `import type`.

import type { NcfType } from './types';

/** Lo que trae la DGII de un RNC o una cédula (igual a `DatosDgii` del servidor). */
export interface DatosRnc {
  rnc: string;
  razonSocial: string;
  nombreComercial: string;
  categoria: string;
  regimenPagos: string;
  estado: string;
  actividadEconomica: string;
  administracionLocal: string;
  facturadorElectronico: boolean;
}

/** La respuesta de la función `dgii-rnc` (igual a `RespuestaRnc` del servidor). */
export type RespuestaRnc =
  | { ok: true; encontrado: true; datos: DatosRnc; consultadoAt: string; desactualizado: boolean }
  | { ok: true; encontrado: false }
  | { ok: false; motivo: 'documento_invalido' | 'dgii_no_responde' };

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

const mismoNombre = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Qué hacer con el campo de nombre cuando la DGII trae una razón social. Se llena
 * si está vacío, o si lo que tiene lo puso la DGII con un RNC anterior
 * (`nombreAutomatico`): al corregir el RNC no puede quedar el nombre de otra
 * empresa. Si lo escribió el usuario, solo se ofrece.
 */
export function cascadaNombre(
  razonSocial: string,
  nombre: string,
  nombreAutomatico: string | undefined,
): { nombre?: string; ofrecerNombre?: string } {
  const razon = razonSocial.trim();
  if (!razon) return {};
  const llenadoSolo = !nombre.trim() || (!!nombreAutomatico && mismoNombre(nombre, nombreAutomatico));
  if (mismoNombre(nombre, razon)) return {};
  return llenadoSolo ? { nombre: razon } : { ofrecerNombre: razon };
}

/**
 * Qué llenar en el formulario de cliente con lo que trajo la DGII: el nombre con
 * la regla de `cascadaNombre`, y el tipo de comprobante a crédito fiscal solo con
 * un RNC (no una cédula) activo que estaba en consumidor final (otro tipo lo
 * eligió alguien a propósito). Si el RNC es el que el cliente ya tenía guardado
 * (se abrió "Editar cliente"), el tipo no se toca: nadie escribió nada.
 */
export function cascadaCliente(
  datos: DatosRnc,
  actual: { nombre: string; ncfType: NcfType; nombreAutomatico?: string; rncGuardado?: string },
): { nombre?: string; ofrecerNombre?: string; ncfType?: NcfType } {
  const r: { nombre?: string; ofrecerNombre?: string; ncfType?: NcfType } = cascadaNombre(
    datos.razonSocial,
    actual.nombre,
    actual.nombreAutomatico,
  );
  const yaGuardado = !!actual.rncGuardado && digitosDeDocumento(actual.rncGuardado) === datos.rnc;
  if (!yaGuardado && datos.rnc.length === 9 && datos.estado === 'ACTIVO' && actual.ncfType === 'consumer') {
    r.ncfType = 'fiscal';
  }
  return r;
}

/** El cliente con ese documento, comparando solo los dígitos ("130-86234-6" = "130862346"). */
export function buscarClientePorDocumento<T extends { rnc?: string | null }>(clientes: T[], documento: string): T | undefined {
  const buscado = digitosDeDocumento(documento);
  if (!buscado) return undefined;
  return clientes.find((c) => digitosDeDocumento(c.rnc ?? '') === buscado);
}

/** ¿La respuesta pedida para `pedido` todavía corresponde al campo, que ahora vale `actual`? */
export function respuestaVigente(pedido: string, actual: string): boolean {
  const p = digitosDeDocumento(pedido);
  return p !== '' && p === digitosDeDocumento(actual);
}

/**
 * ¿Se aplica una respuesta de la DGII que acaba de llegar? Solo si el campo
 * sigue en pantalla (si el diálogo se cerró, no puede llenar el que se abra
 * después) y todavía tiene el documento consultado.
 */
export function respuestaAplicable(montado: boolean, pedido: string, actual: string): boolean {
  return montado && respuestaVigente(pedido, actual);
}

/**
 * Qué hace el campo de RNC con lo que tiene escrito (en dígitos), sabiendo cuál
 * fue el último documento que consultó:
 *  - 'limpiar': incompleto o vacío; la línea de estado se borra al instante, para
 *    que no quede debajo el resultado de otro documento.
 *  - 'invalido': completo, pero no pasa el dígito verificador.
 *  - 'mantener': es el que ya se consultó; se deja lo que dice.
 *  - 'consultar': un documento nuevo completo y válido.
 */
export function accionDeCampo(digitos: string, consultado: string): 'limpiar' | 'invalido' | 'mantener' | 'consultar' {
  if (digitos.length !== 9 && digitos.length !== 11) return 'limpiar';
  if (!documentoValido(digitos)) return 'invalido';
  if (digitos === consultado) return 'mantener';
  return 'consultar';
}

/**
 * ¿Es un identificador que no es dominicano (un suplidor del exterior)? Con letras
 * o con más de 11 dígitos no se le aplica el formato de RNC: se guarda tal cual.
 */
export function esDocumentoExtranjero(texto: string): boolean {
  return /[a-z]/i.test(texto ?? '') || digitosDeDocumento(texto).length > 11;
}

/**
 * Lo que le falta a un cliente para guardarse, o null. El nombre siempre; el
 * teléfono, solo si no tiene RNC o cédula completos (al que se crea desde el
 * carrito con su RNC no se le pide teléfono, y editarlo después no debe trabarse).
 */
export function faltanDatosCliente(nombre: string, telefono: string, rnc: string): 'nombre' | 'telefono' | null {
  if (!nombre.trim()) return 'nombre';
  const d = digitosDeDocumento(rnc);
  if (!telefono.trim() && d.length !== 9 && d.length !== 11) return 'telefono';
  return null;
}

/**
 * Qué hace "RNC del comprador" con el documento escrito:
 *  - 'existente': ya es de un cliente; se pone ese en el carrito.
 *  - 'elegir': el carrito tiene un cliente real sin RNC; el cajero elige entre
 *    guardárselo a ese cliente (lo normal) o crear otro (la factura es para otra
 *    persona o empresa).
 *  - 'crear': no hay cliente en el carrito (consumidor final); se crea uno.
 */
export function destinoDelComprador(existente: unknown, clienteCarrito: unknown): 'existente' | 'elegir' | 'crear' {
  if (existente) return 'existente';
  if (clienteCarrito) return 'elegir';
  return 'crear';
}

// Palabras que no dicen de quién es un nombre: tipos de sociedad y artículos.
const PALABRAS_VACIAS = new Set(['srl', 'eirl', 'sas', 'sac', 'cxa', 'del', 'las', 'los', 'por']);

function palabrasDeNombre(texto: string): string[] {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !PALABRAS_VACIAS.has(p));
}

/**
 * ¿El nombre del cliente y la razón social que trae la DGII comparten alguna
 * palabra? Si no, se avisa antes de guardarle el RNC: puede ser un RNC mal
 * escrito o la factura de otra empresa. Si uno de los dos no tiene palabras que
 * comparar (vacío, iniciales), no se avisa.
 */
export function nombresParecidos(nombre: string, razonSocial: string): boolean {
  const a = palabrasDeNombre(nombre);
  const b = new Set(palabrasDeNombre(razonSocial));
  if (a.length === 0 || b.size === 0) return true;
  return a.some((p) => b.has(p));
}
