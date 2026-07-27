'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldAlert, LogOut, MessageCircle, Mail } from 'lucide-react';
import { usePlatformSettings } from '@/context/platform-settings-provider';
import { waLink, supportMailto } from '@/lib/support-contact';

interface SuspendedScreenProps {
  userName: string;
  onSignOut: () => void;
}

export function SuspendedScreen({ userName, onSignOut }: SuspendedScreenProps) {
  const { support } = usePlatformSettings();
  const wa = waLink(support, 'Hola, mi cuenta de SellAlleS está suspendida y quiero activarla');
  const mail = supportMailto(support, 'Activación de cuenta SellAlleS');

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive animate-pulse">
              <ShieldAlert className="h-8 w-8" />
            </div>
          </div>
          <CardTitle className="text-xl">Cuenta Suspendida / Pendiente</CardTitle>
          <CardDescription>Hola, {userName}</CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground space-y-4">
          <p>
            Tu cuenta de empresa está **pendiente de activación** o ha sido **suspendida temporalmente**.
          </p>
          <p className="bg-muted p-3 rounded-lg border text-xs text-left">
            💡 <strong>¿Qué hacer?</strong>
            <br />
            Si te has registrado recientemente en un **Plan de Pago**, el administrador de la plataforma está verificando el pago offline. Una vez confirmado, activará tu cuenta de inmediato.
          </p>
          <p>
            Para consultas de soporte o activar tu plan de inmediato, comunícate con nosotros:
          </p>
          {(wa || mail) ? (
            <div className="flex flex-col gap-2">
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp{support.whatsappLabel ? ` ${support.whatsappLabel}` : ''}
                </a>
              )}
              {mail && (
                <a
                  href={mail}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Mail className="h-4 w-4" />
                  {support.email}
                </a>
              )}
              {support.hours && <p className="text-xs">{support.hours}</p>}
            </div>
          ) : (
            <p className="text-xs">Comunícate con el administrador de la plataforma.</p>
          )}
        </CardContent>
        <CardFooter>
          <Button variant="outline" className="w-full" onClick={onSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar Sesión
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
