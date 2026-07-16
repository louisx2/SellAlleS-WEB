'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Notificaciones de caja: correo a admins/gerentes (+ direcciones adicionales
// configuradas) al abrir/cerrar caja. Guardado propio directo en companies
// (mismo patrón que LoyaltySettingsCard).
export function CajaEmailSettingsCard() {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [recipientsText, setRecipientsText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id, caja_email_enabled, caja_email_recipients')
      .limit(1)
      .maybeSingle();
    if (data) {
      setCompanyId(data.id);
      setEnabled(!!data.caja_email_enabled);
      setRecipientsText(((data.caja_email_recipients as string[] | null) ?? []).join(', '));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!companyId) return;

    const emails = recipientsText
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
    const invalid = emails.find((e) => !EMAIL_RE.test(e));
    if (invalid) {
      toast({ title: 'Correo inválido', description: `"${invalid}" no parece un correo válido.`, variant: 'destructive' });
      return;
    }
    const recipients = Array.from(new Set(emails.map((e) => e.toLowerCase())));

    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({ caja_email_enabled: enabled, caja_email_recipients: recipients })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Notificaciones de caja actualizadas',
      description: enabled
        ? 'Se enviará un correo a administradores, gerentes y las direcciones adicionales al abrir o cerrar caja.'
        : 'Las notificaciones de caja están desactivadas.',
    });
  };

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notificaciones de Caja</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notificaciones de Caja</CardTitle>
        <CardDescription>
          Envía un correo con el resumen a los administradores y gerentes cada vez que
          se abre o se cierra una caja (apertura: monto inicial; cierre: esperado,
          declarado y diferencia).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="caja-email-enabled">Enviar correo al abrir/cerrar caja</Label>
          </div>
          <Switch id="caja-email-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="caja-email-recipients">Correos adicionales (opcional)</Label>
          <Textarea
            id="caja-email-recipients"
            placeholder="contabilidad@tuempresa.com, dueno@tuempresa.com"
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            rows={2}
          />
          <p className="text-xs text-muted-foreground">
            Separa varias direcciones con comas. Se suman a los administradores y gerentes,
            que siempre reciben el correo automáticamente.
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
