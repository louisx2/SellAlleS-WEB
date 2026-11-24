'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCaja } from '@/context/caja-provider';
import { useModules } from '@/context/modules-provider';
import { usePermission } from '@/hooks/use-permission';
import { useCobranza, useCuentasDeCobro } from '@/hooks/use-cobranza';
import { formatCurrency, cn } from '@/lib/utils';
import { EntregaDialog } from '@/components/motos/cobranza/entrega-dialog';
import type { Cobrador } from '@/lib/types';

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-DO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Cuadre de los cobradores de la sucursal: el efectivo que cobró cada uno y
// todavía no entregó, recibir la entrega y el historial de entregas.
export default function CuadreCobradoresPage() {
  const { clientes } = useCuentasDeCobro();
  const { isOpen, branchUsesCaja } = useCaja();
  const { isModuleEnabled } = useModules();
  const puedeRecibir = usePermission('cobranza-cuadre', 'create');
  const { cobradores, abonosSinEntregar, entregas, recibirEntrega, loading } = useCobranza();
  const [recibir, setRecibir] = useState<Cobrador | null>(null);

  const usaCaja = isModuleEnabled('caja') && branchUsesCaja === true;
  const nombreCliente = (id: string) => clientes.get(id)?.name ?? 'Cliente';
  const nombreCobrador = (id: string) => cobradores.find((c) => c.id === id)?.name ?? 'Cobrador';

  const porCobrador = useMemo(() => cobradores
    .map((c) => {
      const suyos = abonosSinEntregar.filter((a) => a.collectorId === c.id);
      return { cobrador: c, abonos: suyos, total: Math.round(suyos.reduce((s, a) => s + a.amount, 0) * 100) / 100 };
    })
    .filter((g) => g.abonos.length > 0), [cobradores, abonosSinEntregar]);

  const grupo = porCobrador.find((g) => g.cobrador.id === recibir?.id);

  return (
    <div>
      <PageHeader title="Cuadre de cobradores" />
      {usaCaja && !isOpen && (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          No hay caja abierta en esta sucursal: ábrela para recibir entregas (lo recibido entra a la caja).
        </p>
      )}

      <div className="grid gap-4">
        {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!loading && porCobrador.length === 0 && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Ningún cobrador tiene efectivo sin entregar.</CardContent></Card>
        )}
        {porCobrador.map((g) => (
          <Card key={g.cobrador.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">{g.cobrador.name}</CardTitle>
                <CardDescription>{g.abonos.length} {g.abonos.length === 1 ? 'abono' : 'abonos'} en efectivo sin entregar</CardDescription>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold">{formatCurrency(g.total)}</p>
                {puedeRecibir && (
                  <Button size="sm" className="mt-1" onClick={() => setRecibir(g.cobrador)} disabled={usaCaja && !isOpen}>Recibir entrega</Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>Cobrado</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.abonos.map((a) => (
                    <TableRow key={`${a.tipo}-${a.id}`}>
                      <TableCell>{nombreCliente(a.customerId)}</TableCell>
                      <TableCell>{a.tipo === 'prestamo' ? 'Préstamo' : 'Venta'}</TableCell>
                      <TableCell className="whitespace-nowrap">{fechaHora(a.date)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCurrency(a.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entregas recientes</CardTitle>
            <CardDescription>Lo esperado es la suma de los abonos en efectivo entregados; la diferencia queda a cargo del cobrador.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cobrador</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead>Recibió</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entregas.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Todavía no hay entregas.</TableCell></TableRow>
                )}
                {entregas.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{fechaHora(e.createdAt)}</TableCell>
                    <TableCell>{nombreCobrador(e.collectorId)}{e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatCurrency(e.expected)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatCurrency(e.received)}</TableCell>
                    <TableCell className={cn('text-right whitespace-nowrap', e.difference < 0 && 'text-destructive')}>
                      {e.difference === 0 ? '—' : formatCurrency(e.difference)}
                    </TableCell>
                    <TableCell>{e.receivedByName ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <EntregaDialog
        cobrador={recibir}
        esperado={grupo?.total ?? 0}
        abonos={grupo?.abonos.length ?? 0}
        usaCaja={usaCaja}
        open={!!recibir}
        onOpenChange={(o) => !o && setRecibir(null)}
        onRecibir={recibirEntrega}
      />
    </div>
  );
}
