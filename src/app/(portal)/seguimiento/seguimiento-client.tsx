'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Circle, ClipboardList, Home, MessageCircle, Phone, ShieldCheck, UserRound, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { caseNumber, customerText, SERVICE_STATUS, statusLabel, whatsappPhone, type StatusCtx } from '@/lib/taller';
import { formatCurrency } from '@/lib/utils';
import type { ServiceStatus } from '@/lib/types';

type Seguimiento = {
  negocio: { nombre: string; telefono?: string | null; direccion?: string | null; logo?: string | null };
  caso: {
    numero: number; estado: ServiceStatus; equipo?: string | null; tipo_equipo?: string | null; cliente?: string;
    ingreso: string; prometido?: string | null; listo?: string | null; entregado?: string | null;
    total: number; cobrado: boolean; garantia_hasta?: string | null;
    /** El camino de la orden (antes de Servicios no venían: taller de reparación que se queda). */
    se_queda?: boolean | null; reparacion?: boolean | null; a_domicilio?: boolean | null;
    /** Marca y modelo de la ficha, o null si no tiene. */
    ficha?: string | null;
    /** Primer nombre de quien atiende. */
    atiende?: string | null;
  };
  avance: { estado: ServiceStatus; nota?: string | null; fecha: string }[];
  notas: { nota: string; fecha: string }[];
};

type Paso = { clave: string; texto: string; estados: ServiceStatus[] };

// Los pasos que ve el cliente, según el camino de la orden. Los estados de
// reparación (diagnóstico, esperando aprobación o pieza) van dentro de «en proceso».
//   se queda:    Recibido → En proceso → Listo → Entregado
//   no se queda: Llegó → En proceso → Terminado
function pasosDe(ctx: StatusCtx): Paso[] {
  const enProceso: ServiceStatus[] = ctx.isRepair
    ? ['diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair']
    : ['in_repair'];
  const inicio: Paso = { clave: 'inicio', texto: statusLabel('received', ctx), estados: ['received'] };
  const fin: Paso = { clave: 'fin', texto: statusLabel('delivered', ctx), estados: ['delivered'] };
  if (ctx.staysInShop) {
    return [
      inicio,
      { clave: 'proceso', texto: statusLabel('in_repair', ctx), estados: enProceso },
      { clave: 'listo', texto: 'Listo', estados: ['ready', 'not_repaired'] },
      fin,
    ];
  }
  // Sin «Listo»: lo que no se pudo reparar se termina igual.
  return [
    inicio,
    { clave: 'proceso', texto: statusLabel('in_repair', ctx), estados: [...enProceso, 'not_repaired'] },
    fin,
  ];
}

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
      ? ['Buscando tu orden…', '']
      : estado === 'error'
        ? ['No se pudo cargar', 'Vuelve a intentarlo en un momento.']
        : ['Enlace no encontrado', 'Verifica que copiaste el enlace completo, o pídeselo de nuevo al negocio.'];
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
  const ctx: StatusCtx = { staysInShop: caso.se_queda ?? true, isRepair: caso.reparacion ?? true };
  const conFicha = !!(caso.ficha || caso.tipo_equipo);
  const cancelado = caso.estado === 'cancelled';
  // Sin ficha y cerrada: el cliente ya se fue atendido.
  const textoEstado = !SERVICE_STATUS[caso.estado]
    ? caso.estado
    : !conFicha && caso.estado === 'delivered' ? '¡Gracias por visitarnos!' : customerText(caso.estado, ctx);
  const pasos = pasosDe(ctx);
  const pasoActual = pasos.findIndex((p) => p.estados.includes(caso.estado));
  const titulo = (st: ServiceStatus) => (SERVICE_STATUS[st] ? statusLabel(st, ctx) : st);
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
            {caso.cliente ? `Hola ${caso.cliente}, esta es tu ` : 'Tu '}orden {caseNumber(caso.numero)}
          </p>
          {conFicha && (
            <p className="mt-1 flex items-center gap-2 font-medium">
              {ctx.isRepair
                ? <Wrench className="h-4 w-4 text-slate-400" aria-hidden />
                : <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />}
              {[caso.tipo_equipo, caso.ficha ?? caso.equipo].filter(Boolean).join(' · ')}
            </p>
          )}
          {(caso.a_domicilio || caso.atiende) && (
            <div className="mt-1 space-y-0.5 text-sm text-slate-600">
              {caso.a_domicilio && (
                <p className="flex items-center gap-2"><Home className="h-4 w-4 text-slate-400" aria-hidden />Servicio a domicilio</p>
              )}
              {caso.atiende && (
                <p className="flex items-center gap-2"><UserRound className="h-4 w-4 text-slate-400" aria-hidden />{caso.estado === 'delivered' ? 'Te atendió' : 'Te atiende'} {caso.atiende}</p>
              )}
            </div>
          )}
          <p className={`mt-4 text-2xl font-bold ${cancelado ? 'text-slate-500' : caso.estado === 'ready' || caso.estado === 'delivered' ? 'text-emerald-700' : 'text-slate-900'}`}>
            {textoEstado}
          </p>
          {caso.prometido && !caso.listo && !cancelado && (
            <p className="mt-1 text-sm text-slate-600">Fecha estimada: {dia(caso.prometido)}</p>
          )}
          {porCobrar && (caso.estado === 'ready' || caso.estado === 'not_repaired') && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Total a pagar al retirar: {formatCurrency(caso.total)}</p>
          )}
          {/* La garantía es de las reparaciones. */}
          {ctx.isRepair && caso.garantia_hasta && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-800">
              <ShieldCheck className="h-4 w-4" aria-hidden />Garantía hasta el {dia(caso.garantia_hasta)}
            </p>
          )}

          {!cancelado && (
            <ol className={`mt-5 grid ${pasos.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-1 text-center text-xs`}>
              {pasos.map((p, i) => {
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
              ...data.avance.map((a) => ({ fecha: a.fecha, titulo: titulo(a.estado), nota: a.nota })),
              ...data.notas.map((n) => ({ fecha: n.fecha, titulo: `Nota de ${negocio.nombre}`, nota: n.nota })),
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
                href={`https://api.whatsapp.com/send?phone=${wa}&text=${encodeURIComponent(`Hola, pregunto por mi orden ${caseNumber(caso.numero)}.`)}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />WhatsApp
              </a>
            )}
          </div>
        )}
        <p className="text-center text-xs text-slate-400">Orden del {dia(caso.ingreso)} · SellAlleS</p>
      </div>
    </main>
  );
}
