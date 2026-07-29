'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { useLoans } from '@/context/loan-provider';
import { useBranches } from '@/context/branch-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogTrigger } from '@/components/ui/dialog';
import { RegisterLoanPaymentDialog } from '@/components/loans/register-loan-payment-dialog';
import { formatCurrency } from '@/lib/utils';
import { abrirWhatsApp, telefonoParaWhatsApp } from '@/lib/whatsapp';
import type { Loan } from '@/lib/types';
import { ArrowLeft, MessageSquare, DollarSign, FileText, Wallet, AlertTriangle, CalendarDays } from 'lucide-react';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hoy en 'yyyy-mm-dd' local, para comparar con due_date sin pasar por Date.
 *  Las cuotas son fechas sin hora: convertirlas a Date para compararlas es
 *  justo donde aparecen los errores de un día por la zona horaria. */
function hoyISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Cobro {
  loan: Loan;
  cuotasVencidas: number;
  venceHoy: boolean;
  /** Capital pendiente de las cuotas vencidas y de la que vence hoy. */
  montoCuotas: number;
  mora: number;
  total: number;
  diasAtraso: number;
  fechaMasVieja: string;
}

// Una fila por préstamo, no por cuota: al cobrador le importa cuánto tiene que
// recoger de cada cliente, no en cuántos pedazos viene. Un préstamo con tres
// cuotas atrasadas es una sola visita.
function construirCobro(loan: Loan, lateFeeRate: number, hoy: string): Cobro | null {
  const abiertas = (loan.installments ?? []).filter((i) => i.status !== 'paid');
  const vencidas = abiertas.filter((i) => i.dueDate < hoy);
  const hoyMismo = abiertas.filter((i) => i.dueDate === hoy);
  if (vencidas.length === 0 && hoyMismo.length === 0) return null;

  const exigibles = [...vencidas, ...hoyMismo];
  const montoCuotas = round2(exigibles.reduce((acc, i) => acc + (i.amount - i.paidAmount), 0));
  // Misma cuenta que calculateLoanStatus: la mora se cobra por cuota vencida y
  // se descuenta lo que ya se pagó de ella.
  const mora = round2(
    vencidas.reduce((acc, i) => acc + Math.max(round2((i.amount * lateFeeRate) / 100) - i.lateFeePaid, 0), 0),
  );

  const fechaMasVieja = exigibles.reduce((min, i) => (i.dueDate < min ? i.dueDate : min), exigibles[0].dueDate);
  const diasAtraso = vencidas.length
    ? Math.round((new Date(hoy + 'T00:00:00').getTime() - new Date(fechaMasVieja + 'T00:00:00').getTime()) / 86400000)
    : 0;

  return {
    loan,
    cuotasVencidas: vencidas.length,
    venceHoy: hoyMismo.length > 0,
    montoCuotas,
    mora,
    total: round2(montoCuotas + mora),
    diasAtraso,
    fechaMasVieja,
  };
}

function mensajeRecordatorio(c: Cobro, negocio: string): string {
  const nombre = c.loan.customer?.name ?? 'estimado cliente';
  const cuando = c.cuotasVencidas > 0
    ? `Tiene ${c.cuotasVencidas} ${c.cuotasVencidas === 1 ? 'cuota vencida' : 'cuotas vencidas'}` +
      ` (la más antigua del ${new Date(c.fechaMasVieja + 'T00:00:00').toLocaleDateString('es-DO')}).`
    : 'Hoy le vence la cuota de su préstamo.';
  const detalleMora = c.mora > 0 ? `\nMora acumulada: ${formatCurrency(c.mora)}` : '';
  return (
    `Hola ${nombre}, le saludamos de ${negocio}.\n\n` +
    `${cuando}\n` +
    `Cuota(s): ${formatCurrency(c.montoCuotas)}${detalleMora}\n` +
    `Total a pagar: ${formatCurrency(c.total)}\n\n` +
    `Puede pasar por nuestra oficina o comunicarse con nosotros para coordinar el pago. ¡Gracias!`
  );
}

