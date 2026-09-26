'use client';

// Miniatura del comprobante de un pago, con enlace para verlo completo. El
// bucket es privado: cada vista pide un enlace firmado que vence en minutos.

import { useEffect, useState } from 'react';
import { ExternalLink, FileText, ImageOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { esImagenComprobante, urlDelComprobante, type ReportePago } from '@/lib/payment-reports';

export function ComprobanteVista({ reporte, className, grande = false }: {
  reporte: Pick<ReportePago, 'filePath' | 'fileMime' | 'fileName'>;
  className?: string;
  /** En el diálogo de confirmar se ve a lo ancho; en las listas, miniatura. */
  grande?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const imagen = esImagenComprobante(reporte);

  useEffect(() => {
    let cancelado = false;
    setUrl(null); setError(false);
    urlDelComprobante(reporte.filePath)
      .then((u) => { if (!cancelado) setUrl(u); })
      .catch(() => { if (!cancelado) setError(true); });
    return () => { cancelado = true; };
  }, [reporte.filePath]);

  const caja = cn(
    'flex items-center justify-center overflow-hidden rounded-md border bg-muted/40',
    grande ? 'max-h-[45vh] w-full' : 'h-24 w-20 shrink-0',
    className,
  );

  if (error) {
    return <div className={caja} title="No se pudo abrir"><ImageOff className="h-5 w-5 text-muted-foreground" /></div>;
  }
  if (!url) {
    return <div className={caja}><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }
  if (!imagen) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={cn(caja, 'flex-col gap-1 p-2 text-center text-xs text-primary hover:bg-muted')}>
        <FileText className="h-6 w-6" />
        <span className="line-clamp-2 break-all">{reporte.fileName ?? 'Abrir PDF'}</span>
        {grande && <span className="inline-flex items-center gap-1">Abrir <ExternalLink className="h-3 w-3" /></span>}
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={caja} title="Ver el comprobante completo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Comprobante de pago"
        className={grande ? 'max-h-[45vh] w-auto object-contain' : 'h-full w-full object-cover object-top'}
      />
    </a>
  );
}
