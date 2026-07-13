'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { useCaja } from '@/context/caja-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { OpenCajaDialog } from '@/components/caja/open-caja-dialog';
import { CloseCajaDialog } from '@/components/caja/close-caja-dialog';
import { CajaMovementDialog } from '@/components/caja/caja-movement-dialog';
import { Wallet, LockOpen, Lock, ArrowUpCircle, ArrowDownCircle, PlusCircle } from 'lucide-react';

function fmtDateTime(d: Date) {
  return d.toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function diffDisplay(d?: number) {
  if (d == null) return { label: '—', className: 'text-muted-foreground' };
  if (Math.abs(d) < 0.01) return { label: `${formatCurrency(0)} (cuadra)`, className: 'text-emerald-600 dark:text-emerald-400' };
  if (d < 0) return { label: `-${formatCurrency(Math.abs(d))} (faltante)`, className: 'text-destructive' };
  return { label: `+${formatCurrency(d)} (sobrante)`, className: 'text-amber-600 dark:text-amber-400' };
}

export default function CajaPage() {
  const { session, isOpen, history, loading } = useCaja();

  return (
    <div>
      <PageHeader title="Caja" />

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="space-y-6">
          {/* Estado actual */}
          {isOpen && session ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <LockOpen className="h-5 w-5 text-emerald-600" />
                  Caja abierta
                </CardTitle>
                <Badge className="bg-emerald-600">Abierta</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Monto inicial</p>
                    <p className="font-semibold">{formatCurrency(session.openingAmount)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Abierta</p>
                    <p className="font-semibold">{fmtDateTime(session.openedAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Abierta por</p>
                    <p className="font-semibold">{session.openedByName ?? '—'}</p>
                  </div>
                </div>

                {session.movements && session.movements.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Movimientos de este turno</p>
                    <div className="space-y-1">
                      {session.movements
                        .slice()
                        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                        .map((m) => (
                          <div key={m.id} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              {m.type === 'in'
                                ? <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
                                : <ArrowUpCircle className="h-4 w-4 text-destructive" />}
                              {m.reason || (m.type === 'in' ? 'Entrada' : 'Salida')}
                            </span>
                            <span className={m.type === 'in' ? 'text-emerald-600' : 'text-destructive'}>
                              {m.type === 'in' ? '+' : '-'}{formatCurrency(m.amount)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <CajaMovementDialog>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Movimiento
                      </Button>
                    </DialogTrigger>
                  </CajaMovementDialog>
                  <CloseCajaDialog session={session}>
                    <DialogTrigger asChild>
                      <Button>
                        <Lock className="mr-2 h-4 w-4" />
                        Cerrar caja
                      </Button>
                    </DialogTrigger>
                  </CloseCajaDialog>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="h-5 w-5 text-muted-foreground" />
                  No hay caja abierta
                </CardTitle>
                <CardDescription>
                  Abre la caja con el efectivo inicial para poder cobrar en efectivo en esta sucursal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OpenCajaDialog>
                  <DialogTrigger asChild>
                    <Button>
                      <LockOpen className="mr-2 h-4 w-4" />
                      Abrir caja
                    </Button>
                  </DialogTrigger>
                </OpenCajaDialog>
              </CardContent>
            </Card>
          )}

          {/* Historial de cierres */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Historial de cierres</CardTitle>
                <CardDescription>Sesiones de caja cerradas de esta sucursal.</CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/caja/historial">Ver historial completo</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No hay cierres registrados todavía.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Apertura</TableHead>
                        <TableHead>Cierre</TableHead>
                        <TableHead className="text-right">Inicial</TableHead>
                        <TableHead className="text-right">Esperado</TableHead>
                        <TableHead className="text-right">Declarado</TableHead>
                        <TableHead className="text-right">Diferencia</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((s) => {
                        const diff = diffDisplay(s.difference);
                        return (
                          <TableRow key={s.id}>
                            <TableCell className="whitespace-nowrap">{fmtDateTime(s.openedAt)}</TableCell>
                            <TableCell className="whitespace-nowrap">{s.closedAt ? fmtDateTime(s.closedAt) : '—'}</TableCell>
                            <TableCell className="text-right">{formatCurrency(s.openingAmount)}</TableCell>
                            <TableCell className="text-right">{s.closingAmountExpected != null ? formatCurrency(s.closingAmountExpected) : '—'}</TableCell>
                            <TableCell className="text-right">{s.closingAmountDeclared != null ? formatCurrency(s.closingAmountDeclared) : '—'}</TableCell>
                            <TableCell className={`text-right whitespace-nowrap ${diff.className}`}>{diff.label}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
