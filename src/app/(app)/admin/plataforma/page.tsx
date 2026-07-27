'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/context/auth-provider';
import { usePlatformSettings } from '@/context/platform-settings-provider';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageCircle, Mail, Shield } from 'lucide-react';
import { waLink, supportMailto, type SupportContact } from '@/lib/support-contact';

// Formatos que también valida la base (constraints de platform_settings): si se
// relaja uno hay que relajar el otro, o el guardado falla con un error de
// Postgres en vez de un mensaje entendible.
const NUMBER_RE = /^[0-9]{8,15}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function PlatformSettingsPage() {
  const { appUser } = useAuth();
  const { support, reload } = usePlatformSettings();
  const { toast } = useToast();

  const [form, setForm] = useState<SupportContact>(support);
  const [saving, setSaving] = useState(false);

  // El provider carga de forma asíncrona: cuando llegan los valores reales se
  // vuelcan al formulario (salvo que el usuario ya esté escribiendo).
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setForm(support); }, [support, dirty]);

  const set = <K extends keyof SupportContact>(key: K, value: SupportContact[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  if (!appUser?.isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Shield className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Solo para administradores de la plataforma</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Esta sección configura los canales de contacto de SellAlleS, no los de tu empresa.
        </p>
      </div>
    );
  }

  const handleSave = async () => {
    const number = (form.whatsappNumber ?? '').trim();
    const email = (form.email ?? '').trim();

    if (form.whatsappEnabled && !NUMBER_RE.test(number)) {
      toast({
        variant: 'destructive',
        title: 'Número de WhatsApp inválido',
        description: 'Debe ser solo dígitos, con código de país y sin "+", espacios ni guiones. Ejemplo: 18299333226.',
      });
      return;
    }
    if (form.emailEnabled && !EMAIL_RE.test(email)) {
      toast({ variant: 'destructive', title: 'Correo de soporte inválido', description: 'Revisa la dirección.' });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('platform_settings')
      .update({
        support_whatsapp_enabled: form.whatsappEnabled,
        support_whatsapp_number: number || null,
        support_whatsapp_label: (form.whatsappLabel ?? '').trim() || null,
        support_email_enabled: form.emailEnabled,
        support_email: email || null,
        support_hours: (form.hours ?? '').trim() || null,
      })
      .eq('id', true);
    setSaving(false);

    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo guardar', description: error.message });
      return;
    }
    setDirty(false);
    await reload();
    toast({ title: 'Configuración guardada', description: 'Los canales de contacto se actualizaron en toda la plataforma.' });
  };

  // Vista previa de los enlaces que verán los clientes, con los valores del
  // formulario: deja ver el resultado antes de guardar.
  const previewWa = waLink(form, 'Hola, quiero activar mi cuenta de SellAlleS');
  const previewMail = supportMailto(form);

  return (
    <>
      <PageHeader title="Configuración de la Plataforma" />

      <div className="grid gap-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageCircle className="h-5 w-5 text-green-600" />
              WhatsApp de soporte
            </CardTitle>
            <CardDescription>
              El canal que ven los clientes en el botón de soporte, en el aviso de prueba vencida,
              en la pantalla de cuenta suspendida y en la página de suscripción.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="wa-enabled">Canal activo</Label>
                <p className="text-xs text-muted-foreground">
                  Al apagarlo, los botones de WhatsApp desaparecen de toda la aplicación.
                </p>
              </div>
              <Switch
                id="wa-enabled"
                checked={form.whatsappEnabled}
                onCheckedChange={(v) => set('whatsappEnabled', v)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="wa-number">Número (con código de país, solo dígitos)</Label>
                <Input
                  id="wa-number"
                  inputMode="numeric"
                  placeholder="18299333226"
                  value={form.whatsappNumber ?? ''}
                  onChange={(e) => set('whatsappNumber', e.target.value.replace(/[^0-9]/g, ''))}
                  disabled={!form.whatsappEnabled}
                />
                <p className="text-xs text-muted-foreground">Es el que usa el enlace wa.me.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-label">Cómo se muestra</Label>
                <Input
                  id="wa-label"
                  placeholder="829-933-3226"
                  value={form.whatsappLabel ?? ''}
                  onChange={(e) => set('whatsappLabel', e.target.value)}
                  disabled={!form.whatsappEnabled}
                />
                <p className="text-xs text-muted-foreground">Solo texto; puede llevar guiones.</p>
              </div>
            </div>

            {previewWa && (
              <p className="text-xs text-muted-foreground break-all">
                Enlace resultante: <span className="font-mono">{previewWa}</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mail className="h-5 w-5 text-primary" />
              Correo de soporte
            </CardTitle>
            <CardDescription>
              Dirección a la que escriben los clientes y desde la que se responden los tickets.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="mail-enabled">Canal activo</Label>
                <p className="text-xs text-muted-foreground">
                  Al apagarlo se oculta la opción de escribir por correo.
                </p>
              </div>
              <Switch
                id="mail-enabled"
                checked={form.emailEnabled}
                onCheckedChange={(v) => set('emailEnabled', v)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mail-address">Dirección</Label>
              <Input
                id="mail-address"
                type="email"
                placeholder="soporte@sellalles.com"
                value={form.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
                disabled={!form.emailEnabled}
              />
            </div>

            {previewMail && (
              <p className="text-xs text-muted-foreground break-all">
                Enlace resultante: <span className="font-mono">{previewMail}</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Horario de atención</CardTitle>
            <CardDescription>Texto libre que se muestra junto a los canales de contacto.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Lunes a viernes, 8:00 a.m. a 6:00 p.m."
              value={form.hours ?? ''}
              onChange={(e) => set('hours', e.target.value)}
            />
          </CardContent>
        </Card>

        {!form.whatsappEnabled && !form.emailEnabled && (
          <p className="text-sm text-destructive">
            Con los dos canales apagados, los clientes no verán ninguna forma de contactar soporte.
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </>
  );
}
