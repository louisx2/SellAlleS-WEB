'use client';

import { useState } from 'react';
import { Ban, CalendarClock, FileText, Landmark, ListChecks, MoreHorizontal, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Sale } from '@/lib/types';
import Link from 'next/link';
import { usePermission } from '@/hooks/use-permission';
import { useAuth } from '@/context/auth-provider';
import { estadoDisponible } from '@/lib/estado-financiamiento';
import { ReceiptDialog } from '@/components/pos/receipt-dialog';
import { FinancingStatementDialog } from '@/components/financing/financing-statement-dialog';
import { PaymentPlanDialog } from '@/components/financing/payment-plan-dialog';
import { AnnulSaleDialog } from './annul-sale-dialog';

interface SalesActionsProps {
  sale: Sale;
}

/** Documento abierto desde el menú. Cada uno trae Imprimir · Enviar al cliente · PDF. */
type Documento = 'factura' | 'estado' | 'plan';

export function SalesActions({ sale }: SalesActionsProps) {
  const canDelete = usePermission('sales', 'delete');
  const canViewFinancing = usePermission('financing', 'view');
  const { appUser } = useAuth();
  const [annulOpen, setAnnulOpen] = useState(false);
  const [documento, setDocumento] = useState<Documento | null>(null);

  // Cualquier venta vigente se puede anular (la base exige administrador). Una
  // a crédito o financiada con abonos posteriores la rechaza la base hasta que
  // se anulen esos abonos.
  const canAnnul = canDelete && !appUser?.bloqueo && !sale.cancelledAt;

  const esFinanciamiento = sale.paymentMethod === 'financing' || !!sale.financingDetails;
  // A una venta anulada no se le manda nada: el estado le diría al cliente que
  // debe (las cuotas siguen en la base) y la factura ya tiene su nota de crédito.
  const sePuedeEnviar = estadoDisponible(sale);
  // Con comprobante fiscal es una factura; sin él, un recibo.
  const nombreComprobante = sale.ncf ? 'Factura' : 'Recibo';
  const cerrarDocumento = (open: boolean) => { if (!open) setDocumento(null); };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Abrir menú</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Acciones</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/sales/detail?id=${sale.id}`}>
              <Receipt className="mr-2 h-4 w-4" />
              <span>Ver detalle de la venta</span>
            </Link>
          </DropdownMenuItem>
          {esFinanciamiento && canViewFinancing && (
            <DropdownMenuItem asChild>
              <Link href={`/financing/detail?id=${sale.id}`}>
                <Landmark className="mr-2 h-4 w-4" />
                <span>Ver financiamiento</span>
              </Link>
            </DropdownMenuItem>
          )}

          {sePuedeEnviar && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Imprimir o enviar al cliente
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setDocumento('factura')}>
                <FileText className="mr-2 h-4 w-4" />
                <span>{nombreComprobante}</span>
              </DropdownMenuItem>
              {esFinanciamiento && (
                <DropdownMenuItem onSelect={() => setDocumento('estado')}>
                  <ListChecks className="mr-2 h-4 w-4" />
                  <span>Estado del financiamiento</span>
                </DropdownMenuItem>
              )}
              {sale.financingDetails && (
                <DropdownMenuItem onSelect={() => setDocumento('plan')}>
                  <CalendarClock className="mr-2 h-4 w-4" />
                  <span>Plan de pagos</span>
                </DropdownMenuItem>
              )}
            </>
          )}

          {canAnnul && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setAnnulOpen(true)}
              >
                <Ban className="mr-2 h-4 w-4" />
                <span>Anular venta</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canAnnul && (
        <AnnulSaleDialog sale={sale} open={annulOpen} onOpenChange={setAnnulOpen} />
      )}

      {/* Se montan solo al abrirse: la tabla tiene una fila por venta y cada
          documento arma su copia para imprimir y otra para el PDF. */}
      {documento === 'factura' && (
        <ReceiptDialog sale={sale} isOpen onOpenChange={cerrarDocumento} />
      )}
      {documento === 'estado' && (
        <FinancingStatementDialog sale={sale} isOpen onOpenChange={cerrarDocumento} />
      )}
      {documento === 'plan' && (
        <PaymentPlanDialog sale={sale} isOpen onOpenChange={cerrarDocumento} />
      )}
    </>
  );
}
