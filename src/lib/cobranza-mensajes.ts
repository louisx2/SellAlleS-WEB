// Motopréstamos 3B: los mensajes de WhatsApp de la cobranza (avisos de cuota y
// recibos de abono). Plantillas con marcadores {…}, como el contrato; la empresa
// las cambia en Configuración → General y, vacías, se usa el texto base.
// Lógica pura. Pruebas: scripts/tests/cobranza.test.mjs

export const AVISO_BASE =
  'Hola {cliente}, le recordamos que su cuota de {monto} {estado}. Gracias por mantenerse al día. {empresa}';

export const RECIBO_BASE =
  'Hola {cliente}, recibimos su pago de {monto} el {fecha}. Saldo pendiente: {saldo}. Su recibo: {enlace} (disponible hasta el {vence}). {empresa}';

export const MARCADORES_AVISO: { clave: string; descripcion: string }[] = [
  { clave: 'cliente', descripcion: 'Nombre del cliente' },
  { clave: 'monto', descripcion: 'Lo que toca pagar (cuota y mora)' },
  { clave: 'estado', descripcion: '«vence mañana», «vence hoy» o «tiene N días de atraso»' },
  { clave: 'fecha', descripcion: 'Fecha de la cuota' },
  { clave: 'empresa', descripcion: 'Nombre del negocio' },
];

export const MARCADORES_RECIBO: { clave: string; descripcion: string }[] = [
  { clave: 'cliente', descripcion: 'Nombre del cliente' },
  { clave: 'monto', descripcion: 'Monto recibido' },
  { clave: 'saldo', descripcion: 'Lo que queda debiendo' },
  { clave: 'fecha', descripcion: 'Fecha del pago' },
  { clave: 'enlace', descripcion: 'Enlace para descargar el recibo' },
  { clave: 'vence', descripcion: 'Hasta cuándo sirve el enlace' },
  { clave: 'empresa', descripcion: 'Nombre del negocio' },
];

const MARCADOR = /\{([^{}\n]+)\}/g;

/** Cambia cada {marcador} por su valor. Uno desconocido o sin valor queda tal
 *  cual, a la vista: mejor que el cliente lea «{nombre}» que un hueco. */
export function llenarMensaje(plantilla: string, valores: Record<string, string | undefined>): string {
  return plantilla.replace(MARCADOR, (todo, clave: string) => {
    const v = valores[clave.trim()];
    return v === undefined ? todo : v;
  });
}

/** Los marcadores de la plantilla que no están entre los válidos, sin repetir. */
export function marcadoresDesconocidosEn(plantilla: string, validos: string[]): string[] {
  const fuera: string[] = [];
  for (const m of plantilla.matchAll(MARCADOR)) {
    const clave = m[1].trim();
    if (!validos.includes(clave) && !fuera.includes(clave)) fuera.push(clave);
  }
  return fuera;
}

/** Lo que dice el aviso de la cuota: «vence mañana», «vence hoy» o el atraso. */
export function estadoDeCuota(motivo: 'manana' | 'hoy' | 'atrasado', dias: number): string {
  if (motivo === 'manana') return 'vence mañana';
  if (motivo === 'hoy') return 'vence hoy';
  return dias === 1 ? 'tiene 1 día de atraso' : `tiene ${dias} días de atraso`;
}

/** Lo que se guarda de una plantilla: nada si está vacía o es el texto base (así,
 *  si el texto base mejora, la empresa que no lo cambió recibe el nuevo). */
export function plantillaParaGuardar(texto: string | undefined, base: string): string | null {
  const t = (texto ?? '').trim();
  return t === '' || t === base.trim() ? null : t;
}
