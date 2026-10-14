// Pagos de suscripción que reporta una empresa con su comprobante.
//
// El admin transfiere a una de las cuentas de SellAlleS, sube la captura o el
// PDF y queda "por confirmar". Solo cuando el super admin lo confirma se crea
// el pago y su factura (confirmar_reporte_de_pago); hasta entonces no hay
// factura ni correo de factura.

import { supabase } from '@/lib/supabase/client';
import { comprimirDocumento } from '@/lib/image-optim';

export const BUCKET_COMPROBANTES = 'comprobantes-de-pago';

/** Lo mismo que acepta el bucket. */
const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const TAMANO_MAXIMO = 10 * 1024 * 1024;
export const ACCEPT_COMPROBANTE = 'image/*,application/pdf';

export interface CuentaBancaria {
  id: string;
  bank: string;
  accountType: 'ahorro' | 'corriente';
  accountNumber: string;
  holderName: string;
  holderId: string | null;
  currency: 'DOP' | 'USD';
  isActive: boolean;
  sortOrder: number;
}

export const rowToCuentaBancaria = (r: any): CuentaBancaria => ({
  id: r.id,
  bank: r.bank,
  accountType: r.account_type === 'corriente' ? 'corriente' : 'ahorro',
  accountNumber: r.account_number,
  holderName: r.holder_name,
  holderId: r.holder_id ?? null,
  currency: r.currency === 'USD' ? 'USD' : 'DOP',
  isActive: !!r.is_active,
  sortOrder: r.sort_order ?? 0,
});

export const TIPO_DE_CUENTA: Record<CuentaBancaria['accountType'], string> = {
  ahorro: 'Ahorro',
  corriente: 'Corriente',
};

/** Bancos que se sugieren al cargar una cuenta; se puede escribir cualquiera. */
export const BANCOS_RD = [
  'Banreservas',
  'Banco Popular Dominicano',
  'Banco BHD',
  'Scotiabank',
  'Asociación Popular (APAP)',
  'Banco Santa Cruz',
  'Asociación Cibao',
  'Banesco',
  'Banco Caribe',
  'Banco Promerica',
  'Banco López de Haro',
];

export async function cargarCuentasBancarias(soloActivas = true): Promise<CuentaBancaria[]> {
  let q = supabase.from('platform_bank_accounts').select('*');
  if (soloActivas) q = q.eq('is_active', true);
  const { data, error } = await q.order('sort_order').order('created_at');
  if (error) throw error;
  return (data ?? []).map(rowToCuentaBancaria);
}

export type EstadoReporte = 'por_confirmar' | 'confirmado' | 'rechazado' | 'anulado';

