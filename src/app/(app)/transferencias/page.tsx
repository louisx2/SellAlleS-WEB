'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowRightLeft, ChevronDown, ChevronRight, FileText, Loader2, Search } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/auth-provider';
import { useBranches } from '@/context/branch-provider';
import { useToast } from '@/hooks/use-toast';
import { TransferDialogHost, useOpenTransfer } from '@/components/products/transfer-product-dialog';
import { TransferSlipDialog, formatTransferDate, formatTransferNumber } from '@/components/products/transfer-slip';
import { fetchTransferBatches, type TransferBatch } from '@/lib/transfers';
import { formatQuantity, roundQty } from '@/lib/units';

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export default function TransferenciasPage() {
  const [refresh, setRefresh] = useState(0);
  return (
    <TransferDialogHost onSent={() => setRefresh((n) => n + 1)}>
      <TransferenciasContent refresh={refresh} />
    </TransferDialogHost>
  );
}

function TransferenciasContent({ refresh }: { refresh: number }) {
  const { appUser } = useAuth();
  const { branches } = useBranches();
  const { toast } = useToast();
  const openTransfer = useOpenTransfer();
  const activeBranchId = appUser?.activeBranchId;

  // Por defecto, lo que salió de la sucursal activa o llegó a ella. "Todas"
  // trae lo que la RLS deje ver: al admin, la empresa entera; al resto, las
  // sucursales a las que tiene acceso.
  const [alcance, setAlcance] = useState<'sucursal' | 'todas'>('sucursal');
  const [busqueda, setBusqueda] = useState('');
  const [batches, setBatches] = useState<TransferBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [conduce, setConduce] = useState<TransferBatch | null>(null);

  const branchName = useCallback(
    (id: string) => branches.find((b) => b.id === id)?.name ?? 'Sucursal',
    [branches],
  );

  useEffect(() => {
    if (!activeBranchId) return;
    let cancelado = false;
    setLoading(true);
    fetchTransferBatches({ branchId: alcance === 'sucursal' ? activeBranchId : undefined })
      .then((data) => { if (!cancelado) setBatches(data); })
      .catch((e) => {
        if (!cancelado) {
          setBatches([]);
          toast({ title: 'No se pudo cargar el historial', description: e?.message ?? '', variant: 'destructive' });
        }
      })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [activeBranchId, alcance, refresh, toast]);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda);
    if (!q) return batches;
    return batches.filter((b) =>
      normalizar(formatTransferNumber(b.number)).includes(q) ||
      String(b.number) === q.replace(/^#?0*/, '') ||
      normalizar(branchName(b.fromBranchId)).includes(q) ||
      normalizar(branchName(b.toBranchId)).includes(q) ||
      normalizar(b.createdByName ?? '').includes(q) ||
      b.lines.some((l) => normalizar(l.productName).includes(q) || normalizar(l.productCode ?? '').includes(q)),
    );
  }, [batches, busqueda, branchName]);

  const toggle = (id: string) => setAbiertos((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Transferencias">
        {openTransfer && (
          <Button onClick={() => openTransfer()}>
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Transferir a otra sucursal</span>
            <span className="sm:hidden">Transferir</span>
          </Button>
        )}
      </PageHeader>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por artículo, código, número o sucursal"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Select value={alcance} onValueChange={(v) => setAlcance(v as 'sucursal' | 'todas')}>
          <SelectTrigger className="sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sucursal">{appUser?.branch ?? 'Esta sucursal'}: enviadas y recibidas</SelectItem>
            <SelectItem value="todas">Todas las sucursales</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {busqueda ? 'Ninguna transferencia coincide con la búsqueda.' : 'Todavía no hay transferencias.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibles.map((b) => {
            const abierto = abiertos.has(b.id);
            const sale = b.fromBranchId === activeBranchId;
            const entra = b.toBranchId === activeBranchId;
            const total = roundQty(b.lines.reduce((acc, l) => acc + l.quantity, 0));
            return (
              <Card key={b.id}>
                <CardContent className="p-0">
                  <div className="flex items-center gap-3 p-3">
                    <button
                      type="button"
                      onClick={() => toggle(b.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-expanded={abierto}
                    >
                      {abierto
                        ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold">{formatTransferNumber(b.number)}</span>
                          {sale && <Badge variant="secondary">Enviada</Badge>}
                          {entra && <Badge>Recibida</Badge>}
                          <span className="text-xs text-muted-foreground">{formatTransferDate(b.createdAt)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-sm">
                          <span className="truncate">{branchName(b.fromBranchId)}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{branchName(b.toBranchId)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {b.lines.length} {b.lines.length === 1 ? 'artículo' : 'artículos'} · {total} en total
                          {b.createdByName ? ` · por ${b.createdByName}` : ''}
                        </p>
                      </div>
                    </button>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => setConduce(b)}>
                      <FileText className="mr-1.5 h-4 w-4" />
                      Conduce
                    </Button>
                  </div>
                  {abierto && (
                    <div className="border-t px-3 py-2">
                      {b.notes && <p className="mb-2 text-sm text-muted-foreground whitespace-pre-wrap">Nota: {b.notes}</p>}
                      <ul className="divide-y">
                        {b.lines.map((l) => (
                          <li key={l.id} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                            <div className="min-w-0">
                              <p className="break-words">{l.productName}</p>
                              <p className="text-xs text-muted-foreground">
                                {l.productCode ?? 'Sin código'}
                                {l.targetCreated && ' · se creó en la sucursal que recibió'}
                                {l.targetReactivated && ' · estaba archivado allá y se reactivó'}
                                {l.sourceArchived && ' · quedó en 0 y se archivó en la que envió'}
                              </p>
                            </div>
                            <span className="shrink-0 whitespace-nowrap font-medium">{formatQuantity(l.quantity, l.unit)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {batches.length >= 200 && (
            <p className="py-2 text-center text-xs text-muted-foreground">Se muestran las 200 más recientes.</p>
          )}
        </div>
      )}

      <TransferSlipDialog batch={conduce} open={!!conduce} onOpenChange={(o) => { if (!o) setConduce(null); }} />
    </div>
  );
}
