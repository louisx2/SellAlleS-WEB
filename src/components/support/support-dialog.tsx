'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/auth-provider';
import { usePlatformSettings } from '@/context/platform-settings-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { waLink } from '@/lib/support-contact';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { MessageCircle, Mail, CheckCircle2 } from 'lucide-react';

interface SupportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SupportDialog({ open, onOpenChange }: SupportDialogProps) {
  const { appUser } = useAuth();
  const { support } = usePlatformSettings();
  const { profile } = useCompanyProfile();
  const { toast } = useToast();
  const pathname = usePathname();

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentCode, setSentCode] = useState<string | null>(null);

  const wa = waLink(support, 'Hola, necesito soporte con SellAlleS');

  const reset = () => {
    setSubject('');
    setMessage('');
    setSentCode(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSend = async () => {
    if (!subject.trim() || !message.trim()) {
      toast({ variant: 'destructive', title: 'Falta información', description: 'Escribe un asunto y tu mensaje.' });
      return;
    }

    setSending(true);
    // Contexto para que soporte no tenga que preguntar lo obvio.
    const context = [
      profile?.name ? `Empresa: ${profile.name}` : null,
      appUser?.branch ? `Sucursal: ${appUser.branch}` : null,
      `Pantalla: ${pathname}`,
    ].filter(Boolean).join('\n');

    const { data, error } = await supabase.functions.invoke('support-ticket', {
      body: { action: 'create', subject: subject.trim(), message: message.trim(), context },
    });
    setSending(false);

    const errMsg = (data as { error?: string })?.error ?? error?.message;
    if (errMsg) {
      toast({ variant: 'destructive', title: 'No se pudo enviar', description: errMsg });
      return;
    }

    const result = data as { code?: string; emailWarning?: string | null };
    setSentCode(result?.code ?? null);
    // El ticket se guarda aunque el acuse por correo falle: se avisa sin
    // hacerle creer al usuario que se perdió la solicitud.
    if (result?.emailWarning) {
      toast({
        title: 'Solicitud registrada',
        description: 'No pudimos enviarte el correo de confirmación, pero tu solicitud sí quedó registrada.',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {sentCode ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                Solicitud enviada
              </DialogTitle>
              <DialogDescription>
                Tu referencia es <strong>{sentCode}</strong>. Te responderemos al correo de tu usuario.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Entendido</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Soporte Técnico</DialogTitle>
              <DialogDescription>
                {support.hours ?? 'Cuéntanos qué necesitas y te respondemos por correo.'}
              </DialogDescription>
            </DialogHeader>

            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                <MessageCircle className="h-4 w-4" />
                Escribir por WhatsApp{support.whatsappLabel ? ` (${support.whatsappLabel})` : ''}
              </a>
            )}

            {support.emailEnabled && (
              <div className="space-y-4">
                {wa && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    o abre una solicitud
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="support-subject">Asunto</Label>
                  <Input
                    id="support-subject"
                    placeholder="Ej. No puedo imprimir el ticket"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-message">¿Qué está pasando?</Label>
                  <Textarea
                    id="support-message"
                    placeholder="Mientras más detalles, más rápido lo resolvemos."
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  Te responderemos al correo de tu usuario.
                </p>
              </div>
            )}

            {support.emailEnabled && (
              <DialogFooter>
                <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
                  Cancelar
                </Button>
                <Button onClick={handleSend} disabled={sending}>
                  {sending ? 'Enviando...' : 'Enviar solicitud'}
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