export interface ReportePago {
  id: string;
  companyId: string;
  amount: number;
  paidAt: string;
  bankAccountId: string | null;
  bankLabel: string | null;
  reference: string | null;
  notes: string | null;
  filePath: string;
  fileName: string | null;
  fileMime: string | null;
  fileSha256: string | null;
  status: EstadoReporte;
  confirmedAmount: number | null;
  rejectReason: string | null;
  paymentId: string | null;
  reportedByName: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export const rowToReportePago = (r: any): ReportePago => ({
  id: r.id,
  companyId: r.company_id,
  amount: Number(r.amount),
  paidAt: r.paid_at,
  bankAccountId: r.bank_account_id ?? null,
  bankLabel: r.bank_label ?? null,
  reference: r.reference ?? null,
  notes: r.notes ?? null,
  filePath: r.file_path,
  fileName: r.file_name ?? null,
  fileMime: r.file_mime ?? null,
  fileSha256: r.file_sha256 ?? null,
  status: r.status,
  confirmedAmount: r.confirmed_amount != null ? Number(r.confirmed_amount) : null,
  rejectReason: r.reject_reason ?? null,
  paymentId: r.payment_id ?? null,
  reportedByName: r.reported_by_name ?? null,
  reviewedByName: r.reviewed_by_name ?? null,
  reviewedAt: r.reviewed_at ?? null,
  createdAt: r.created_at,
});

/** Cada estado con su color, el mismo en Mi Suscripción, el banner y Cobros. */
export const ESTADO_REPORTE: Record<EstadoReporte, { label: string; descripcion: string; badge: string; caja: string; texto: string }> = {
  por_confirmar: {
    label: 'Por confirmar',
    descripcion: 'Lo recibimos. Falta verificar que la transferencia llegó a la cuenta.',
    badge: 'bg-amber-500 text-white border-transparent hover:bg-amber-500',
    caja: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
    texto: 'text-amber-700 dark:text-amber-400',
  },
  confirmado: {
    label: 'Confirmado',
    descripcion: 'El dinero llegó y el pago quedó registrado con su factura.',
    badge: 'bg-emerald-600 text-white border-transparent hover:bg-emerald-600',
    caja: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
    texto: 'text-emerald-700 dark:text-emerald-400',
  },
  rechazado: {
    label: 'Rechazado',
    descripcion: 'No se pudo confirmar. Mira el motivo y, si hace falta, sube otro comprobante.',
    badge: 'bg-red-600 text-white border-transparent hover:bg-red-600',
    caja: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40',
    texto: 'text-red-700 dark:text-red-400',
  },
  anulado: {
    label: 'Retirado',
    descripcion: 'La empresa lo retiró antes de que se revisara.',
    badge: 'bg-muted text-muted-foreground border-transparent hover:bg-muted',
    caja: 'bg-muted/40',
    texto: 'text-muted-foreground',
  },
};

async function sha256(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function nuevoId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export interface ComprobanteSubido {
  path: string;
  name: string;
  mime: string;
  sha256: string;
  /** Tamaño subido y el original, para decir cuánto se ahorró. */
  bytes: number;
  bytesOriginal: number;
}

/**
 * Valida, comprime (si es imagen) y sube el comprobante a
 * comprobantes-de-pago/<empresa>/<uuid>.<ext>.
 *
 * La huella se saca del archivo ORIGINAL, no del comprimido: así el mismo
 * comprobante enviado dos veces se reconoce aunque el navegador lo comprima
 * distinto. Un PDF se sube tal cual.
 */
export async function subirComprobante(companyId: string, file: File): Promise<ComprobanteSubido> {
  const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const esImagen = file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name);
  if (!esPdf && !esImagen) throw new Error('El comprobante tiene que ser una foto, una captura o un PDF.');

  const huella = await sha256(file);
  // La base lo vuelve a revisar al reportar; aquí se mira antes de subir para
  // no dejar en el bucket un archivo que después se rechaza por repetido.
  const { data: repetido } = await supabase
    .from('subscription_payment_reports')
    .select('id')
    .eq('company_id', companyId)
    .eq('file_sha256', huella)
    .in('status', ['por_confirmar', 'confirmado'])
    .limit(1);
  if (repetido?.length) throw new Error('Ese comprobante ya lo enviaste antes.');

  let blob: Blob = file;
  let ext = esPdf ? 'pdf' : (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  let mime = esPdf ? 'application/pdf' : file.type || 'image/jpeg';

  if (esImagen) {
    try {
      const c = await comprimirDocumento(file);
      blob = c.blob; ext = c.ext; mime = c.mime;
    } catch {
      // HEIC en un navegador que no lo sabe abrir (Chrome, Firefox): se sube
      // el original si entra en el límite. El super admin lo puede descargar.
      if (!TIPOS_ACEPTADOS.includes(mime)) {
        throw new Error('No se pudo leer esa imagen. Prueba con una captura de pantalla o un PDF.');
      }
    }
  }
  if (blob.size > TAMANO_MAXIMO) {
    throw new Error('El archivo pesa más de 10 MB. Sube una captura de pantalla o un PDF más liviano.');
  }

  const path = `${companyId}/${nuevoId()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_COMPROBANTES).upload(path, blob, {
    contentType: mime,
    upsert: false,
    cacheControl: '31536000',
  });
  if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`);

  return { path, name: file.name, mime, sha256: huella, bytes: blob.size, bytesOriginal: file.size };
}

/** Enlace temporal para ver el comprobante (el bucket es privado). */
export async function urlDelComprobante(path: string, segundos = 600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_COMPROBANTES).createSignedUrl(path, segundos);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No se pudo abrir el comprobante.');
  return data.signedUrl;
}

export const esImagenComprobante = (r: Pick<ReportePago, 'fileMime' | 'filePath'>) =>
  (r.fileMime ?? '').startsWith('image/') && !/heic|heif/i.test(r.fileMime ?? '')
  || /\.(webp|jpe?g|png)$/i.test(r.filePath);

export const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
