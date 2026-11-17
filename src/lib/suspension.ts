// =============================================================================
// EMPRESA SUSPENDIDA
// -----------------------------------------------------------------------------
// El super admin suspende una empresa con un motivo (companies.suspension_reason).
// Mientras está suspendida:
//  - sus usuarios ven una pantalla de bloqueo con un mensaje según el motivo;
//  - la base rechaza sus escrituras (trigger bloquear_si_empresa_suspendida);
//  - no salen recordatorios de cuotas a sus clientes;
//  - los e-CF ya emitidos terminan de enviarse a la DGII.
// Al reactivarla, el super admin elige: prueba hasta una fecha, o activa (con o
// sin modo solo facturación).
//
// Lógica pura y sin imports de valor: la prueba scripts/tests/suspension.test.mjs
// con `node --test`.
// =============================================================================

export type MotivoSuspension = 'falta_de_pago' | 'solicitud_cliente' | 'revision';

export const MOTIVOS_SUSPENSION: MotivoSuspension[] = ['falta_de_pago', 'solicitud_cliente', 'revision'];

/** Para el super admin: cómo se llama cada motivo y qué implica. */
export const MOTIVO_SUSPENSION_INFO: Record<MotivoSuspension, { nombre: string; descripcion: string }> = {
  falta_de_pago: {
    nombre: 'Falta de pago',
    descripcion: 'La suscripción tiene pagos pendientes. La empresa verá las cuentas para transferir.',
  },
  solicitud_cliente: {
    nombre: 'Solicitud del cliente',
    descripcion: 'La empresa pidió suspender o cerrar su cuenta.',
  },
  revision: {
    nombre: 'Revisión administrativa',
    descripcion: 'Suspensión temporal por otro motivo, sin dar detalles a la empresa.',
  },
};

export function esMotivoSuspension(v: unknown): v is MotivoSuspension {
  return typeof v === 'string' && (MOTIVOS_SUSPENSION as string[]).includes(v);
}

/** Lo que ve la empresa en la pantalla de bloqueo. */
export interface PantallaSuspension {
  titulo: string;
  mensaje: string;
  /** Qué hacer para reactivarla. */
  accion: string;
  /** Mensaje listo para WhatsApp. */
  mensajeSoporte: string;
}

export function pantallaDeSuspension(
  motivo: string | null | undefined,
  empresa: string | null | undefined,
  esAdmin: boolean,
): PantallaSuspension {
  const nombre = (empresa ?? '').trim() || 'su empresa';
  const m: MotivoSuspension = esMotivoSuspension(motivo) ? motivo : 'revision';
  // Un cajero no puede pagar ni pedir la reactivación: lo que le toca es avisar.
  const paraNoAdmin = 'Comuníquese con el administrador de su empresa para restablecer el acceso.';

  switch (m) {
    case 'falta_de_pago':
      return {
        titulo: 'Cuenta suspendida por falta de pago',
        mensaje: `El acceso a ${nombre} está suspendido porque la suscripción presenta pagos pendientes.`,
        accion: esAdmin
          ? 'Para reactivarla, realice el pago pendiente y envíenos el comprobante. La reactivaremos en cuanto lo confirmemos.'
          : paraNoAdmin,
        mensajeSoporte: `Hola, quiero ponerme al día con el pago de ${nombre} para reactivar la cuenta.`,
      };
    case 'solicitud_cliente':
      return {
        titulo: 'Cuenta suspendida',
        mensaje: `El acceso a ${nombre} fue suspendido a solicitud de la empresa.`,
        accion: esAdmin ? 'Cuando desee reactivarla, comuníquese con nosotros.' : paraNoAdmin,
        mensajeSoporte: `Hola, quiero reactivar la cuenta de ${nombre}.`,
      };
    default:
      return {
        titulo: 'Cuenta suspendida temporalmente',
        mensaje: `El acceso a ${nombre} está suspendido temporalmente mientras realizamos una revisión administrativa.`,
        accion: esAdmin ? 'Si tiene alguna pregunta, comuníquese con nosotros.' : paraNoAdmin,
        mensajeSoporte: `Hola, la cuenta de ${nombre} aparece suspendida y quisiera más información.`,
      };
  }
}

/** Fecha 'YYYY-MM-DD' de hoy + n días (local). */
export function fechaMasDias(n: number, desde: Date = new Date()): string {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Propuesta para el diálogo de reactivar. Si la prueba todavía no vence, se
 * sugiere seguirla hasta su fecha; si venció o nunca tuvo, Activa. Con motivo
 * "falta de pago", Activa en solo facturación hasta que pague.
 */
export function reactivacionSugerida(e: {
  motivo?: string | null;
  finPrueba?: string | null;
  ahora?: Date;
}): { estado: 'trial' | 'active'; pruebaHasta: string; soloFacturacion: boolean } {
  const ahora = e.ahora ?? new Date();
  const fin = e.finPrueba ? new Date(e.finPrueba) : null;
  const pruebaVigente = !!fin && !Number.isNaN(fin.getTime()) && fin.getTime() > ahora.getTime();
  return {
    estado: pruebaVigente && e.motivo !== 'falta_de_pago' ? 'trial' : 'active',
    pruebaHasta: pruebaVigente ? fechaMasDias(0, fin!) : fechaMasDias(7, ahora),
    soloFacturacion: e.motivo === 'falta_de_pago',
  };
}

/** ¿El error de Supabase es el de una empresa suspendida (trigger de la base)? */
export function esErrorEmpresaSuspendida(err: { message?: string | null; hint?: string | null } | null | undefined): boolean {
  if (!err) return false;
  return err.hint === 'empresa_suspendida' || /empresa est[aá] suspendida/i.test(err.message ?? '');
}
