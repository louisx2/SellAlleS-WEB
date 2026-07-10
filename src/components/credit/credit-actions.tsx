'use client';

import Link from 'next/link';
import { MoreHorizontal, DollarSign, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddPaymentDialog } from './add-payment-dialog';
import type { Customer } from '@/lib/types';
import { DialogTrigger } from '@radix-ui/react-dialog';


interface CreditActionsProps {
  customer: Customer;
}

export function CreditActions({ customer }: CreditActionsProps) {

  return (
    <AddPaymentDialog customer={customer}>
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
                <Link href={`/credit/${customer.id}`}>
                    <FileText className="mr-2 h-4 w-4" />
                    <span>Estado de cuenta</span>
                </Link>
            </DropdownMenuItem>
            <DialogTrigger asChild>
                 <DropdownMenuItem>
                    <DollarSign className="mr-2 h-4 w-4" />
                    <span>Registrar Abono</span>
                </DropdownMenuItem>
            </DialogTrigger>
        </DropdownMenuContent>
        </DropdownMenu>
    </AddPaymentDialog>
  );
}
