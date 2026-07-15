'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabase/client';
import { rowToSubscriptionPayment } from '@/lib/supabase/mappers';
import type { SubscriptionPayment } from '@/lib/types';
import { useAuth } from '@/context/auth-provider';
import { formatCurrency } from '@/lib/utils';
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

const METHOD_LABEL: Record<string, string> = {
  transfer: 'Transferencia',
  cash: 'Efectivo',
  card: 'Tarjeta',
  other: 'Otro',
};

function fmtDate(s?: string) {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function SuscripcionPage() {
  const { appUser } = useAuth();
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeCompanyId) { setPayments([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('subscription_payments')
      .select('*')
      .eq('company_id', activeCompanyId)
      .order('paid_at', { ascending: false });
    if (!error && data) setPayments(data.map(rowToSubscriptionPayment));
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  // Estado de la cuenta a partir del contexto de auth.
  const status = appUser?.companyStatus;
  const trialEndsAt = appUser?.companyTrialEndsAt;
  const paidUntil = appUser?.companyPaidUntil;
  const isReadOnly = !!appUser?.isReadOnly;
  const trialDaysLeft = trialEndsAt
    ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  let estado: { label: string; desc: string; icon: React.ReactNode; badge: React.ReactNode };
  if (isReadOnly) {
    // Vencido: distingue prueba de suscripción pagada.
    estado = status === 'trial'
      ? {
          label: 'Prueba terminada',
          desc: 'Tu prueba gratis de 14 días terminó. Activa tu cuenta por transferencia para seguir registrando y modificando datos.',
          icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
          badge: <Badge variant="destructive">Solo lectura</Badge>,
        }
      : {
          label: 'Suscripción vencida',
          desc: 'Tu suscripción venció. Renueva tu pago por transferencia para seguir registrando y modificando datos.',
          icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
          badge: <Badge variant="destructive">Solo lectura</Badge>,
        };
  } else if (status === 'active') {
    estado = {
      label: 'Cuenta activa',
      desc: paidUntil
        ? `Tu suscripción está al día, pagada hasta el ${fmtDate(paidUntil)}.`
        : 'Tu suscripción está al día. ¡Gracias!',
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
      badge: <Badge className="bg-emerald-600">Activa</Badge>,
    };
  } else if (status === 'trial') {
    estado = {
      label: 'Prueba gratis',
      desc: trialDaysLeft != null && trialDaysLeft >= 0
        ? `Te ${trialDaysLeft === 1 ? 'queda' : 'quedan'} ${trialDaysLeft} ${trialDaysLeft === 1 ? 'día' : 'días'} de prueba.`
        : 'Estás en período de prueba.',
      icon: <Clock className="h-5 w-5 text-amber-600" />,
      badge: <Badge className="bg-amber-500 text-amber-950">Prueba</Badge>,
    };
  } else {
    estado = {
      label: 'Cuenta',
      desc: '',
      icon: <CheckCircle2 className="h-5 w-5 text-muted-foreground" />,
      badge: null,
    };
  }

  return (
    <div>
      <PageHeader title="Mi Suscripción" />

      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {estado.icon}
              {estado.label}
            </CardTitle>
            {estado.badge}
          </CardHeader>
          <CardContent className="space-y-3">
            {estado.desc && <p className="text-sm text-muted-foreground">{estado.desc}</p>}
            {(isReadOnly || status === 'trial') && (
              <a
                href="https://wa.me/18299333226?text=Hola,%20quiero%20activar%20mi%20cuenta%20de%20SellAlleS"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                Activar / pagar por WhatsApp
              </a>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historial de pagos</CardTitle>
            <CardDescription>Pagos de tu suscripción registrados por SellAlleS.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Cargando…</p>
            ) : payments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Aún no hay pagos registrados. Cuando pagues por transferencia y lo confirmemos, aparecerá aquí.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead>Plan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">{fmtDate(p.paidAt)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                        <TableCell>{METHOD_LABEL[p.method] ?? p.method}</TableCell>
                        <TableCell className="text-muted-foreground">{p.reference || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {p.periodStart || p.periodEnd ? `${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}` : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.planName || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
