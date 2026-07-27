'use client';

import { useState } from 'react';
import { MoreHorizontal, Receipt, Ban } from 'lucide-react';
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
import { AnnulSaleDialog } from './annul-sale-dialog';

interface SalesActionsProps {
  sale: Sale;
}

export function SalesActions({ sale }: SalesActionsProps) {
  const canDelete = usePermission('sales', 'delete');
  const { appUser } = useAuth();
  const [annulOpen, setAnnulOpen] = useState(false);

  // Solo se anulan ventas pagadas y vigentes; las de crédito/financiamiento
  // se gestionan desde Cuentas por Cobrar.
  const canAnnul =
    canDelete && !appUser?.isReadOnly && !sale.cancelledAt && sale.paymentStatus === 'paid';

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
          <DropdownMenuItem asChild>
            <Link href={`/sales/detail?id=${sale.id}`}>
              <Receipt className="mr-2 h-4 w-4" />
              <span>Ver Recibo</span>
            </Link>
          </DropdownMenuItem>
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
    </>
  );
}
