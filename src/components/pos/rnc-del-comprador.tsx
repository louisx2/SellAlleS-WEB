'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RncConDgii } from '@/components/dgii/rnc-con-dgii';
import { useCustomers } from '@/context/customer-provider';
import { useAuth } from '@/context/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { formatCedulaOrRnc } from '@/lib/format';
import { buscarClientePorDocumento, cascadaNombre, digitosDeDocumento, type DatosRnc } from '@/lib/rnc';
import type { Customer, NcfType } from '@/lib/types';

// Al cobrar con un comprobante que pide RNC (crédito fiscal, gubernamental,
// régimen especial) y el cliente del carrito no tiene uno válido: se escribe el
// RNC del comprador ahí mismo. La DGII trae la razón social; "Usar" pone en el
// carrito al cliente de la empresa con ese documento, o lo crea si no existe.

interface RncDelCompradorProps {
  /** El tipo de comprobante elegido: es el que queda guardado en el cliente nuevo. */
  ncfType: NcfType;
  onClienteListo: (cliente: Customer) => void;
}

export function RncDelComprador({ ncfType, onClienteListo }: RncDelCompradorProps) {
  const { customers, addCustomer } = useCustomers();
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [rnc, setRnc] = useState('');
  const [nombre, setNombre] = useState('');
  const [ofrecerNombre, setOfrecerNombre] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  // El último nombre que puso la DGII: al corregir un RNC mal escrito no puede
  // quedar el nombre de la otra empresa (ver cascadaNombre).
  const nombreAutomatico = useRef<string | undefined>(undefined);

  const digitos = digitosDeDocumento(rnc);
  const existente = digitos ? buscarClientePorDocumento(customers, digitos) : undefined;
  const completo = digitos.length === 9 || digitos.length === 11;

  const alEncontrarRnc = (datos: DatosRnc) => {
    const c = cascadaNombre(datos.razonSocial, nombre, nombreAutomatico.current);
    if (c.nombre) {
      setNombre(c.nombre);
      nombreAutomatico.current = c.nombre;
    }
    setOfrecerNombre(c.ofrecerNombre);
  };

  const usar = async () => {
    if (existente) {
      onClienteListo(existente);
      return;
    }
    setGuardando(true);
    try {
      const creado = await addCustomer(
        {
          name: nombre.trim(),
          phone: '',
          rnc: formatCedulaOrRnc(digitos),
          ncfType,
          creditBalance: 0,
          creditLimit: null,
          discountPercentage: 0,
          loyaltyPurchaseCount: 0,
        },
        appUser?.impersonatedCompanyId || appUser?.companyId,
      );
      if (creado) {
        toast({ title: 'Cliente añadido', description: `${creado.name} quedó en el carrito.` });
        onClienteListo(creado);
      }
    } catch (err: any) {
      toast({
        title: 'No se pudo crear el cliente',
        description: err?.message || 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="space-y-1.5">
        <Label htmlFor="rnc-comprador" className="text-xs">RNC del comprador</Label>
        <RncConDgii
          id="rnc-comprador"
          value={rnc}
          onChange={(v) => {
            setRnc(v);
            setOfrecerNombre(undefined);
          }}
          onDatos={alEncontrarRnc}
          ofrecerNombre={ofrecerNombre}
          onUsarNombre={(n) => {
            setNombre(n);
            nombreAutomatico.current = n;
            setOfrecerNombre(undefined);
          }}
          disabled={guardando}
        />
      </div>
      {existente ? (
        <p className="text-xs text-muted-foreground">Ya es cliente: {existente.name}.</p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="nombre-comprador" className="text-xs">Nombre o razón social</Label>
          <Input
            id="nombre-comprador"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={guardando}
          />
        </div>
      )}
      <Button
        type="button"
        size="sm"
        onClick={usar}
        disabled={guardando || !completo || (!existente && !nombre.trim())}
      >
        {guardando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        Usar
      </Button>
    </div>
  );
}
