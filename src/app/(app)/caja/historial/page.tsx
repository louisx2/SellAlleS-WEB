'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/context/auth-provider';
import { useBranches } from '@/context/branch-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToCajaSession } from '@/lib/supabase/mappers';
import type { CajaSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CajaDetailDialog } from '@/components/caja/caja-detail-dialog';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

function fmtDateTime(d?: Date) {
  return d ? d.toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

function diffDisplay(d?: number) {
  if (d == null) return { label: '—', className: 'text-muted-foreground' };
  if (Math.abs(d) < 0.01) return { label: 'Cuadra', className: 'text-emerald-600 dark:text-emerald-400' };
  if (d < 0) return { label: `-${formatCurrency(Math.abs(d))}`, className: 'text-destructive' };
  return { label: `+${formatCurrency(d)}`, className: 'text-amber-600 dark:text-amber-400' };
}

export default function CajaHistorialPage() {
  const { appUser } = useAuth();
  const { branches } = useBranches();
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const [sessions, setSessions] = useState<CajaSession[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeCompanyId) { setSessions([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from('caja_sessions')
      .select('*, branches(name), caja_movements(*)')
      .eq('company_id', activeCompanyId)
      .order('opened_at', { ascending: false })
      .limit(200);
    if (branchFilter !== 'all') query = query.eq('branch_id', branchFilter);
    const { data, error } = await query;
    if (!error && data) setSessions(data.map(rowToCajaSession));
    setLoading(false);
  }, [activeCompanyId, branchFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Historial de cajas">
        <Button asChild variant="outline">
          <Link href="/caja">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Caja
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base">Cajas</CardTitle>
            <CardDescription>Aperturas y cierres registrados.</CardDescription>
          </div>
          <div className="w-full sm:w-56">
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger><SelectValue placeholder="Sucursal" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Cargando…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No hay cajas registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Apertura</TableHead>
                    <TableHead>Cierre</TableHead>
                    <TableHead className="text-right">Inicial</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Declarado</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => {
                    const diff = diffDisplay(s.difference);
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="whitespace-nowrap">{s.branchName ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDateTime(s.openedAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">{s.closedAt ? fmtDateTime(s.closedAt) : '—'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(s.openingAmount)}</TableCell>
                        <TableCell className="text-right">{s.closingAmountExpected != null ? formatCurrency(s.closingAmountExpected) : '—'}</TableCell>
                        <TableCell className="text-right">{s.closingAmountDeclared != null ? formatCurrency(s.closingAmountDeclared) : '—'}</TableCell>
                        <TableCell className={`text-right whitespace-nowrap ${diff.className}`}>{diff.label}</TableCell>
                        <TableCell>
                          {s.status === 'open'
                            ? <Badge className="bg-emerald-600">Abierta</Badge>
                            : <Badge variant="outline">Cerrada</Badge>}
                        </TableCell>
                        <TableCell>
                          <CajaDetailDialog session={s}>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm">Ver</Button>
                            </DialogTrigger>
                          </CajaDetailDialog>
                        </TableCell>
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
  );
}
