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
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageCircle, Mail, Shield, CalendarClock, FileText } from 'lucide-react';
import { formatCedulaOrRnc } from '@/lib/format';
import {
  waLink, supportMailto, parseDiasLista, formatDiasLista,
  DEFAULT_TRIAL_SETTINGS, type SupportContact, type TrialSettings,
} from '@/lib/support-contact';

// Formatos que también valida la base (constraints de platform_settings): si se
// relaja uno hay que relajar el otro, o el guardado falla con un error de
// Postgres en vez de un mensaje entendible.
const NUMBER_RE = /^[0-9]{8,15}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Emisor de las facturas de suscripción. La base copia estos datos en cada
 *  factura al emitirla, así que editarlos no cambia las ya emitidas. */
interface DatosFacturacion {
  legalName: string;
  /** Solo dígitos: 9 (RNC) u 11 (cédula). */
  rnc: string;
  address: string;
  phone: string;
  email: string;
  notes: string;
  itbisIncluded: boolean;
}

const FACTURACION_VACIA: DatosFacturacion = {
  legalName: '', rnc: '', address: '', phone: '', email: '', notes: '', itbisIncluded: false,
};

export default function PlatformSettingsPage() {
  const { appUser } = useAuth();
  const { support, reload } = usePlatformSettings();
  const { toast } = useToast();

  const [form, setForm] = useState<SupportContact>(support);
  const [saving, setSaving] = useState(false);

  // La config de prueba no la necesita el resto de la app, así que se lee y
  // guarda aquí en vez de cargarla en el provider global.
  const [trial, setTrial] = useState<TrialSettings>(DEFAULT_TRIAL_SETTINGS);
  const [avisosPruebaTexto, setAvisosPruebaTexto] = useState(formatDiasLista(DEFAULT_TRIAL_SETTINGS.trialReminderDays));
  const [avisosCobroTexto, setAvisosCobroTexto] = useState(formatDiasLista(DEFAULT_TRIAL_SETTINGS.paymentReminderDays));
  // Lo mismo con los datos de facturación: solo los usa esta pantalla y la base.
  const [facturacion, setFacturacion] = useState<DatosFacturacion>(FACTURACION_VACIA);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('trial_days, trial_reminder_days, payment_reminder_days, invoice_legal_name, invoice_rnc, invoice_address, invoice_phone, invoice_email, invoice_notes, invoice_itbis_included')
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setFacturacion({
          legalName: data.invoice_legal_name ?? '',
          rnc: data.invoice_rnc ?? '',
          address: data.invoice_address ?? '',
          phone: data.invoice_phone ?? '',
          email: data.invoice_email ?? '',
          notes: data.invoice_notes ?? '',
          itbisIncluded: data.invoice_itbis_included ?? false,
        });
        const t: TrialSettings = {
          trialDays: data.trial_days ?? DEFAULT_TRIAL_SETTINGS.trialDays,
          trialReminderDays: data.trial_reminder_days ?? DEFAULT_TRIAL_SETTINGS.trialReminderDays,
          paymentReminderDays: data.payment_reminder_days ?? DEFAULT_TRIAL_SETTINGS.paymentReminderDays,
        };
        setTrial(t);
        setAvisosPruebaTexto(formatDiasLista(t.trialReminderDays));
        setAvisosCobroTexto(formatDiasLista(t.paymentReminderDays));
      });
  }, []);

  // El provider carga de forma asíncrona: cuando llegan los valores reales se
  // vuelcan al formulario (salvo que el usuario ya esté escribiendo).
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setForm(support); }, [support, dirty]);

  const set = <K extends keyof SupportContact>(key: K, value: SupportContact[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const setFactura = <K extends keyof DatosFacturacion>(key: K, value: DatosFacturacion[K]) => {
    setDirty(true);
    setFacturacion((f) => ({ ...f, [key]: value }));
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

    // Listas vacías apagarían los avisos en silencio; la base también lo
    // rechaza, pero es mejor decirlo aquí con un mensaje entendible.
    const avisosPrueba = parseDiasLista(avisosPruebaTexto);
    const avisosCobro = parseDiasLista(avisosCobroTexto);
    if (avisosPrueba.length === 0 || avisosCobro.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Faltan los días de aviso',
        description: 'Escribe al menos un número en cada lista, separados por comas. Ej: 7, 3, 1.',
      });
      return;
    }
    if (!Number.isInteger(trial.trialDays) || trial.trialDays < 1 || trial.trialDays > 365) {
      toast({ variant: 'destructive', title: 'Días de prueba inválidos', description: 'Debe ser entre 1 y 365.' });
      return;
    }

    const facturaEmail = facturacion.email.trim();
    if (facturacion.rnc && facturacion.rnc.length !== 9 && facturacion.rnc.length !== 11) {
      toast({
        variant: 'destructive',
        title: 'RNC o cédula incompleto',
        description: 'El RNC lleva 9 dígitos y la cédula 11. Déjalo vacío si la factura no debe mostrarlo.',
      });
      return;
    }
    if (facturaEmail && !EMAIL_RE.test(facturaEmail)) {
      toast({ variant: 'destructive', title: 'Correo de facturación inválido', description: 'Revisa la dirección.' });
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
        trial_days: trial.trialDays,
        trial_reminder_days: avisosPrueba,
        payment_reminder_days: avisosCobro,
        invoice_legal_name: facturacion.legalName.trim() || null,
        invoice_rnc: facturacion.rnc || null,
        invoice_address: facturacion.address.trim() || null,
        invoice_phone: facturacion.phone.trim() || null,
        invoice_email: facturaEmail || null,
        invoice_notes: facturacion.notes.trim() || null,
        invoice_itbis_included: facturacion.itbisIncluded,
      })
      .eq('id', true);
    setSaving(false);

    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo guardar', description: error.message });
      return;
    }
    setDirty(false);
    await reload();
    toast({ title: 'Configuración guardada', description: 'Los cambios se aplicaron en toda la plataforma.' });
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
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarClock className="h-5 w-5 text-amber-600" />
              Prueba gratis y avisos
            </CardTitle>
            <CardDescription>
              Cuánto dura la prueba de una empresa nueva y con cuánta anticipación se avisa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="trial-days">Días de prueba</Label>
              <Input
                id="trial-days"
                type="number"
                min={1}
                max={365}
                className="max-w-[140px]"
                value={trial.trialDays}
                onChange={(e) => { setDirty(true); setTrial({ ...trial, trialDays: parseInt(e.target.value) || 0 }); }}
              />
              <p className="text-xs text-muted-foreground">
                Se aplica a las empresas nuevas, tanto las que se registran por la landing como las
                que creas desde el panel. No cambia las que ya existen.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="avisos-prueba">Avisar la prueba, días antes</Label>
                <Input
                  id="avisos-prueba"
                  placeholder="7, 3, 1"
                  value={avisosPruebaTexto}
                  onChange={(e) => { setDirty(true); setAvisosPruebaTexto(e.target.value); }}
                />
                <p className="text-xs text-muted-foreground">
                  Con pruebas largas, avisar solo al final llega tarde: el aviso de la mitad alcanza
                  al usuario cuando ya cargó sus datos.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="avisos-cobro">Avisar el cobro, días antes</Label>
                <Input
                  id="avisos-cobro"
                  placeholder="3"
                  value={avisosCobroTexto}
                  onChange={(e) => { setDirty(true); setAvisosCobroTexto(e.target.value); }}
                />
                <p className="text-xs text-muted-foreground">
                  Cuenta desde la fecha de <strong>Pagado hasta</strong> de cada empresa.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Números separados por comas. Se guardan de mayor a menor y sin repetidos.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-primary" />
              Datos de facturación
            </CardTitle>
            <CardDescription>
              Lo que sale como emisor en la factura de cada pago de suscripción. Cada factura
              guarda una copia al emitirse: cambiar esto no altera las que ya se enviaron.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inv-name">Nombre o razón social</Label>
                <Input
                  id="inv-name"
                  placeholder="SellAlleS"
                  value={facturacion.legalName}
                  onChange={(e) => setFactura('legalName', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-rnc">RNC o cédula</Label>
                <Input
                  id="inv-rnc"
                  inputMode="numeric"
                  placeholder="Vacío: no se muestra"
                  value={formatCedulaOrRnc(facturacion.rnc)}
                  onChange={(e) => setFactura('rnc', e.target.value.replace(/\D/g, '').slice(0, 11))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inv-address">Dirección</Label>
              <Input
                id="inv-address"
                value={facturacion.address}
                onChange={(e) => setFactura('address', e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inv-phone">Teléfono</Label>
                <Input
                  id="inv-phone"
                  placeholder="Vacío: el WhatsApp de soporte"
                  value={facturacion.phone}
                  onChange={(e) => setFactura('phone', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-email">Correo</Label>
                <Input
                  id="inv-email"
                  type="email"
                  placeholder="Vacío: el correo de soporte"
                  value={facturacion.email}
                  onChange={(e) => setFactura('email', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inv-notes">Notas al pie</Label>
              <Textarea
                id="inv-notes"
                rows={3}
                placeholder="Ej: Gracias por su pago. Transferencias a Banco Popular, cuenta 000-000000-0."
                value={facturacion.notes}
                onChange={(e) => setFactura('notes', e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="inv-itbis">El monto cobrado incluye ITBIS (18%)</Label>
                <p className="text-xs text-muted-foreground">
                  Actívalo solo si SellAlleS está formalizado y cobra ITBIS: la factura desglosa
                  subtotal e ITBIS sin cambiar el total.
                </p>
              </div>
              <Switch
                id="inv-itbis"
                checked={facturacion.itbisIncluded}
                onCheckedChange={(v) => setFactura('itbisIncluded', v)}
              />
            </div>
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
