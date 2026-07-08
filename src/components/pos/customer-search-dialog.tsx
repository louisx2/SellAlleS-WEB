'use client';

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Customer } from '@/lib/types';
import { useCustomers } from '@/context/customer-provider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '../ui/button';
import { PlusCircle } from 'lucide-react';
import { CustomerDialog } from '../customers/customer-dialog';
import { Separator } from '../ui/separator';

interface CustomerSearchDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCustomerSelected: (customer: Customer) => void;
}

export function CustomerSearchDialog({ isOpen, onOpenChange, onCustomerSelected }: CustomerSearchDialogProps) {
  const { customers } = useCustomers();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCustomers = useMemo(() => {
    const isGeneric = (c: Customer) => 
      c.id === '0' || 
      c.name.toLowerCase() === 'cliente genérico' || 
      c.name.toLowerCase() === 'cliente generico';

    if (!searchTerm) {
      // Exclude generic customer from the list
      return customers.filter(c => !isGeneric(c));
    }
    const term = searchTerm.toLowerCase();
    return customers.filter(customer =>
      !isGeneric(customer) && (
        customer.name.toLowerCase().includes(term) ||
        customer.phone.toLowerCase().includes(term) ||
        (customer.rnc && customer.rnc.toLowerCase().includes(term))
      )
    );
  }, [searchTerm, customers]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buscar Cliente</DialogTitle>
          <DialogDescription>
            Selecciona un cliente para asociarlo a esta venta.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4 py-4">
          <Input
            placeholder="Buscar por nombre, teléfono o RNC..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
           <CustomerDialog onSuccess={(newCust) => onCustomerSelected(newCust)}>
                <Button variant="outline">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Nuevo
                </Button>
            </CustomerDialog>
        </div>
        <Separator />
        <ScrollArea className="h-72">
          <div className="space-y-2 p-1">
            {filteredCustomers.length > 0 ? (
              filteredCustomers.map(customer => (
                <div
                  key={customer.id}
                  className="p-3 border rounded-md cursor-pointer hover:bg-accent"
                  onClick={() => onCustomerSelected(customer)}
                >
                  <p className="font-semibold">{customer.name}</p>
                  <p className="text-sm text-muted-foreground">{customer.phone}</p>
                </div>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">No se encontraron clientes.</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
