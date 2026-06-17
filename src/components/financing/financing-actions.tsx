'use client';

import { MoreHorizontal, DollarSign } from 'lucide-react';
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
import { AddFinancingPaymentDialog } from './add-financing-payment-dialog';
import { DialogTrigger } from '../ui/dialog';

interface FinancingActionsProps {
  sale: Sale;
}

export function FinancingActions({ sale }: FinancingActionsProps) {
  return (
    <AddFinancingPaymentDialog sale={sale}>
        <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Abrir menú</span>
            <MoreHorizontal className="h-4 w-4" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
            <DropdownMenuLabel>Acciones</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DialogTrigger asChild>
                <DropdownMenuItem>
                    <DollarSign className="mr-2 h-4 w-4" />
                    <span>Registrar Abono</span>
                </DropdownMenuItem>
            </DialogTrigger>
        </DropdownMenuContent>
        </DropdownMenu>
    </AddFinancingPaymentDialog>
  );
}
