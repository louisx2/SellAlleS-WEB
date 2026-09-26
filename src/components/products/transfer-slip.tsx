'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Loader2, Printer } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useBranches } from '@/context/branch-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { formatQuantity, roundQty } from '@/lib/units';
import { fetchTransferBatch, type TransferBatch } from '@/lib/transfers';

export const formatTransferNumber = (n: number) => `#${String(n).padStart(5, '0')}`;

export const formatTransferDate = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

/** El conduce: lo que salió, de dónde, hacia dónde y quién lo mandó, con
 *  espacio para las firmas de quien entrega y quien recibe. */
export const TransferSlip = forwardRef<HTMLDivElement, { batch: TransferBatch }>(function TransferSlip({ batch }, ref) {
  const { branches } = useBranches();
  const { profile } = useCompanyProfile();
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? 'Sucursal';
  const totalUnits = roundQty(batch.lines.reduce((acc, l) => acc + l.quantity, 0));

  return (
    <div ref={ref} className="bg-white p-6 text-sm text-black">
      <div className="flex items-start justify-between gap-4 border-b pb-3">
        <div>
          <p className="text-base font-bold">{profile.name}</p>
          <p className="text-xs text-gray-600">Conduce de transferencia entre sucursales</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{formatTransferNumber(batch.number)}</p>
          <p className="text-xs text-gray-600">{formatTransferDate(batch.createdAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 py-3">
        <div>
          <p className="text-xs uppercase text-gray-500">Sale de</p>
          <p className="font-semibold">{branchName(batch.fromBranchId)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-gray-500">Llega a</p>
          <p className="font-semibold">{branchName(batch.toBranchId)}</p>
        </div>
        {batch.createdByName && (
          <div>
            <p className="text-xs uppercase text-gray-500">Enviado por</p>
            <p>{batch.createdByName}</p>
          </div>
        )}
        {batch.notes && (
          <div className="col-span-2">
            <p className="text-xs uppercase text-gray-500">Nota</p>
            <p className="whitespace-pre-wrap">{batch.notes}</p>
          </div>
        )}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y text-left text-xs uppercase text-gray-500">
            <th className="py-1.5 pr-2">Código</th>
            <th className="py-1.5 pr-2">Artículo</th>
            <th className="py-1.5 text-right">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {batch.lines.map((l) => (
            <tr key={l.id} className="border-b align-top">
              <td className="py-1.5 pr-2 font-mono text-xs break-all">{l.productCode ?? '—'}</td>
              <td className="py-1.5 pr-2">{l.productName}</td>
              <td className="py-1.5 text-right whitespace-nowrap">{formatQuantity(l.quantity, l.unit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="pt-2 text-right text-xs text-gray-600">
              {batch.lines.length} {batch.lines.length === 1 ? 'artículo' : 'artículos'} · total
            </td>
            <td className="pt-2 text-right font-semibold">{totalUnits}</td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-12 grid grid-cols-2 gap-8 text-center text-xs">
        <div className="border-t pt-1">Entregado por</div>
        <div className="border-t pt-1">Recibido por</div>
      </div>
    </div>
  );
});

interface TransferSlipDialogProps {
  /** El envío ya cargado, o su id para leerlo de la base. */
  batch?: TransferBatch | null;
  batchId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransferSlipDialog({ batch: batchProp, batchId, open, onOpenChange }: TransferSlipDialogProps) {
  const [loaded, setLoaded] = useState<TransferBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const batch = batchProp ?? loaded;

  useEffect(() => {
    if (!open || batchProp || !batchId) return;
    let cancelado = false;
    setLoaded(null);
    setError(null);
    fetchTransferBatch(batchId)
      .then((b) => { if (!cancelado) setLoaded(b); })
      .catch((e) => { if (!cancelado) setError(e?.message ?? 'No se pudo cargar el conduce.'); });
    return () => { cancelado = true; };
  }, [open, batchProp, batchId]);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: batch ? `conduce_${batch.number}` : 'conduce',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {batch ? `Conduce ${formatTransferNumber(batch.number)}` : 'Conduce'}
          </DialogTitle>
          <DialogDescription>Imprímelo para que viaje con la mercancía y lo firme quien la recibe.</DialogDescription>
        </DialogHeader>
        {batch ? (
          <div className="rounded-md border">
            <TransferSlip ref={printRef} batch={batch} />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={handlePrint} disabled={!batch}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
