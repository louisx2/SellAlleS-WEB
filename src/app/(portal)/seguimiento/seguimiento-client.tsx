'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Circle, MessageCircle, Phone, ShieldCheck, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { caseNumber, SERVICE_STATUS, whatsappPhone } from '@/lib/taller';
import { formatCurrency } from '@/lib/utils';
import type { ServiceStatus } from '@/lib/types';

type Seguimiento = {
  negocio: { nombre: string; telefono?: string | null; direccion?: string | null; logo?: string | null };
  caso: {
    numero: number; estado: ServiceStatus; equipo?: string | null; tipo_equipo?: string | null; cliente?: string;
    ingreso: string; prometido?: string | null; listo?: string | null; entregado?: string | null;
    total: number; cobrado: boolean; garantia_hasta?: string | null;
  };
  avance: { estado: ServiceStatus; nota?: string | null; fecha: string }[];
  notas: { nota: string; fecha: string }[];
};

// Los pasos que ve el cliente, en orden. Los estados intermedios (diagnóstico,
// esperando aprobación o pieza) se muestran como "en el taller".
const PASOS: { clave: string; texto: string; estados: ServiceStatus[] }[] = [
  { clave: 'recibido', texto: 'Recibido', estados: ['received'] },
  { clave: 'taller', texto: 'En el taller', estados: ['diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair'] },
  { clave: 'listo', texto: 'Listo', estados: ['ready', 'not_repaired'] },
  { clave: 'entregado', texto: 'Entregado', estados: ['delivered'] },
];

const fecha = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('es-DO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const dia = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export default function SeguimientoClient() {
  const params = useSearchParams();
  const code = (params.get('c') ?? '').trim();
  const [data, setData] = useState<Seguimiento | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'no-existe' | 'error'>('cargando');

  useEffect(() => {
    if (!code) { setEstado('no-existe'); return; }
    supabase.rpc('taller_seguimiento_publico', { p_code: code }).then(({ data, error }) => {
      if (error) { setEstado('error'); return; }
      if (!data) { setEstado('no-existe'); return; }
      setData(data as Seguimiento);
      setEstado('listo');
    });
  }, [code]);

  if (estado !== 'listo' || !data) {
    const [titulo, detalle] = estado === 'cargando'
      ? ['Buscando tu equipo…', '']
      : estado === 'error'
        ? ['No se pudo cargar', 'Vuelve a intentarlo en un momento.']
        : ['Enlace no encontrado', 'Verifica que copiaste el enlace completo, o pídeselo de nuevo al taller.'];
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">{titulo}</h1>
          {detalle && <p className="mt-2 text-slate-600">{detalle}</p>}
        </div>
      </main>
    );
  }

  const { negocio, caso } = data;
  const meta = SERVICE_STATUS[caso.estado];
  const cancelado = caso.estado === 'cancelled';
  const pasoActual = PASOS.findIndex((p) => p.estados.includes(caso.estado));
  const wa = whatsappPhone(negocio.telefono);
  const porCobrar = !caso.cobrado && caso.total > 0;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md space-y-4">
        <header className="text-center">
          {negocio.logo && (
            <img src={negocio.logo} alt="" className="mx-auto mb-2 max-h-16 max-w-[60%] object-contain" />
          )}
          <p className="text-lg font-semibold">{negocio.nombre}</p>
          {negocio.direccion && <p className="text-sm text-slate-500">{negocio.direccion}</p>}
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            {caso.cliente ? `Hola ${caso.cliente}, este es tu ` : 'Tu '}caso {caseNumber(caso.numero)}
          </p>
          <p className="mt-1 flex items-center gap-2 font-medium">
            <Wrench className="h-4 w-4 text-slate-400" aria-hidden />
            {[caso.tipo_equipo, caso.equipo].filter(Boolean).join(' · ') || 'Tu equipo'}
          </p>
          <p className={`mt-4 text-2xl font-bold ${cancelado ? 'text-slate-500' : caso.estado === 'ready' ? 'text-emerald-700' : 'text-slate-900'}`}>
            {meta?.customerText ?? caso.estado}
          </p>
          {caso.prometido && !caso.listo && !cancelado && (
            <p className="mt-1 text-sm text-slate-600">Fecha estimada: {dia(caso.prometido)}</p>
          )}
          {porCobrar && (caso.estado === 'ready' || caso.estado === 'not_repaired') && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Total a pagar al retirar: {formatCurrency(caso.total)}</p>
          )}
          {caso.garantia_hasta && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-800">
              <ShieldCheck className="h-4 w-4" aria-hidden />Garantía hasta el {dia(caso.garantia_hasta)}
            </p>
          )}

          {!cancelado && (
            <ol className="mt-5 grid grid-cols-4 gap-1 text-center text-xs">
              {PASOS.map((p, i) => {
                const hecho = i <= pasoActual;
                return (
                  <li key={p.clave} className="flex flex-col items-center gap-1">
                    {hecho
                      ? <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden />
                      : <Circle className="h-6 w-6 text-slate-300" aria-hidden />}
                    <span className={hecho ? 'font-medium text-slate-800' : 'text-slate-400'}>{p.texto}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Avance</h2>
          <ol className="space-y-3">
            {[
              ...data.avance.map((a) => ({ fecha: a.fecha, titulo: SERVICE_STATUS[a.estado]?.label ?? a.estado, nota: a.nota })),
              ...data.notas.map((n) => ({ fecha: n.fecha, titulo: 'Nota del taller', nota: n.nota })),
            ]
              .sort((a, b) => b.fecha.localeCompare(a.fecha))
              .map((e, i) => (
                <li key={i} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-sm font-medium">{e.titulo}</p>
                  {e.nota && <p className="text-sm text-slate-700">{e.nota}</p>}
                  <p className="text-xs text-slate-500">{fecha(e.fecha)}</p>
                </li>
              ))}
          </ol>
        </section>

        {(negocio.telefono || wa) && (
          <div className="grid grid-cols-2 gap-2">
            {negocio.telefono && (
              <a href={`tel:${negocio.telefono}`} className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium">
                <Phone className="h-4 w-4" aria-hidden />Llamar
              </a>
            )}
            {wa && (
              <a
                href={`https://api.whatsapp.com/send?phone=${wa}&text=${encodeURIComponent(`Hola, pregunto por mi caso ${caseNumber(caso.numero)}.`)}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />WhatsApp
              </a>
            )}
          </div>
        )}
        <p className="text-center text-xs text-slate-400">Ingresó el {dia(caso.ingreso)} · SellAlleS</p>
      </div>
    </main>
  );
}
