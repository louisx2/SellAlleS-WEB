'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, MessageCircle } from 'lucide-react';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { usePermission } from '@/hooks/use-permission';
import { useCobranza, useCuentasDeCobro } from '@/hooks/use-cobranza';
import { useMotosAjustes } from '@/hooks/use-motos-ajustes';
import { avisosDelDia, type Aviso } from '@/lib/cobranza';
import {
  AVISO_BASE, MARCADORES_AVISO, estadoDeCuota, llenarMensaje, marcadoresDesconocidosEn,
} from '@/lib/cobranza-mensajes';
import { hoyLocal } from '@/lib/subscription-status';
import { whatsappPhone } from '@/lib/taller';
import { formatCurrency } from '@/lib/utils';

const TODOS = '__todos__';
const SIN_ASIGNAR = '__sin__';

const fechaCorta = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });

// Avisos de cuota del día por WhatsApp: a quien tiene cuota mañana, hoy o algo
// atrasado, un toque abre el chat con el mensaje escrito. «Enviado» se recuerda
// en este teléfono durante el día (no en la base).
export default function AvisosDeCobroPage() {
  const verTodas = usePermission('cobranza-all', 'view');
  const { profile } = useCompanyProfile();
  const { ajustes } = useMotosAjustes();
  const { branchId, cobradores, asignaciones, miCobrador, loading: cargandoCartera } = useCobranza();
  const { cuentas, clientes, loading: cargandoCuentas } = useCuentasDeCobro();
  const [filtro, setFiltro] = useState<string>(TODOS);
  const [enviados, setEnviados] = useState<Set<string>>(new Set());
  const hoy = hoyLocal();
  const clave = `avisos:${branchId}:${hoy}`;
  const loading = cargandoCartera || cargandoCuentas;

  useEffect(() => {
    try { setEnviados(new Set(JSON.parse(localStorage.getItem(clave) ?? '[]'))); } catch { setEnviados(new Set()); }
  }, [clave]);

  const plantilla = ajustes.whatsappReminder?.trim() || AVISO_BASE;
  const desconocidos = marcadoresDesconocidosEn(plantilla, MARCADORES_AVISO.map((m) => m.clave));

  // Sin «ver todas las rutas», solo la cartera propia; con él, la sucursal o un cobrador.
  const avisos = useMemo(() => {
    let clientesFiltro: Set<string> | undefined;
    if (!verTodas) {
      clientesFiltro = new Set(asignaciones.filter((a) => a.collectorId === miCobrador?.id).map((a) => a.customerId));
    } else if (filtro === SIN_ASIGNAR) {
      const asignados = new Set(asignaciones.map((a) => a.customerId));
      clientesFiltro = new Set(cuentas.map((c) => c.customerId).filter((id) => !asignados.has(id)));
    } else if (filtro !== TODOS) {
      clientesFiltro = new Set(asignaciones.filter((a) => a.collectorId === filtro).map((a) => a.customerId));
    }
    return avisosDelDia(cuentas, hoy, clientesFiltro);
  }, [verTodas, asignaciones, miCobrador?.id, filtro, cuentas, hoy]);

  const mensajeDe = (a: Aviso) => llenarMensaje(plantilla, {
    cliente: clientes.get(a.customerId)?.name ?? 'cliente',
    monto: formatCurrency(a.monto),
    estado: estadoDeCuota(a.motivo, a.diasAtraso),
    fecha: fechaCorta(a.fecha),
    empresa: profile.name,
  });

  const marcar = (customerId: string) => {
    const n = new Set(enviados).add(customerId);
    setEnviados(n);
    try { localStorage.setItem(clave, JSON.stringify([...n])); } catch { /* sin almacenamiento: solo en pantalla */ }
  };

  const enviadosHoy = avisos.filter((a) => enviados.has(a.customerId)).length;

  if (!loading && !verTodas && !miCobrador) {
    return (
      <div>
        <PageHeader title="Avisos de cobro" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No estás registrado como cobrador en esta sucursal. Pide que te marquen en Configuración de Motopréstamos → Cobradores.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Avisos de cobro" />

      <div className="mb-4 grid gap-3">
        {verTodas && (
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="w-full sm:w-64" aria-label="Cartera"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Toda la sucursal</SelectItem>
              <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
              {cobradores.filter((c) => c.isActive).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <p className="text-sm text-muted-foreground">
          {avisos.length} {avisos.length === 1 ? 'cliente para avisar' : 'clientes para avisar'} · {enviadosHoy} {enviadosHoy === 1 ? 'enviado' : 'enviados'} hoy
        </p>
        {desconocidos.length > 0 && (
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
            El mensaje tiene marcadores que no se reconocen ({desconocidos.map((d) => `{${d}}`).join(', ')}): saldrán tal cual.{' '}
            <Link href="/motos/config" className="underline">Revisar el mensaje</Link>
          </p>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {!loading && avisos.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Nadie para avisar hoy: ninguna cuota de mañana, de hoy ni atrasada.
        </CardContent></Card>
      )}

      <div className="grid gap-2">
        {avisos.map((a) => {
          const c = clientes.get(a.customerId);
          const tel = whatsappPhone(c?.phone);
          const href = `https://wa.me/${tel}?text=${encodeURIComponent(mensajeDe(a))}`;
          const enviado = enviados.has(a.customerId);
          return (
            <Card key={a.customerId} className={enviado ? 'opacity-70' : undefined}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c?.name ?? 'Cliente'}
                    {c?.nickname && <span className="font-normal text-muted-foreground"> «{c.nickname}»</span>}
                  </p>
                  <p className="text-sm">
                    {formatCurrency(a.monto)} ·{' '}
                    <span className={a.motivo === 'atrasado' ? 'text-destructive' : 'text-muted-foreground'}>
                      {estadoDeCuota(a.motivo, a.diasAtraso)}
                    </span>
                  </p>
                  {!tel && <p className="text-xs text-muted-foreground">Sin teléfono: WhatsApp pedirá elegir el chat.</p>}
                </div>
                <div className="flex items-center gap-2">
                  {enviado && <Badge variant="secondary"><Check className="mr-1 h-3 w-3" /> Enviado</Badge>}
                  <Button asChild variant={enviado ? 'outline' : 'default'}>
                    <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => marcar(a.customerId)}>
                      <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
