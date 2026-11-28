'use client';

import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Printer } from 'lucide-react';
import { useTicketProfile } from '@/hooks/use-ticket-profile';
import { formatCurrency } from '@/lib/utils';
import { ANSWER_LABEL, camposDeFicha, caseNumber, valorDeFicha } from '@/lib/taller';
import { useEnlaceSeguimiento } from './use-enlace-seguimiento';
import type { EquipmentType, Service, TallerSettings } from '@/lib/types';

const fecha = (d: Date) => d.toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });

function Linea({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null;
  return (
    <p className="uppercase"><span className="font-semibold">{k}:</span> {v}</p>
  );
}

function Cuerpo({ service, equipmentType, settings }: {
  service: Service; equipmentType?: EquipmentType; settings?: TallerSettings | null;
}) {
  const profile = useTicketProfile(service.branchName);
  const extra = equipmentType?.extraFields ?? [];
  const esReparacion = service.isRepair;
  // QR con el enlace de seguimiento: el cliente lo escanea y ve cómo va su orden.
  const [qr, setQr] = useState<string | null>(null);
  const enlace = useEnlaceSeguimiento()(service.trackingCode);
  useEffect(() => {
    if (!enlace) return;
    let vivo = true;
    (async () => {
      const QRCode = (await import('qrcode')).default;
      const url = await QRCode.toDataURL(enlace, { margin: 1, width: 200 });
      if (vivo) setQr(url);
    })().catch(() => {});
    return () => { vivo = false; };
  }, [enlace]);
  return (
    <div className="text-left space-y-1 text-black">
      {profile.ticketLogoUrl && (
        <div className="flex justify-center pb-1">
          <img src={profile.ticketLogoUrl} alt="" style={{ maxHeight: 85, maxWidth: '80%', objectFit: 'contain' }} />
        </div>
      )}
      <h3 className="text-lg font-semibold text-center">{profile.name}</h3>
      {profile.secondaryName && <p className="text-sm font-medium text-center">{profile.secondaryName}</p>}
      <div className="text-xs text-center">
        {profile.address && <p>{profile.address}</p>}
        {profile.rnc && <p>RNC: {profile.rnc}</p>}
        {profile.phone && <p>Tel: {profile.phone}</p>}
      </div>
      <Separator className="my-2" />
      <div className="text-center">
        <p className="text-sm font-semibold uppercase">Recibo de recepción</p>
        <p className="text-2xl font-bold tracking-wide">{caseNumber(service.number)}</p>
      </div>
      <div className="text-xs space-y-0.5">
        <Linea k="Fecha" v={fecha(service.createdAt)} />
        <Linea k="Recibió" v={service.receivedByName} />
        {service.promisedAt && <Linea k="Prometido para" v={service.promisedAt.toLocaleDateString('es-DO')} />}
      </div>
      <Separator className="my-2" />
      <div className="text-xs space-y-0.5">
        <Linea k="Cliente" v={service.customer?.name ?? 'Consumidor final'} />
        <Linea k="Teléfono" v={service.customer?.phone} />
        {service.broughtByName && (
          <Linea k="Lo trajo" v={[service.broughtByName, service.broughtByPhone].filter(Boolean).join(' · ')} />
        )}
      </div>
      <Separator className="my-2" />
      <div className="text-xs space-y-0.5">
        {/* Los campos con los nombres de su tipo de ficha («Nombre», «Raza», «Placa»…). */}
        <Linea k={esReparacion ? 'Equipo' : 'Qué se atiende'} v={equipmentType?.name} />
        {camposDeFicha(equipmentType).map((f) => <Linea key={f.key} k={f.label} v={valorDeFicha(service, f.key)} />)}
        {/* La clave nunca se imprime: solo se dice que se anotó, y solo si el tipo la pide. */}
        {equipmentType?.asksPassword && service.equipmentPassword && <Linea k="Clave/patrón" v="anotada" />}
        {extra.map((f) => <Linea key={f.key} k={f.label} v={service.equipmentDetails[f.key]} />)}
        <Linea k={esReparacion ? 'Deja' : 'Lo que deja'} v={service.accessories} />
      </div>
      {service.description.trim() && (
        <div className="text-xs pt-1">
          <p className="font-semibold uppercase">{esReparacion ? 'Falla reportada' : 'Detalle'}</p>
          <p>{service.description}</p>
        </div>
      )}
      {service.intakeChecklist.length > 0 && (
        <>
          <Separator className="my-2" />
          <div className="text-xs">
            <p className="font-semibold uppercase">Cómo llegó</p>
            {service.intakeChecklist.map((c) => (
              <p key={c.itemId}>
                {c.label}: <span className="font-semibold">{ANSWER_LABEL[c.answer]}</span>{c.note ? ` — ${c.note}` : ''}
              </p>
            ))}
          </div>
        </>
      )}
      {(service.estimate != null || service.total > 0) && (
        <>
          <Separator className="my-2" />
          <div className="text-xs space-y-0.5">
            {service.estimate != null && <Linea k="Presupuesto aprox." v={formatCurrency(service.estimate)} />}
            {service.total > 0 && <Linea k="Total de la orden" v={formatCurrency(service.total)} />}
          </div>
        </>
      )}
      {settings?.terms && (
        <>
          <Separator className="my-2" />
          <p className="text-[10px] leading-snug whitespace-pre-line">{settings.terms}</p>
        </>
      )}
      <div className="pt-8 text-xs">
        <div className="border-t border-black pt-1 text-center">Firma del cliente</div>
      </div>
      {qr && (
        <div className="flex flex-col items-center pt-3">
          <img src={qr} alt="" style={{ width: 110, height: 110 }} />
          <p className="text-[10px] text-center">Escanea para ver cómo va {esReparacion ? 'tu equipo' : 'tu orden'}</p>
        </div>
      )}
      <p className="pt-2 text-center text-[10px]">
        {esReparacion ? 'Presente este recibo para retirar su equipo.' : 'Presente este recibo al retirar.'}
      </p>
    </div>
  );
}

/** Recibo de recepción: solo para órdenes que se quedan en el negocio (quien lo
 *  abre lo decide con `service.staysInShop`). */
export function ReciboRecepcionDialog({ open, onOpenChange, service, equipmentType, settings }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service;
  equipmentType?: EquipmentType;
  settings?: TallerSettings | null;
}) {
  const printRef = useRef(null);
  const print = useReactToPrint({ content: () => printRef.current });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recibo de recepción</DialogTitle>
          <DialogDescription>Imprímelo y entrégaselo al cliente.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-white p-3">
          <div ref={printRef} className="receipt-container">
            <Cuerpo service={service} equipmentType={equipmentType} settings={settings} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={() => print()}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
