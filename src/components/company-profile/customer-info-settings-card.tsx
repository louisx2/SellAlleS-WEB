'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { CAMPOS_CLIENTE, normalizarCamposCliente, type CampoCliente } from '@/lib/datos-cliente';
import { Loader2, UserRound } from 'lucide-react';

// Qué datos del cliente puede llevar la factura. Encendido, el pago muestra una
// casilla (desmarcada) para incluirlos en esa venta: lo pidió un negocio que
// entrega con chofer y él necesita la dirección y el teléfono.
//
// Guardado propio, como LoyaltySettingsCard, pero por el id de la empresa: con
// `.limit(1)` un super admin que entra a una empresa podría leer otra.
export function CustomerInfoSettingsCard() {
  const { toast } = useToast();
  const { appUser } = useAuth();
  const { mergeProfile } = useCompanyProfile();
  const companyId = appUser?.impersonatedCompanyId || appUser?.companyId || null;

  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [campos, setCampos] = useState<CampoCliente[]>(['address', 'phone']);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from('companies')
      .select('receipt_customer_info_enabled, receipt_customer_fields')
      .eq('id', companyId)
      .maybeSingle();
    if (data) {
      setEnabled(!!data.receipt_customer_info_enabled);
      setCampos(normalizarCamposCliente(data.receipt_customer_fields));
    }
    setLoaded(true);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const toggleCampo = (campo: CampoCliente, marcado: boolean) => {
    setCampos((prev) =>
      normalizarCamposCliente(marcado ? [...prev, campo] : prev.filter((c) => c !== campo)),
    );
  };

  const handleSave = async () => {
    if (!companyId) return;
    if (enabled && campos.length === 0) {
      toast({
        title: 'Elige al menos un dato',
        description: 'Marca qué datos del cliente deben salir en la factura, o apaga la opción.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({ receipt_customer_info_enabled: enabled, receipt_customer_fields: campos })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    mergeProfile({ receiptCustomerInfoEnabled: enabled, receiptCustomerFields: campos });
    toast({
      title: 'Datos del cliente en la factura',
      description: enabled
        ? 'Al cobrar aparecerá la casilla para incluirlos en la factura.'
        : 'La factura seguirá saliendo solo con el nombre y el RNC del cliente.',
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="h-5 w-5" />
          Datos del cliente en la factura
        </CardTitle>
        <CardDescription>
          Útil cuando la mercancía sale con un chofer o mensajero: al cobrar aparece una casilla
          para que la factura lleve los datos del cliente que elijas aquí. Viene desmarcada, así que
          las ventas de mostrador siguen saliendo como siempre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loaded ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="customer-info-enabled" className="text-sm font-semibold">
                Mostrar datos del cliente
              </Label>
              <Switch id="customer-info-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
            {enabled && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Datos que salen en la factura</p>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {CAMPOS_CLIENTE.map(({ campo, etiqueta }) => (
                    <label key={campo} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={campos.includes(campo)}
                        onCheckedChange={(v) => toggleCampo(campo, v === true)}
                      />
                      {etiqueta}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  El RNC o la cédula ya salen siempre que el cliente los tenga. Un dato que el cliente
                  no tenga registrado simplemente no se imprime.
                </p>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
