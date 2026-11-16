'use client';

// Pantalla que ven los usuarios de una empresa suspendida. El mensaje depende
// del motivo (lib/suspension.ts); con falta de pago, el administrador ve
// también las cuentas para transferir. "Verificar de nuevo" vuelve a leer el
// estado: si ya la reactivaron, entra sin recargar.

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldAlert, LogOut, MessageCircle, Mail, RefreshCw, Building2, Loader2 } from 'lucide-react';
import { usePlatformSettings } from '@/context/platform-settings-provider';
import { waLink, supportMailto } from '@/lib/support-contact';
import { pantallaDeSuspension } from '@/lib/suspension';
import { cargarCuentasBancarias, TIPO_DE_CUENTA, type CuentaBancaria } from '@/lib/payment-reports';

interface SuspendedScreenProps {
  userName: string;
  companyName?: string | null;
  motivo?: string | null;
  suspendedAt?: string | null;
  isAdmin: boolean;
  onSignOut: () => void;
  onRetry: () => Promise<void> | void;
  /** Solo si el usuario tiene otras empresas: volver a elegir. */
  onGoToCompanies?: () => void;
}

const fecha = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

export function SuspendedScreen({
  userName, companyName, motivo, suspendedAt, isAdmin, onSignOut, onRetry, onGoToCompanies,
}: SuspendedScreenProps) {
  const { support } = usePlatformSettings();
  const p = pantallaDeSuspension(motivo, companyName, isAdmin);
  const wa = waLink(support, p.mensajeSoporte);
  const mail = supportMailto(support, `Cuenta suspendida${companyName ? ` — ${companyName}` : ''}`);
  const verCuentas = isAdmin && motivo === 'falta_de_pago';
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [verificando, setVerificando] = useState(false);
  const desde = fecha(suspendedAt);

  useEffect(() => {
    if (!verCuentas) return;
    cargarCuentasBancarias().then(setCuentas).catch(() => setCuentas([]));
  }, [verCuentas]);

  const verificar = async () => {
    setVerificando(true);
    try { await onRetry(); } finally { setVerificando(false); }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-4 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-8 w-8" />
            </div>
          </div>
          <CardTitle className="text-xl">{p.titulo}</CardTitle>
          <CardDescription>Hola, {userName}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2 text-center text-muted-foreground">
            <p>{p.mensaje}</p>
            {desde && <p className="text-xs">Suspendida desde el {desde}.</p>}
          </div>

          <div className="rounded-lg border bg-muted/50 p-3 text-left text-xs leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Sus datos se conservan íntegramente.</span>{' '}
              Mientras la cuenta esté suspendida no se pueden registrar ventas ni hacer cambios, y se pausan los
              recordatorios de cuotas a sus clientes. Los comprobantes electrónicos ya emitidos se siguen enviando a la DGII.
            </p>
          </div>

          <p className="text-center font-medium">{p.accion}</p>

          {verCuentas && cuentas.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Cuentas para transferir</p>
              <ul className="divide-y rounded-lg border">
                {cuentas.map((c) => (
                  <li key={c.id} className="flex flex-col gap-0.5 p-3 text-xs">
                    <span className="font-medium text-foreground">
                      {c.bank} · {TIPO_DE_CUENTA[c.accountType]}{c.currency !== 'DOP' ? ` · ${c.currency}` : ''}
                    </span>
                    <span className="font-mono text-sm text-foreground">{c.accountNumber}</span>
                    <span className="text-muted-foreground">{c.holderName}{c.holderId ? ` · ${c.holderId}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(wa || mail) ? (
            <div className="flex flex-col gap-2">
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  <MessageCircle className="h-4 w-4" />
                  {verCuentas ? 'Enviar comprobante por WhatsApp' : 'Escribir por WhatsApp'}
                </a>
              )}
              {mail && (
                <a
                  href={mail}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
                >
                  <Mail className="h-4 w-4" />
                  {support.email}
                </a>
              )}
              {support.hours && <p className="text-center text-xs text-muted-foreground">{support.hours}</p>}
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">Comuníquese con el soporte de SellAlleS.</p>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2">
          <Button className="w-full" variant="secondary" onClick={verificar} disabled={verificando}>
            {verificando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Verificar de nuevo
          </Button>
          {onGoToCompanies && (
            <Button className="w-full" variant="outline" onClick={onGoToCompanies}>
              <Building2 className="mr-2 h-4 w-4" />
              Ir a mis otras empresas
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={onSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
