'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircle, Phone } from 'lucide-react';
import { useAuth } from '@/context/auth-provider';
import { useCustomers } from '@/context/customer-provider';
import { usePermission } from '@/hooks/use-permission';
import { useCobranza, useCuentasDeCobro } from '@/hooks/use-cobranza';
import { useVehiculos } from '@/hooks/use-vehiculos';
import { resumenDelCobrador, rutaDelDia, TEXTO_RESULTADO, type ParadaDeRuta, type Promesa } from '@/lib/cobranza';
import { fechaLocal, hoyLocal } from '@/lib/subscription-status';
import { vehicleLabel } from '@/lib/motos';
import { whatsappPhone } from '@/lib/taller';
import { formatCurrency } from '@/lib/utils';
import { CobrarDialog } from '@/components/motos/cobranza/cobrar-dialog';
import { VisitaDialog } from '@/components/motos/cobranza/visita-dialog';

const fechaCorta = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });

// La ruta del día del cobrador (primero móvil): sus clientes con algo atrasado,
// algo que vence hoy o una promesa para hoy, con lo sugerido para cobrar.
// Con «ver todas las rutas» se elige otro cobrador.
export default function CobranzaPage() {
  const { appUser } = useAuth();
  const verTodas = usePermission('cobranza-all', 'view');
  const { customers } = useCustomers();
  const { vehicles } = useVehiculos();
  const cobranza = useCobranza();
  const cuentas = useCuentasDeCobro();
  const { cobradores, asignaciones, visitasRecientes, abonos, miCobrador, loading } = cobranza;
  const [elegido, setElegido] = useState<string>('');
  const [ordenarPor, setOrdenarPor] = useState<'orden' | 'atraso'>('orden');
  const [cobrar, setCobrar] = useState<ParadaDeRuta | null>(null);
  const [visita, setVisita] = useState<ParadaDeRuta | null>(null);

  const hoy = hoyLocal();
  const cobradorId = elegido || miCobrador?.id || '';
  const cobrador = cobradores.find((c) => c.id === cobradorId);
  const cliente = (id: string) => customers.find((c) => c.id === id);

  const paradas = useMemo(() => {
    const asignados = asignaciones
      .filter((a) => a.collectorId === cobradorId)
      .map((a) => ({ customerId: a.customerId, orden: a.orden, nombre: customers.find((c) => c.id === a.customerId)?.name }));
    const promesas: Promesa[] = visitasRecientes
      .filter((v) => v.outcome === 'promesa' && v.promiseDate)
      .map((v) => ({ customerId: v.customerId, fecha: v.promiseDate!, monto: v.promiseAmount }));
    return rutaDelDia(cuentas, asignados, promesas, hoy, ordenarPor);
  }, [asignaciones, cobradorId, customers, visitasRecientes, cuentas, hoy, ordenarPor]);

  const resumen = useMemo(() => resumenDelCobrador(
    abonos.filter((a) => a.collectorId === cobradorId).map((a) => ({
      monto: a.amount, metodo: a.method === 'cash' ? 'cash' : 'transfer', enCalle: a.enCalle,
      entregado: !!a.settlementId, anulado: a.voided, fecha: fechaLocal(a.date),
    })),
    hoy,
  ), [abonos, cobradorId, hoy]);

  // La última visita de hoy de cada cliente, para marcar lo ya visitado.
  const visitadoHoy = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of visitasRecientes) {
      if (fechaLocal(v.createdAt) === hoy && !m.has(v.customerId)) m.set(v.customerId, TEXTO_RESULTADO[v.outcome]);
    }
    return m;
  }, [visitasRecientes, hoy]);

  const porCobrar = paradas.reduce((s, p) => s + p.sugerido, 0);
  const puedeCobrar = !!miCobrador;

  if (!loading && !miCobrador && !verTodas) {
    return (
      <div>
        <PageHeader title="Ruta de hoy" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No estás registrado como cobrador en esta sucursal. Pide que te marquen en Configuración de
          Motopréstamos → Cobradores.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Ruta de hoy" />

      <div className="mb-4 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {verTodas ? (
            <Select value={cobradorId} onValueChange={setElegido}>
              <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Elige un cobrador" /></SelectTrigger>
              <SelectContent>
                {cobradores.filter((c) => c.isActive).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}{c.profileId === appUser?.id ? ' (yo)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="font-medium">{cobrador?.name} · cobrador</p>
          )}
          <div className="ml-auto flex rounded-md border p-0.5" role="radiogroup" aria-label="Orden de la ruta">
            {(['orden', 'atraso'] as const).map((o) => (
              <Button key={o} size="sm" variant={ordenarPor === o ? 'secondary' : 'ghost'} role="radio" aria-checked={ordenarPor === o} onClick={() => setOrdenarPor(o)}>
                {o === 'orden' ? 'Por visita' : 'Por atraso'}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Por cobrar</p><p className="font-semibold">{formatCurrency(porCobrar)}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Cobrado hoy</p><p className="font-semibold">{formatCurrency(resumen.cobradoHoy)}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">En mano</p><p className="font-semibold">{formatCurrency(resumen.enMano)}</p>
            {resumen.enManoDesde && resumen.enManoDesde < hoy && <p className="text-xs text-amber-700 dark:text-amber-300">desde el {fechaCorta(resumen.enManoDesde)}</p>}
          </CardContent></Card>
        </div>
        {verTodas && !puedeCobrar && (
          <p className="text-sm text-muted-foreground">Ves la ruta, pero no cobras desde aquí: no estás registrado como cobrador en esta sucursal.</p>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Cargando la ruta…</p>}
      {!loading && cobradorId && paradas.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Nada que cobrar hoy en esta ruta: ningún cliente atrasado, con cuota de hoy o con promesa para hoy.
        </CardContent></Card>
      )}

      <div className="grid gap-3">
        {paradas.map((p) => {
          const c = cliente(p.customerId);
          const motos = vehicles.filter((v) => v.customerId === p.customerId && (v.status === 'vendido' || v.status === 'en_garantia'));
          const cuota = p.cuentas.filter((x) => x.diasAtraso > 0 || x.venceHoy).reduce((s, x) => s + Math.min(x.pendiente, x.cuota), 0);
          const mora = p.cuentas.reduce((s, x) => s + x.mora, 0);
          const tel = (c?.phone ?? '').replace(/\D/g, '');
          const wa = whatsappPhone(c?.phone);
          const visitado = visitadoHoy.get(p.customerId);
          return (
            <Card key={p.customerId} className={visitado ? 'opacity-75' : undefined}>
              <CardContent className="grid gap-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      <Link href={`/customers/history?id=${p.customerId}`} className="hover:underline">{c?.name ?? 'Cliente'}</Link>
                      {c?.nickname && <span className="font-normal text-muted-foreground"> «{c.nickname}»</span>}
                    </p>
                    {(c?.zone || c?.collectionAddress) && (
                      <p className="text-sm text-muted-foreground">{[c?.zone, c?.collectionAddress].filter(Boolean).join(' · ')}</p>
                    )}
                    {c?.collectionReference && <p className="text-xs text-muted-foreground">{c.collectionReference}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(p.sugerido)}</p>
                    {p.motivo !== 'promesa' && (
                      <p className="text-xs text-muted-foreground">Cuota {formatCurrency(cuota)}{mora > 0 ? ` + mora ${formatCurrency(mora)}` : ''}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {motos.map((v) => (
                    <span key={v.id} className="text-muted-foreground">{vehicleLabel(v)}{v.plate ? ` · ${v.plate}` : ''}</span>
                  ))}
                  {p.diasAtraso > 0 && <Badge variant="destructive">{p.diasAtraso} {p.diasAtraso === 1 ? 'día' : 'días'} de atraso</Badge>}
                  {p.motivo === 'vence_hoy' && <Badge variant="secondary">Vence hoy</Badge>}
                  {p.promesa && <Badge variant="outline">Prometió pagar hoy{p.promesa.monto ? ` ${formatCurrency(p.promesa.monto)}` : ''}</Badge>}
                  {visitado && <Badge variant="outline">Visitado: {visitado}</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button onClick={() => setCobrar(p)} disabled={!puedeCobrar}>Cobrar</Button>
                  <Button variant="outline" onClick={() => setVisita(p)} disabled={!puedeCobrar}>No pagó</Button>
                  <Button variant="outline" asChild disabled={!wa}>
                    <a href={wa ? `https://wa.me/${wa}` : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!wa}>
                      <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                    </a>
                  </Button>
                  <Button variant="outline" asChild disabled={!tel}>
                    <a href={tel ? `tel:${tel}` : undefined} aria-disabled={!tel}><Phone className="mr-2 h-4 w-4" /> Llamar</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <CobrarDialog
        parada={cobrar}
        nombre={cobrar ? cliente(cobrar.customerId)?.name ?? 'Cliente' : ''}
        open={!!cobrar}
        onOpenChange={(o) => !o && setCobrar(null)}
        onCobrar={cobranza.registrarAbono}
      />
      <VisitaDialog
        customerId={visita?.customerId ?? null}
        nombre={visita ? cliente(visita.customerId)?.name ?? 'Cliente' : ''}
        open={!!visita}
        onOpenChange={(o) => !o && setVisita(null)}
        onGuardar={cobranza.registrarVisita}
      />
    </div>
  );
}
