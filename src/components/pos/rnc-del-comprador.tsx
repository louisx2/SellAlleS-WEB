'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RncConDgii } from '@/components/dgii/rnc-con-dgii';
import { useCustomers } from '@/context/customer-provider';
import { useAuth } from '@/context/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { formatCedulaOrRnc } from '@/lib/format';
import {
  buscarClientePorDocumento,
  cascadaNombre,
  destinoDelComprador,
  digitosDeDocumento,
  nombresParecidos,
  type DatosRnc,
} from '@/lib/rnc';
import type { Customer, NcfType } from '@/lib/types';

// Al cobrar con un comprobante que pide RNC (crédito fiscal, gubernamental,
// régimen especial) y el cliente del carrito no tiene uno válido: se escribe el
// RNC del comprador ahí mismo. La DGII trae la razón social, y "Usar" hace una
// de tres cosas (destinoDelComprador):
//  - el documento ya es de un cliente: ese pasa al carrito;
//  - el carrito tiene un cliente real sin RNC: se le guarda a él (lo normal), o,
//    si la factura va a otra persona o empresa, se crea otro cliente;
//  - no hay cliente en el carrito: se crea uno.

interface RncDelCompradorProps {
  /** El tipo de comprobante elegido: es el que queda guardado en el cliente nuevo. */
  ncfType: NcfType;
  /** El cliente real del carrito (no el consumidor final), que no tiene RNC válido. */
  clienteCarrito?: Customer;
  onClienteListo: (cliente: Customer) => void;
}

export function RncDelComprador({ ncfType, clienteCarrito, onClienteListo }: RncDelCompradorProps) {
  const { customers, addCustomer, setCustomerRnc } = useCustomers();
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [rnc, setRnc] = useState('');
  const [nombre, setNombre] = useState('');
  const [ofrecerNombre, setOfrecerNombre] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  // Con un cliente en el carrito: guardárselo a él, o crear otro.
  const [paraQuien, setParaQuien] = useState<'carrito' | 'otro'>('carrito');
  // La razón social que trajo la DGII para el documento escrito, para avisar si
  // no se parece al nombre del cliente del carrito.
  const [razonDgii, setRazonDgii] = useState<string | undefined>();
  // El último nombre que puso la DGII: al corregir un RNC mal escrito no puede
  // quedar el nombre de la otra empresa (ver cascadaNombre).
  const nombreAutomatico = useRef<string | undefined>(undefined);

  const digitos = digitosDeDocumento(rnc);
  const existente = digitos ? buscarClientePorDocumento(customers, digitos) : undefined;
  const completo = digitos.length === 9 || digitos.length === 11;
  const destino = destinoDelComprador(existente, clienteCarrito);
  const guardarAlCarrito = destino === 'elegir' && paraQuien === 'carrito';
  const pideNombre = destino === 'crear' || (destino === 'elegir' && paraQuien === 'otro');
  const nombreDistinto =
    guardarAlCarrito && !!clienteCarrito && !!razonDgii && !nombresParecidos(clienteCarrito.name, razonDgii);

  const alEncontrarRnc = (datos: DatosRnc) => {
    setRazonDgii(datos.razonSocial);
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
      if (guardarAlCarrito && clienteCarrito) {
        const guardado = await setCustomerRnc(clienteCarrito.id, formatCedulaOrRnc(digitos));
        toast({ title: 'RNC guardado', description: `${guardado.name} ya tiene su RNC.` });
        onClienteListo(guardado);
        return;
      }
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
        title: guardarAlCarrito ? 'No se pudo guardar el RNC' : 'No se pudo crear el cliente',
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
            setRazonDgii(undefined);
          }}
          onDatos={alEncontrarRnc}
          ofrecerNombre={pideNombre ? ofrecerNombre : undefined}
          onUsarNombre={(n) => {
            setNombre(n);
            nombreAutomatico.current = n;
            setOfrecerNombre(undefined);
          }}
          disabled={guardando}
        />
      </div>

      {destino === 'existente' && existente && (
        <p className="text-xs text-muted-foreground">Ya es cliente: {existente.name}.</p>
      )}

      {destino === 'elegir' && clienteCarrito && (
        <RadioGroup
          value={paraQuien}
          onValueChange={(v) => setParaQuien(v as 'carrito' | 'otro')}
          disabled={guardando}
          className="gap-1.5"
        >
          <div className="flex items-start gap-2">
            <RadioGroupItem value="carrito" id="rnc-para-carrito" className="mt-0.5" />
            <Label htmlFor="rnc-para-carrito" className="text-xs font-normal leading-snug">
              Guardárselo a <span className="font-medium">{clienteCarrito.name}</span>
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="otro" id="rnc-para-otro" className="mt-0.5" />
            <Label htmlFor="rnc-para-otro" className="text-xs font-normal leading-snug">
              Es otro cliente (la factura va a otra persona o empresa)
            </Label>
          </div>
        </RadioGroup>
      )}

      {nombreDistinto && clienteCarrito && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          ⚠ La DGII dice que este documento es de {razonDgii}, no de {clienteCarrito.name}. Revisa el número, o
          elige &quot;Es otro cliente&quot; si la factura va a nombre de otro.
        </p>
      )}

      {pideNombre && (
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
        disabled={guardando || !completo || (pideNombre && !nombre.trim())}
      >
        {guardando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        Usar
      </Button>
    </div>
  );
}
