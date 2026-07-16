'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer } from 'lucide-react';

export function PrintSettingsCard() {
  const { toast } = useToast();
  const [showBarcode, setShowBarcode] = useState(true);
  const [barcodeType, setBarcodeType] = useState<'code128' | 'qr'>('code128');
  const [ticketWidth, setTicketWidth] = useState<'80mm' | '58mm'>('80mm');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShowBarcode(localStorage.getItem('showBarcode') !== 'false');
      setBarcodeType((localStorage.getItem('barcodeType') as any) || 'code128');
      setTicketWidth((localStorage.getItem('ticketWidth') as any) || '80mm');
      setMounted(true);
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('showBarcode', String(showBarcode));
    localStorage.setItem('barcodeType', barcodeType);
    localStorage.setItem('ticketWidth', ticketWidth);
    
    toast({
      title: 'Ajustes de impresión guardados',
      description: 'Los cambios se aplicarán en el próximo ticket que generes.',
    });
  };

  if (!mounted) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="h-5 w-5" />
          Ajustes de Impresión (Ticket)
        </CardTitle>
        <CardDescription>
          Configura el formato visual de tus recibos de venta impresos. Estos ajustes se guardan de forma local en este navegador/dispositivo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between border-b pb-4">
          <div className="space-y-0.5">
            <Label htmlFor="show-barcode-switch" className="text-sm font-semibold">
              Mostrar código identificador al final
            </Label>
            <p className="text-xs text-muted-foreground">
              Agrega un elemento visual al final del recibo para identificar o buscar la venta rápidamente.
            </p>
          </div>
          <Switch
            id="show-barcode-switch"
            checked={showBarcode}
            onCheckedChange={setShowBarcode}
          />
        </div>

        {showBarcode && (
          <div className="grid sm:grid-cols-2 gap-4 border-b pb-4">
            <div className="space-y-1.5">
              <Label htmlFor="barcode-type-select" className="text-sm font-semibold">
                Tipo de código identificador
              </Label>
              <Select value={barcodeType} onValueChange={(val: any) => setBarcodeType(val)}>
                <SelectTrigger id="barcode-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="code128">Código de Barras (Clásico/Elegante)</SelectItem>
                  <SelectItem value="qr">Código QR (Cuadrado/Moderno)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-center bg-secondary/30 p-2 rounded border">
              {barcodeType === 'code128' ? (
                <div className="text-center space-y-1">
                  <img 
                    src="https://bwipjs-api.metafloor.com/?bcid=code128&text=SAMPLE12&scale=1.5&height=10" 
                    alt="Vista previa código de barras" 
                    className="h-8 w-auto mx-auto mix-blend-multiply"
                  />
                  <p className="text-[10px] text-muted-foreground font-mono">Code 128 (ID Corto)</p>
                </div>
              ) : (
                <div className="text-center space-y-1">
                  <img 
                    src="https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=SAMPLE12" 
                    alt="Vista previa QR" 
                    className="h-10 w-10 mx-auto"
                  />
                  <p className="text-[10px] text-muted-foreground font-mono">Código QR (ID Completo)</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="ticket-width-select" className="text-sm font-semibold">
            Ancho del papel térmico
          </Label>
          <Select value={ticketWidth} onValueChange={(val: any) => setTicketWidth(val)}>
            <SelectTrigger id="ticket-width-select" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="80mm">80 milímetros (Estándar)</SelectItem>
              <SelectItem value="58mm">58 milímetros (Mini)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Ajusta los márgenes máximos del ticket para alinearse con el ancho físico del papel de tu impresora.
          </p>
        </div>

        <div className="flex justify-end pt-2 border-t">
          <Button onClick={handleSave}>Guardar Ajustes de Impresión</Button>
        </div>
      </CardContent>
    </Card>
  );
}