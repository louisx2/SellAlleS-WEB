'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSignature } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModules } from '@/context/modules-provider';
import { supabase } from '@/lib/supabase/client';
import type { TipoContrato } from '@/lib/contrato';

/** Botón «Contrato» hacia /motos/contrato. Con `verificar`, solo sale si la
 *  cuenta tiene una moto enlazada (para el detalle de la venta, donde casi
 *  nunca la hay). */
export function ContratoBoton({ tipo, id, verificar = false, size = 'default' }: {
  tipo: TipoContrato; id: string; verificar?: boolean; size?: 'default' | 'sm';
}) {
  const { isModuleEnabled } = useModules();
  const activo = isModuleEnabled('motoprestamos');
  const [conMoto, setConMoto] = useState(!verificar);

  useEffect(() => {
    if (!activo || !verificar || !id) return;
    let vigente = true;
    supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq(tipo === 'venta' ? 'sale_id' : 'loan_id', id)
      .then(({ count }) => { if (vigente) setConMoto((count ?? 0) > 0); });
    return () => { vigente = false; };
  }, [activo, verificar, tipo, id]);

  if (!activo || !conMoto) return null;
  return (
    <Button asChild variant="outline" size={size}>
      <Link href={`/motos/contrato?tipo=${tipo}&id=${id}`}>
        <FileSignature className="mr-2 h-4 w-4" /> Contrato
      </Link>
    </Button>
  );
}
