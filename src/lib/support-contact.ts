// Canales de contacto de soporte de la plataforma (tabla platform_settings).
// Antes el número de WhatsApp vivía hardcodeado en 4 archivos de dos apps; aquí
// queda un solo lugar que arma los enlaces y un fallback para que el botón de
// soporte nunca se quede sin destino si la consulta falla.

export interface SupportContact {
  whatsappEnabled: boolean;
  /** Solo dígitos, como lo espera wa.me: código de país + número. */
  whatsappNumber: string | null;
  /** Cómo se muestra al usuario; puede diferir del número técnico. */
  whatsappLabel: string | null;
  emailEnabled: boolean;
  email: string | null;
  hours: string | null;
}

/** Duración de la prueba y tramos de aviso. Los usa el backend (registro y
 *  barrido diario); aquí viajan solo para poder editarlos desde el panel. */
export interface TrialSettings {
  /** Días de prueba de una empresa nueva. */
  trialDays: number;
  /** Días ANTES del fin de prueba en que se avisa. Ej: [7,3,1]. */
  trialReminderDays: number[];
  /** Días antes de `paid_until` en que se recuerda el cobro. Ej: [3]. */
  paymentReminderDays: number[];
}

export const DEFAULT_TRIAL_SETTINGS: TrialSettings = {
  trialDays: 28,
  trialReminderDays: [7, 3, 1],
  paymentReminderDays: [3],
};

/** "7, 3, 1" -> [7,3,1]. Descarta lo que no sea un entero positivo y ordena de
 *  mayor a menor, que es el orden en que ocurren los avisos. */
export function parseDiasLista(texto: string): number[] {
  const nums = texto
    .split(/[,\s]+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 365);
  return Array.from(new Set(nums)).sort((a, b) => b - a);
}

export const formatDiasLista = (dias: number[]) => dias.join(', ');

/** Valores de arranque: los mismos que estaban en el código antes de esta
 *  tabla. Se usan mientras carga la consulta y si la consulta falla. */
export const DEFAULT_SUPPORT_CONTACT: SupportContact = {
  whatsappEnabled: true,
  whatsappNumber: '18299333226',
  whatsappLabel: '829-933-3226',
  emailEnabled: true,
  email: 'soporte@sellalles.com',
  hours: null,
};

/** Fila cruda de platform_settings (snake_case, como llega de Supabase). */
export interface PlatformSettingsRow {
  support_whatsapp_enabled: boolean | null;
  support_whatsapp_number: string | null;
  support_whatsapp_label: string | null;
  support_email_enabled: boolean | null;
  support_email: string | null;
  support_hours: string | null;
}

export const PLATFORM_SETTINGS_COLUMNS =
  'support_whatsapp_enabled, support_whatsapp_number, support_whatsapp_label, support_email_enabled, support_email, support_hours';

export function mapSupportContact(row: PlatformSettingsRow | null | undefined): SupportContact {
  if (!row) return DEFAULT_SUPPORT_CONTACT;
  return {
    whatsappEnabled: row.support_whatsapp_enabled ?? false,
    whatsappNumber: row.support_whatsapp_number,
    whatsappLabel: row.support_whatsapp_label ?? row.support_whatsapp_number,
    emailEnabled: row.support_email_enabled ?? false,
    email: row.support_email,
    hours: row.support_hours,
  };
}

/** Enlace de WhatsApp con mensaje pre-escrito. Devuelve null si el canal está
 *  apagado o sin número, para que quien lo llame oculte el botón en vez de
 *  renderizar un enlace roto. */
export function waLink(contact: SupportContact, message?: string): string | null {
  if (!contact.whatsappEnabled || !contact.whatsappNumber) return null;
  const base = `https://wa.me/${contact.whatsappNumber}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** Enlace mailto de soporte. null si el canal está apagado o sin dirección. */
export function supportMailto(contact: SupportContact, subject?: string): string | null {
  if (!contact.emailEnabled || !contact.email) return null;
  const base = `mailto:${contact.email}`;
  return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base;
}

/** ¿Hay algún canal disponible? Si no, la UI de soporte se oculta entera. */
export function hasAnySupportChannel(contact: SupportContact): boolean {
  return !!waLink(contact) || !!supportMailto(contact);
}

// ── Caché a nivel de módulo ─────────────────────────────────────────────────
// Igual que setReadOnlyMode en lib/supabase/client.ts: deja que código fuera de
// React (helpers, mensajes de error) lea el contacto vigente sin pasar por el
// contexto. El provider lo mantiene actualizado.

let cached: SupportContact = DEFAULT_SUPPORT_CONTACT;

export function setSupportContact(contact: SupportContact) { cached = contact; }
export function getSupportContact(): SupportContact { return cached; }
