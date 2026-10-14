'use client';

// El admin de la empresa avisa que transfirió: monto, fecha, a qué cuenta y el
// comprobante. Queda "por confirmar" hasta que SellAlleS vea el dinero en el
// banco; recién ahí se crea el pago y su factura.
//
// Las fotos se comprimen en el navegador antes de subirlas (ver
// comprimirDocumento): una captura de 3 MB queda en unos 200-400 KB y el
// número de referencia se sigue leyendo. Los PDF se suben tal cual.

import { useEffect, useRef, useState } from 'react';
import { Check, FileText, ImageIcon, Loader2, Paperclip, Upload } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { cn, formatCurrency } from '@/lib/utils';
import { hoyLocal } from '@/lib/subscription-status';
import {
  ACCEPT_COMPROBANTE, TIPO_DE_CUENTA, fmtBytes, subirComprobante, type CuentaBancaria,
} from '@/lib/payment-reports';

export function ReportarPagoDialog({ open, onOpenChange, companyId, bancos, montoSugerido, notaMonto, onReportado }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  bancos: CuentaBancaria[];
  /** Lo que debe, o la próxima cuota: se propone, pero se puede cambiar. */
  montoSugerido: number | null;
  notaMonto?: string;
  onReportado: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState<number | ''>('');
  const [paidAt, setPaidAt] = useState(hoyLocal());
  const [banco, setBanco] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<null | 'subiendo' | 'guardando'>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(montoSugerido && montoSugerido > 0 ? Math.round(montoSugerido * 100) / 100 : '');
    setPaidAt(hoyLocal());
    setBanco(bancos.length === 1 ? bancos[0].id : null);
    setReference(''); setNotes(''); setArchivo(null);
  }, [open, montoSugerido, bancos]);

  // Vista previa local (antes de subir) solo para imágenes que el navegador sabe mostrar.
  useEffect(() => {
    if (!archivo || !/^image\/(jpeg|png|webp|gif)$/.test(archivo.type)) { setVista(null); return; }
    const url = URL.createObjectURL(archivo);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  const valor = Number(amount);
  const falta = !valor || valor <= 0 ? 'el monto' : !archivo ? 'el comprobante' : bancos.length > 0 && !banco ? 'la cuenta a la que transferiste' : null;

  const enviar = async () => {
    if (falta || !archivo) {
      toast({ title: 'Falta información', description: `Indica ${falta}.`, variant: 'destructive' });
      return;
    }
    if (paidAt > hoyLocal()) {
      toast({ title: 'Fecha inválida', description: 'La fecha de la transferencia no puede ser futura.', variant: 'destructive' });
      return;
    }
    try {
      setEnviando('subiendo');
      const subido = await subirComprobante(companyId, archivo);
      setEnviando('guardando');
      const { error } = await supabase.rpc('reportar_pago_de_suscripcion', {
        p_amount: valor,
        p_paid_at: paidAt,
        p_bank_account_id: banco,
        p_reference: reference.trim() || null,
        p_notes: notes.trim() || null,
        p_file_path: subido.path,
        p_file_name: subido.name,
        p_file_mime: subido.mime,
        p_file_sha256: subido.sha256,
      });
      if (error) throw error;
      toast({
        title: 'Comprobante enviado',
        description: `Lo revisamos y, al confirmarlo, te llega la factura por correo.${subido.bytes < subido.bytesOriginal ? ` (Se subió en ${fmtBytes(subido.bytes)}.)` : ''}`,
      });
      onReportado();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'No se pudo enviar', description: err?.message ?? 'Error de conexión.', variant: 'destructive' });
    } finally {
      setEnviando(null);
    }
  };

  const esPdf = !!archivo && (archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!enviando) onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reportar un pago</DialogTitle>
          <DialogDescription>
            Después de transferir, sube el comprobante. Lo confirmamos en cuanto veamos el dinero en la cuenta
            y te enviamos la factura.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>¿A qué cuenta transferiste?{bancos.length > 0 && ' *'}</Label>
            {bancos.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Todavía no hay cuentas publicadas. Escríbenos por soporte para que te las pasemos.
              </p>
            ) : (
              <div className="grid gap-2">
                {bancos.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBanco(b.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      banco === b.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
                    )}
                  >
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', banco === b.id && 'border-primary bg-primary text-primary-foreground')}>
                      {banco === b.id && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{b.bank}</span>
                      <span className="block text-xs text-muted-foreground">
                        {TIPO_DE_CUENTA[b.accountType]} · <span className="font-mono">{b.accountNumber}</span>{b.currency !== 'DOP' ? ` · ${b.currency}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rp-monto">Monto transferido *</Label>
              <Input id="rp-monto" type="number" inputMode="decimal" step="0.01" min="0" value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-fecha">Fecha *</Label>
              <Input id="rp-fecha" type="date" max={hoyLocal()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
          </div>
          {notaMonto && <p className="-mt-2 text-xs text-muted-foreground">{notaMonto}</p>}

          <div className="space-y-1">
            <Label htmlFor="rp-ref">Número de referencia</Label>
            <Input id="rp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="El que sale en el comprobante (opcional)" />
          </div>

          <div className="space-y-2">
            <Label>Comprobante *</Label>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_COMPROBANTE}
              className="hidden"
              onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
            {archivo ? (
              <div className="flex items-center gap-3 rounded-lg border p-2">
                <div className="flex h-16 w-14 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
                  {vista
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={vista} alt="" className="h-full w-full object-cover object-top" />
                    : esPdf ? <FileText className="h-6 w-6 text-muted-foreground" /> : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{archivo.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtBytes(archivo.size)}{!esPdf && ' · se comprime antes de subir'}
                  </p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()} disabled={!!enviando}>
                  Cambiar
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed p-5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Upload className="h-6 w-6" />
                <span className="font-medium">Subir foto, captura o PDF</span>
                <span className="text-xs">La captura de la app del banco sirve</span>
              </button>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="rp-notas">Nota (opcional)</Label>
            <Textarea id="rp-notas" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: pago de agosto y septiembre" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={!!enviando}>Cancelar</Button>
          <Button onClick={enviar} disabled={!!enviando || !!falta}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Paperclip className="mr-2 h-4 w-4" />}
            {enviando === 'subiendo' ? 'Subiendo…' : enviando === 'guardando' ? 'Enviando…' : `Enviar${valor > 0 ? ` ${formatCurrency(valor)}` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