export default function CobrosPage() {
  const { loans } = useLoans();
  const { branches } = useBranches();
  const { profile } = useCompanyProfile();
  const [branchId, setBranchId] = useState('all');

  const hoy = hoyISO();

  const cobros = useMemo(() => {
    return loans
      .filter((l) => l.status !== 'cancelled')
      .filter((l) => branchId === 'all' || l.branchId === branchId)
      .map((l) => construirCobro(l, profile.loanLateFeeRate, hoy))
      .filter((c): c is Cobro => c !== null)
      // Lo más atrasado primero: es lo que hay que atender antes.
      .sort((a, b) => a.fechaMasVieja.localeCompare(b.fechaMasVieja));
  }, [loans, branchId, profile.loanLateFeeRate, hoy]);

  const totales = useMemo(() => {
    const vencidos = cobros.filter((c) => c.cuotasVencidas > 0);
    const soloHoy = cobros.filter((c) => c.cuotasVencidas === 0);
    return {
      esperado: round2(cobros.reduce((acc, c) => acc + c.total, 0)),
      vencido: round2(vencidos.reduce((acc, c) => acc + c.total, 0)),
      hoy: round2(soloHoy.reduce((acc, c) => acc + c.total, 0)),
      clientesVencidos: vencidos.length,
      clientesHoy: soloHoy.length,
    };
  }, [cobros]);

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);

  return (
    <div>
      <PageHeader title="Cobros del día">
        <Button asChild variant="outline">
          <Link href="/prestamos">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Préstamos
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Esperado hoy</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totales.esperado)}</div>
            <p className="text-xs text-muted-foreground">
              {cobros.length} {cobros.length === 1 ? 'cliente por cobrar' : 'clientes por cobrar'}
            </p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Atrasado</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(totales.vencido)}</div>
            <p className="text-xs text-muted-foreground">{totales.clientesVencidos} con cuotas vencidas</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vence hoy</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totales.hoy)}</div>
            <p className="text-xs text-muted-foreground">{totales.clientesHoy} al día que vencen hoy</p>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border bg-card">
        <div className="flex items-center gap-3 p-4">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las sucursales</SelectItem>
              {activeBranches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Cuota(s)</TableHead>
              <TableHead className="text-right">Mora</TableHead>
              <TableHead className="text-right">Total a cobrar</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cobros.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No hay cuotas vencidas ni que venzan hoy. Todo al día.
                </TableCell>
              </TableRow>
            ) : cobros.map((c) => (
              <TableRow key={c.loan.id} className={c.cuotasVencidas > 0 ? 'bg-destructive/5' : undefined}>
                <TableCell>
                  <p className="font-medium">{c.loan.customer?.name ?? 'Cliente'}</p>
                  <p className="text-xs text-muted-foreground">{c.loan.customer?.phone ?? 'Sin teléfono'}</p>
                </TableCell>
                <TableCell>
                  {c.cuotasVencidas > 0 ? (
                    <div className="flex flex-col">
                      <Badge variant="destructive" className="w-fit">
                        {c.cuotasVencidas} {c.cuotasVencidas === 1 ? 'cuota vencida' : 'cuotas vencidas'}
                      </Badge>
                      <span className="text-xs text-destructive mt-1">
                        {c.diasAtraso} {c.diasAtraso === 1 ? 'día' : 'días'} de atraso
                      </span>
                    </div>
                  ) : (
                    <Badge variant="outline">Vence hoy</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{formatCurrency(c.montoCuotas)}</TableCell>
                <TableCell className="text-right text-destructive">
                  {c.mora > 0 ? formatCurrency(c.mora) : '—'}
                </TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(c.total)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-emerald-600 dark:text-emerald-400"
                      title="Recordarle por WhatsApp"
                      onClick={() => abrirWhatsApp(
                        mensajeRecordatorio(c, profile.name),
                        telefonoParaWhatsApp(c.loan.customer?.phone),
                      )}
                    >
                      <MessageSquare className="h-4 w-4" />
                    </Button>
                    <RegisterLoanPaymentDialog loan={c.loan}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" title="Registrar abono">
                          <DollarSign className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                    </RegisterLoanPaymentDialog>
                    <Button variant="ghost" size="sm" asChild title="Ver préstamo">
                      <Link href={`/prestamos/detalle?id=${c.loan.id}`}>
                        <FileText className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
