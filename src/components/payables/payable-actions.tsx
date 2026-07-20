'use client';

import { useState } from 'react';
import { MoreHorizontal, Eye, HandCoins, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SupplierInvoice } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { usePayables } from '@/context/payables-provider';
import { PayableDetailDialog } from './payable-detail-dialog';
import { PayablePaymentDialog } from './payable-payment-dialog';

interface PayableActionsProps {
  invoice: SupplierInvoice;
}

export function PayableActions({ invoice }: PayableActionsProps) {
  const { toast } = useToast();
  const { deleteInvoice } = usePayables();
  const [detailOpen, setDetailOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const canDelete = invoice.amountPaid === 0 && invoice.payments.length === 0;
  const supplierName = invoice.supplier?.name ?? 'el suplidor';

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar la factura de "${supplierName}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await deleteInvoice(invoice.id);
      toast({
        title: 'Factura eliminada',
        description: `La factura de "${supplierName}" fue eliminada.`,
      });
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error al eliminar',
        description: error?.message || 'No se pudo eliminar la factura.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Abrir menú</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Acciones</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDetailOpen(true)}>
            <Eye className="mr-2 h-4 w-4" />
            <span>Ver detalle</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPayOpen(true)} disabled={invoice.status === 'paid'}>
            <HandCoins className="mr-2 h-4 w-4" />
            <span>Registrar abono</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDelete} disabled={!canDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Eliminar</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PayableDetailDialog invoice={invoice} open={detailOpen} onOpenChange={setDetailOpen} />
      <PayablePaymentDialog invoice={invoice} open={payOpen} onOpenChange={setPayOpen} />
    </>
  );
}
