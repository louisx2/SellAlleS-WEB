'use client';

import { useEffect, useState } from 'react';
import type { TicketProfile } from '@/hooks/use-ticket-profile';

// La identidad del negocio en el papel: encabezado, pie y código.
//
// Vive aquí y no dentro del recibo porque la comparten la factura y el estado
// de cuenta. Antes cada documento tenía lo suyo —y el estado de cuenta ni
// siquiera tenía logo ni RNC—, así que no parecían del mismo negocio. Con un
// solo sitio, cambiar el logo o el pie los cambia a la vez y no pueden volver
// a separarse.

export function BusinessHeader({ profile }: { profile: TicketProfile }) {
  return (
    <div className="text-left space-y-1">
      {profile.ticketLogoUrl && (
        <div className="flex justify-center pb-1">
          <img
            src={profile.ticketLogoUrl}
            alt=""
            style={{ maxHeight: 85, maxWidth: '80%', objectFit: 'contain' }}
          />
        </div>
      )}
      <h3 className="text-lg font-semibold text-center">{profile.name}</h3>
      {profile.secondaryName && (
        <p className="text-sm font-medium text-center">{profile.secondaryName}</p>
      )}
      <div className="text-xs text-muted-foreground text-center">
        {profile.address && <p>{profile.address}</p>}
        {profile.rnc && <p>RNC: {profile.rnc}</p>}
        {profile.phone && <p>Tel: {profile.phone}</p>}
      </div>
    </div>
  );
}

/** `codigo` se pinta entre el contacto y el crédito del pie, que es donde la
 *  factura lleva su código de barras. */
export function BusinessFooter({
  profile,
  codigo,
}: {
  profile: TicketProfile;
  codigo?: React.ReactNode;
}) {
  const contacto = [
    [profile.socialMedia.instagram, profile.socialMedia.facebook, profile.email],
    [profile.secondarySocialMedia?.instagram, profile.secondarySocialMedia?.facebook, profile.secondaryEmail],
  ]
    .map((datos) => datos.filter(Boolean).join(' • '))
    .filter(Boolean);

  return (
    <>
      {profile.receiptFooter && (
        <p className="text-center mt-3 text-xs font-semibold">{profile.receiptFooter}</p>
      )}
      {contacto.map((linea) => (
        <div key={linea} className="text-center text-xs mt-1">{linea}</div>
      ))}
      {codigo}
      <div className="text-center mt-4 pt-2 border-t border-dashed">
        <p className="text-[10px] text-muted-foreground font-mono">
          SellAlleS Web <span className="opacity-70">by SmartCore</span>
        </p>
      </div>
    </>
  );
}

/**
 * Código de barras o QR al pie del documento. `valor` es lo que se codifica:
 * el ID de la venta en una factura, el del cliente en un estado de cuenta.
 *
 * Respeta las mismas preferencias del dispositivo que la factura, para que
 * quien apagó el código no se lo encuentre de vuelta en el otro documento.
 */
export function DocumentBarcode({ valor }: { valor: string }) {
  const [mostrar, setMostrar] = useState(true);
  const [tipo, setTipo] = useState<'code128' | 'qr'>('code128');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setMostrar(localStorage.getItem('showBarcode') !== 'false');
    setTipo((localStorage.getItem('barcodeType') as 'code128' | 'qr') || 'code128');
  }, []);

  if (!mostrar) return null;

  return (
    <div className="flex flex-col items-center justify-center mt-6 pt-4 border-t border-dashed gap-1">
      {tipo === 'code128' ? (
        <img
          src={`https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(valor.slice(0, 8).toUpperCase())}&scale=2&height=10`}
          alt="Código de barras"
          className="h-10 w-auto mix-blend-multiply"
        />
      ) : (
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(valor)}`}
          alt="Código QR"
          className="w-20 h-20"
        />
      )}
    </div>
  );
}
