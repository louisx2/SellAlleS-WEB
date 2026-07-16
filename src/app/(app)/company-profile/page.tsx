'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useToast } from '@/hooks/use-toast';
import type { CompanyProfile } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, Loader2, Upload } from 'lucide-react';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';

export default function CompanyProfilePage() {
  const { profile, updateProfile } = useCompanyProfile();
  const { appUser } = useAuth();
  const [formData, setFormData] = useState<CompanyProfile>(profile);
  const { toast } = useToast();
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingTicketLogo, setUploadingTicketLogo] = useState(false);

  const processAndUpload = async (file: File, type: 'logo' | 'ticket') => {
    const isLogo = type === 'logo';
    if (isLogo) setUploadingLogo(true);
    else setUploadingTicketLogo(true);

    try {
      // 1. Cargar la imagen en un Canvas
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await new Promise((resolve) => (img.onload = resolve));

      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Tamaño máximo: 512 para logo normal, 300 para ticket
      const maxDim = isLogo ? 512 : 300;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No se pudo obtener el contexto del Canvas');

      ctx.drawImage(img, 0, 0, width, height);

      // Conversión a escala de grises para el logo del ticket (impresión térmica)
      if (!isLogo) {
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Fórmula de luminancia para escala de grises
          const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }
        ctx.putImageData(imgData, 0, 0);
      }

      // 2. Convertir canvas a blob PNG
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!blob) throw new Error('Falló la conversión de la imagen');

      // 3. Subir a Supabase Storage (bucket público product-images)
      const path = `logos/${Date.now()}_${isLogo ? 'logo' : 'ticket'}.png`;
      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(path, blob, {
          cacheControl: '3600',
          contentType: 'image/png',
        });

      if (uploadError) throw uploadError;

      // 4. Obtener URL pública
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      // Actualizar el estado del formulario
      setFormData((prev) => ({
        ...prev,
        [isLogo ? 'logoUrl' : 'ticketLogoUrl']: publicUrl,
      }));

      toast({
        title: isLogo ? 'Logo de empresa actualizado' : 'Logo de ticket actualizado',
        description: 'La imagen ha sido optimizada y formateada automáticamente.',
      });
    } catch (err: any) {
      console.error(err);
      toast({
        title: 'Error al subir la imagen',
        description: err.message || 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      if (isLogo) setUploadingLogo(false);
      else setUploadingTicketLogo(false);
    }
  };

  // El perfil llega async desde el provider: sincronizar el formulario cuando
  // cambie (p. ej. carga directa de la página) para no mostrar datos vacíos.
  useEffect(() => { setFormData(profile); }, [profile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSocialChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
        ...prev,
        socialMedia: {
            ...prev.socialMedia,
            [name]: value,
        }
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile(formData);
    toast({
      title: 'Perfil actualizado',
      description: 'La información de la empresa ha sido guardada.',
    });
  };

  return (
    <>
    <form onSubmit={handleSubmit}>
      <PageHeader title="Perfil de la Empresa">
        <Button type="submit">Guardar Cambios</Button>
      </PageHeader>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Información de Contacto</CardTitle>
            <CardDescription>Datos principales de tu negocio.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre de la empresa</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                disabled={!appUser?.isSuperAdmin}
              />
              {!appUser?.isSuperAdmin && (
                <p className="text-xs text-muted-foreground">
                  Solo un super administrador de la plataforma puede cambiar el nombre de la empresa.
                </p>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" name="phone" value={formData.phone} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rnc">RNC</Label>
                <Input id="rnc" name="rnc" value={formData.rnc} onChange={handleChange} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Dirección</Label>
              <Input id="address" name="address" value={formData.address} onChange={handleChange} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personalización de Recibos</CardTitle>
            <CardDescription>Configura cómo se ven tus recibos impresos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="logoUrl">Logo de la Empresa (app, a color)</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Se muestra en el menú lateral y encabezado de la aplicación. Se auto-formatea a un tamaño óptimo.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex gap-2 items-center">
                  <Input id="logoUrl" name="logoUrl" value={formData.logoUrl || ''} onChange={handleChange} placeholder="https://..." className="flex-grow" />
                  <input
                    id="logo-file-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) processAndUpload(file, 'logo');
                      e.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploadingLogo}
                    onClick={() => document.getElementById('logo-file-input')?.click()}
                  >
                    {uploadingLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Subir
                  </Button>
                </div>
                {formData.logoUrl && (
                  <div className="mt-2 relative w-16 h-16 border rounded-md overflow-hidden bg-muted">
                    <img src={formData.logoUrl} alt="Vista previa logo" className="object-contain w-full h-full" />
                  </div>
                )}
              </div>
             <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="ticketLogoUrl">Logo para Tickets/Recibos (impresión térmica)</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Imagen optimizada para impresoras térmicas. Se auto-formatea automáticamente a escala de grises y un tamaño óptimo para impresión.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex gap-2 items-center">
                  <Input id="ticketLogoUrl" name="ticketLogoUrl" value={formData.ticketLogoUrl || ''} onChange={handleChange} placeholder="https://..." className="flex-grow" />
                  <input
                    id="ticket-logo-file-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) processAndUpload(file, 'ticket');
                      e.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploadingTicketLogo}
                    onClick={() => document.getElementById('ticket-logo-file-input')?.click()}
                  >
                    {uploadingTicketLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Subir
                  </Button>
                </div>
                {formData.ticketLogoUrl && (
                  <div className="mt-2 relative w-16 h-16 border rounded-md overflow-hidden bg-muted p-1">
                    <img src={formData.ticketLogoUrl} alt="Vista previa logo ticket" className="object-contain w-full h-full filter grayscale" />
                  </div>
                )}
              </div>
            <div className="space-y-2">
              <Label htmlFor="receiptFooter">Pie de Página del Recibo</Label>
              <Textarea
                id="receiptFooter"
                name="receiptFooter"
                value={formData.receiptFooter}
                onChange={handleChange}
                maxLength={150}
                placeholder="Ej: Gracias por su compra. Las devoluciones se aceptan hasta 7 días después de la compra."
                className="min-h-[80px]"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Redes Sociales</CardTitle>
            <CardDescription>Enlaces a tus perfiles sociales.</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="instagram">Instagram</Label>
              <Input id="instagram" name="instagram" value={formData.socialMedia.instagram} onChange={handleSocialChange} placeholder="@tuempresa" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="facebook">Facebook</Label>
              <Input id="facebook" name="facebook" value={formData.socialMedia.facebook} onChange={handleSocialChange} placeholder="fb.com/tuempresa" />
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
    </>
  );
}
