'use client';

import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { formatCurrency } from '@/lib/utils';
import type { CajaSession } from '@/lib/types';
import { Printer, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

function fmtDateTime(d?: Date) {
  return d ? d.toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

function Row({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${strong ? 'font-semibold' : ''} ${className ?? ''}`}>{value}</span>
    </div>
  );
}

export function CajaDetailDialog({ session, children }: { session: CajaSession; children: React.ReactNode }) {
  const printRef = useRef(null);
  const handlePrint = useReactToPrint({ content: () => printRef.current });

  const b = session.breakdown;
  const diff = session.difference ?? b?.difference ?? 0;
  const diffLabel = Math.abs(diff) < 0.01 ? 'Cuadra' : diff < 0 ? 'Faltante' : 'Sobrante';
  const diffClass = Math.abs(diff) < 0.01 ? 'text-emerald-600 dark:text-emerald-400' : diff < 0 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400';

  const movements = (session.movements ?? []).slice().sort((a, c) => c.createdAt.getTime() - a.createdAt.getTime());

  return (
    <Dialog>
      {children}
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Detalle de caja
            {session.status === 'open'
              ? <Badge className="bg-emerald-600">Abierta</Badge>
              : <Badge variant="outline">Cerrada</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="space-y-4 py-2">
          <div className="space-y-1">
            {session.branchName && <Row label="Sucursal" value={session.branchName} strong />}
            <Row label="Abierta por" value={session.openedByName ?? '—'} />
            <Row label="Apertura" value={fmtDateTime(session.openedAt)} />
            {session.status === 'closed' && (
              <>
                <Row label="Cerrada por" value={session.closedByName ?? '—'} />
                <Row label="Cierre" value={fmtDateTime(session.closedAt)} />
              </>
            )}
          </div>

          <Separator />

          {b ? (
            <div className="space-y-1">
              <p className="text-sm font-medium mb-1">Desglose del efectivo</p>
              <Row label="Monto inicial" value={formatCurrency(b.opening)} />
              <Row label="Ventas en efectivo" value={`+ ${formatCurrency(b.cashSales)}`} />
              <Row label="Abonos crédito (efectivo)" value={`+ ${formatCurrency(b.creditCashPayments)}`} />
              <Row label="Abonos préstamo (efectivo)" value={`+ ${formatCurrency(b.loanCashPayments)}`} />
              <Row label="Entradas manuales" value={`+ ${formatCurrency(b.movementsIn)}`} />
              <Row label="Salidas manuales" value={`- ${formatCurrency(b.movementsOut)}`} />
              <Separator className="my-1" />
              <Row label="Esperado en caja" value={formatCurrency(b.expected)} strong />
              <Row label="Declarado (contado)" value={formatCurrency(b.declared)} strong />
              <Row label={diffLabel} value={formatCurrency(Math.abs(b.difference))} strong className={diffClass} />
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium mb-1">Caja en curso</p>
              <Row label="Monto inicial" value={formatCurrency(session.openingAmount)} strong />
              <p className="text-xs text-muted-foreground">El desglose completo estará disponible al cerrar la caja.</p>
            </div>
          )}

          {movements.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-2">Movimientos</p>
                <div className="space-y-1">
                  {movements.map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        {m.type === 'in'
                          ? <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
                          : <ArrowUpCircle className="h-4 w-4 text-destructive" />}
                        {m.reason || (m.type === 'in' ? 'Entrada' : 'Salida')}
                      </span>
                      <span className={m.type === 'in' ? 'text-emerald-600' : 'text-destructive'}>
                        {m.type === 'in' ? '+' : '-'}{formatCurrency(m.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {session.notes && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-1">Notas</p>
                <p className="text-sm text-muted-foreground">{session.notes}</p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <DialogClose asChild>
            <Button type="button">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
