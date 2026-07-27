'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, RefreshCw, AlertTriangle } from 'lucide-react';

// Debe coincidir con TOPE_DIARIO de la Edge Function send-lifecycle-email: es
// el corte que ella aplica, y el plan Free de Resend permite 100 al día.
const TOPE_DIARIO = 80;
const TOPE_RESEND = 100;

type Estado = 'sent' | 'failed' | 'bounced' | 'complained';

interface Envio {
  id: string;
  company_id: string | null;
  template: string;
  to_email: string;
  dedupe_key: string;
  resend_email_id: string | null;
  status: Estado;
  error: string | null;
  created_at: string;
}

const ESTADO_LABEL: Record<Estado, string> = {
  sent: 'Enviado',
  failed: 'Falló',
  bounced: 'Rebotó',
  complained: 'Marcado como spam',
};

const ESTADO_VARIANT: Record<Estado, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sent: 'default',
  failed: 'destructive',
  bounced: 'destructive',
  complained: 'destructive',
};

const PLANTILLA_LABEL: Record<string, string> = {
  'bienvenida': 'Bienvenida',
  'prueba-por-vencer': 'Prueba por vencer',
  'prueba-vencida': 'Prueba vencida',
  'cuenta-activada': 'Cuenta activada',
  'recibo-suscripcion': 'Recibo de pago',
  'cobro-por-vencer': 'Cobro por vencer',
};

function fmtFechaHora(s: string) {
  return new Date(s).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function PlatformEmailsPage() {
  const { appUser } = useAuth();
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [empresas, setEmpresas] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Estado | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: filas }, { data: comps }] = await Promise.all([
      supabase.from('platform_email_log').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('companies').select('id, name'),
    ]);
    if (filas) setEnvios(filas as Envio[]);
    if (comps) setEmpresas(Object.fromEntries((comps as { id: string; name: string }[]).map((c) => [c.id, c.name])));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Se cuenta contra medianoche UTC, igual que el corte de la Edge Function:
  // si aquí se contara por día local, el número mostrado no coincidiría con el
  // que de verdad decide si un correo sale o no.
  const enviadosHoy = useMemo(() => {
    const desde = new Date();
    desde.setUTCHours(0, 0, 0, 0);
    return envios.filter((e) => e.status === 'sent' && new Date(e.created_at) >= desde).length;
  }, [envios]);

  const conProblema = useMemo(
    () => envios.filter((e) => e.status !== 'sent').length,
    [envios],
  );

  const visibles = useMemo(
    () => (filtro === 'all' ? envios : envios.filter((e) => e.status === filtro)),
    [envios, filtro],
  );

  if (!appUser?.isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Shield className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Solo para administradores de la plataforma</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Aquí se registran los correos que SellAlleS envía a sus clientes.
        </p>
      </div>
    );
  }

  const cercaDelTope = enviadosHoy >= TOPE_DIARIO * 0.75;

  return (
    <>
      <PageHeader title="Correos enviados">
        <div className="flex items-center gap-2">
          <Select value={filtro} onValueChange={(v) => setFiltro(v as Estado | 'all')}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="sent">Enviados</SelectItem>
              <SelectItem value="failed">Fallidos</SelectItem>
              <SelectItem value="bounced">Rebotados</SelectItem>
              <SelectItem value="complained">Marcados como spam</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={load} title="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Enviados hoy</CardDescription>
            <CardTitle className={cercaDelTope ? 'text-3xl text-destructive' : 'text-3xl'}>
              {enviadosHoy} <span className="text-base font-normal text-muted-foreground">/ {TOPE_DIARIO}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              La plataforma corta en {TOPE_DIARIO} para dejar margen a los correos de confirmación de
              cuenta y a los recibos de venta, que no pasan por aquí. El plan de Resend permite {TOPE_RESEND} al día.
            </p>
            {cercaDelTope && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Cerca del corte: los avisos de hoy podrían no salir.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Con problema</CardDescription>
            <CardTitle className="text-3xl">{conProblema}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Fallidos, rebotados o marcados como spam. Un rebote duro deja de recibir avisos
              automáticamente, para no dañar la reputación del dominio.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-sm text-muted-foreground py-10 text-center">Cargando…</p>
          ) : visibles.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              {envios.length === 0
                ? 'La plataforma todavía no ha enviado correos de este tipo.'
                : 'Nada con ese filtro.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Para</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtFechaHora(e.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {PLANTILLA_LABEL[e.template] ?? e.template}
                    </TableCell>
                    <TableCell className="text-sm">{e.to_email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {e.company_id ? (empresas[e.company_id] ?? '—') : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ESTADO_VARIANT[e.status]}>{ESTADO_LABEL[e.status]}</Badge>
                      {e.error && (
                        <p className="text-[11px] text-muted-foreground mt-1 max-w-xs truncate" title={e.error}>
                          {e.error}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
