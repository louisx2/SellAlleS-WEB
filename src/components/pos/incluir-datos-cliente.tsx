'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { puedeIncluirDatosCliente, textoCasillaDatosCliente } from '@/lib/datos-cliente';
import type { Customer } from '@/lib/types';
import { cn } from '@/lib/utils';

interface IncluirDatosClienteProps {
  customer?: Customer;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

/** Casilla "Incluir datos del cliente en la factura". Solo aparece si la
 *  empresa encendió la opción en Ajustes y el cliente tiene alguno de los datos
 *  elegidos: al consumidor final no hay nada que agregarle. */
export function IncluirDatosCliente({ customer, checked, onCheckedChange, className }: IncluirDatosClienteProps) {
  const { profile } = useCompanyProfile();
  const campos = profile.receiptCustomerFields;
  if (!puedeIncluirDatosCliente(profile.receiptCustomerInfoEnabled, campos, customer)) return null;

  return (
    <label className={cn('flex items-start gap-2 rounded-lg border p-3 cursor-pointer', className)}>
      <Checkbox
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-label="Incluir datos del cliente en la factura"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">Incluir datos del cliente en la factura</span>
        <span className="block text-xs text-muted-foreground">
          {textoCasillaDatosCliente(customer, campos)}
        </span>
      </span>
    </label>
  );
}
