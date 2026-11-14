'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { supabase } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { rowToSale } from '@/lib/supabase/mappers';
import type { Sale } from '@/lib/types';

// Ventas de un rango de fechas, de una sucursal o de todas (lo que la RLS deje
// ver). Los reportes no usan el provider de ventas: ese solo trae la sucursal
// activa y PostgREST lo corta en 1000 filas, así que un ranking de un año
// saldría con lo de las últimas semanas. Aquí se pide por páginas.
//
// `conItems` trae las líneas (para el producto estrella); sin ellas la
// consulta es mucho más liviana (cliente estrella, comisiones).
export function useVentasPeriodo(opts: { rango: DateRange | undefined; branchId: string; conItems: boolean }) {
  const { rango, branchId, conItems } = opts;
  const [ventas, setVentas] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const desde = rango?.from;
  const hasta = rango?.to ?? rango?.from;
  const desdeIso = useMemo(() => {
    if (!desde) return null;
    const d = new Date(desde);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [desde]);
  const hastaIso = useMemo(() => {
    if (!hasta) return null;
    const d = new Date(hasta);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [hasta]);

  useEffect(() => {
    if (!desdeIso || !hastaIso) return;
    let cancelado = false;
    setLoading(true);
    setError(null);
    const select = conItems
      ? '*, sale_items(*), customers(*), branches(name)'
      : '*, customers(*), branches(name)';
    fetchAllRows((ini, fin) => {
      let q = supabase
        .from('sales')
        .select(select)
        .gte('created_at', desdeIso)
        .lte('created_at', hastaIso)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(ini, fin);
      if (branchId !== 'all') q = q.eq('branch_id', branchId);
      return q;
    })
      .then((filas) => {
        if (!cancelado) setVentas(filas.map(rowToSale));
      })
      .catch((e: any) => {
        // Mejor nada que un ranking a medias que parezca completo.
        if (!cancelado) {
          setVentas([]);
          setError(e?.message ?? 'No se pudieron cargar las ventas.');
        }
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => { cancelado = true; };
  }, [desdeIso, hastaIso, branchId, conItems, version]);

  return { ventas, loading, error, recargar: () => setVersion((v) => v + 1) };
}
