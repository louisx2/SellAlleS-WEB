'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useBranches } from '@/context/branch-provider';
import { useToast } from '@/hooks/use-toast';
import type { CompanyProfile } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, Loader2, Upload, Store, Building2 } from 'lucide-react';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';

export default function CompanyProfilePage() {
  const { profile, updateProfile } = useCompanyProfile();
  const { branches, updateBranch } = useBranches();
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [companyData, setCompanyData] = useState<CompanyProfile>(profile);
  const [branchName, setBranchName] = useState('');
  const [branchDisplayName, setBranchDisplayName] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchRnc, setBranchRnc] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchLogoUrl, setBranchLogoUrl] = useState('');
  const [branchTicketLogoUrl, setBranchTicketLogoUrl] = useState('');
  const [branchReceiptFooter, setBranchReceiptFooter] = useState('');

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingTicketLogo, setUploadingTicketLogo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const activeBranch = branches.find((b) => b.id === appUser?.activeBranchId);

  // Sincronizar estados locales con los contextos cargados
  useEffect(() => {
    setCompanyData(profile);
  }, [profile]);

  useEffect(() => {
    if (activeBranch) {
      setBranchName(activeBranch.name || '');
      setBranchDisplayName(activeBranch.displayName || '');
      setBranchPhone(activeBranch.phone || '');
      setBranchRnc(activeBranch.rnc || '');
      setBranchAddress(activeBranch.address || '');
      setBranchLogoUrl(activeBranch.logoUrl || '');
      setBranchTicketLogoUrl(activeBranch.ticketLogoUrl || '');
      setBranchReceiptFooter(activeBranch.receiptFooter || '');
    }
  }, [activeBranch]);

  const processAndUpload = async (file: File, type: 'logo' | 'ticket') => {
    const isLogo = type === 'logo';
    if (isLogo) setUploadingLogo(true);
    else setUploadingTicketLogo(true);

    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await new Promise((resolve) => (img.onload = resolve));

      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

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

      if (!isLogo) {
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }
        ctx.putImageData(imgData, 0, 0);
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!blob) throw new Error('Falló la conversión de la imagen');

      // Si es una sucursal nueva y no tiene id, usamos un UUID aleatorio para la imagen.
      const fileId = activeBranch?.id || crypto.randomUUID();
      const path = `logos/branch_${fileId}_${isLogo ? 'logo' : 'ticket'}_${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(path, blob, {
          cacheControl: '3600',
          contentType: 'image/png',
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      if (isLogo) {
        setBranchLogoUrl(publicUrl);
        toast({
          title: 'Logo de sucursal cargado',
          description: 'El logo principal se cargó y optimizó.',
        });
      } else {
        setBranchTicketLogoUrl(publicUrl);
        toast({
          title: 'Logo de ticket cargado',
          description: 'El logo para tickets térmicos se convirtió a escala de grises.',
        });
      }
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

  const handleCompanyChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCompanyData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSocialChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCompanyData((prev) => ({
      ...prev,
      socialMedia: {
        ...prev.socialMedia,
        [name]: value,
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      // 1. Guardar cambios de la empresa global
      await updateProfile(companyData);

      // 2. Guardar cambios de la sucursal activa
      if (activeBranch) {
        await updateBranch({
          ...activeBranch,
          name: branchName,
          displayName: branchDisplayName || undefined,
          phone: branchPhone || undefined,
          rnc: branchRnc || undefined,
          address: branchAddress || undefined,
          logoUrl: branchLogoUrl || undefined,
          ticketLogoUrl: branchTicketLogoUrl || undefined,
          receiptFooter: branchReceiptFooter || undefined,
        });
      }

      toast({
        title: 'Perfil actualizado',
        description: 'La información del perfil de la sucursal ha sido guardada.',
      });

      // Recarga forzada estándar para prevenir pointer-events freeze
      setTimeout(() => window.location.reload(), 800);
    } catch (error: any) {
      toast({
        title: 'Error al guardar cambios',
        description: error?.message ?? 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <PageHeader title="Perfil de la Sucursal">
          <Button type="submit" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Cambios
          </Button>
        </PageHeader>

        <div className="grid gap-6">
          {/* SECCIÓN SUCURSAL ACTIVA */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="h-5 w-5 text-primary" /> Información de la Sucursal Activa
              </CardTitle>
              <CardDescription>
                Configura los datos del punto de venta en el que estás operando actualmente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!activeBranch ? (
                <p className="text-sm text-muted-foreground">Cargando datos de la sucursal...</p>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="branchName">Nombre de la sucursal (interno)</Label>
                      <Input
                        id="branchName"
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value)}
                        placeholder="Ej: Principal, Zona Oriental"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="branchDisplayName">Nombre comercial (se muestra en tickets)</Label>
                      <Input
                        id="branchDisplayName"
                        value={branchDisplayName}
                        onChange={(e) => setBranchDisplayName(e.target.value)}
                        placeholder="Dejar vacío para usar el nombre de la empresa"
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="branchRnc">RNC de la sucursal</Label>
                      <Input
                        id="branchRnc"
                        value={branchRnc}
                        onChange={(e) => setBranchRnc(e.target.value)}
                        placeholder="RNC específico para esta sucursal"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="branchPhone">Teléfono de la sucursal</Label>
                      <Input
                        id="branchPhone"
                        value={branchPhone}
                        onChange={(e) => setBranchPhone(e.target.value)}
                        placeholder="Ej: 809-555-5555"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="branchAddress">Dirección de la sucursal</Label>
                    <Input
                      id="branchAddress"
                      value={branchAddress}
                      onChange={(e) => setBranchAddress(e.target.value)}
                      placeholder="Dirección física del punto de venta"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* PERSONALIZACIÓN DE RECIBOS DE SUCURSAL */}
          <Card>
            <CardHeader>
              <CardTitle>Impresión y Logos (Sucursal)</CardTitle>
              <CardDescription>
                Sube el logotipo a color y blanco/negro de la sucursal. Si no se configuran, se usarán los globales de la empresa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="branchLogoUrl">Logo de la Sucursal (App, a color)</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Se muestra en la app para esta sucursal.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex gap-2 items-center">
                  <Input
                    id="branchLogoUrl"
                    value={branchLogoUrl}
                    onChange={(e) => setBranchLogoUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-grow"
                  />
                  <input
                    id="branch-logo-file"
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
                    onClick={() => document.getElementById('branch-logo-file')?.click()}
                  >
                    {uploadingLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Subir
                  </Button>
                </div>
                {branchLogoUrl && (
                  <div className="mt-2 w-16 h-16 border rounded-md overflow-hidden bg-muted">
                    <img src={branchLogoUrl} alt="Vista previa logo sucursal" className="object-contain w-full h-full" />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="branchTicketLogoUrl">Logo para Tickets (Impresión térmica)</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Se convierte automáticamente a escala de grises y un tamaño óptimo.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex gap-2 items-center">
                  <Input
                    id="branchTicketLogoUrl"
                    value={branchTicketLogoUrl}
                    onChange={(e) => setBranchTicketLogoUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-grow"
                  />
                  <input
                    id="branch-ticket-file"
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
                    onClick={() => document.getElementById('branch-ticket-file')?.click()}
                  >
                    {uploadingTicketLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Subir
                  </Button>
                </div>
                {branchTicketLogoUrl && (
                  <div className="mt-2 w-16 h-16 border rounded-md overflow-hidden bg-muted p-1">
                    <img
                      src={branchTicketLogoUrl}
                      alt="Vista previa logo ticket sucursal"
                      className="object-contain w-full h-full filter grayscale"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="branchReceiptFooter">Pie de Página del Recibo (de esta sucursal)</Label>
                <Textarea
                  id="branchReceiptFooter"
                  value={branchReceiptFooter}
                  onChange={(e) => setBranchReceiptFooter(e.target.value)}
                  maxLength={150}
                  placeholder="Ej: Gracias por comprar en esta sucursal. Cambios hasta 7 días."
                  className="min-h-[80px]"
                />
              </div>
            </CardContent>
          </Card>

          {/* SECCIÓN EMPRESA GLOBAL (SOCIAL MEDIA Y RNC GLOBAL) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" /> Información de la Empresa (Global)
              </CardTitle>
              <CardDescription>
                Configura los datos fiscales y redes sociales que comparte toda la empresa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="company-name">Nombre de la empresa global</Label>
                <Input
                  id="company-name"
                  name="name"
                  value={companyData.name}
                  onChange={handleCompanyChange}
                  disabled={!appUser?.isSuperAdmin}
                />
                {!appUser?.isSuperAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Solo un super administrador de la plataforma puede cambiar el nombre de la empresa global.
                  </p>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="company-rnc">RNC de la empresa (global)</Label>
                  <Input
                    id="company-rnc"
                    name="rnc"
                    value={companyData.rnc || ''}
                    onChange={handleCompanyChange}
                    placeholder="RNC global"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="ticketNameDisplay">Nombre en el encabezado de recibos</Label>
                  </div>
                  <Select
                    value={companyData.ticketNameDisplay}
                    onValueChange={(v) =>
                      setCompanyData((prev) => ({
                        ...prev,
                        ticketNameDisplay: v as CompanyProfile['ticketNameDisplay'],
                      }))
                    }
                  >
                    <SelectTrigger id="ticketNameDisplay">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company">Solo el nombre de la empresa</SelectItem>
                      <SelectItem value="branch">Solo el nombre de la sucursal</SelectItem>
                      <SelectItem value="both">Ambos (empresa y sucursal)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="instagram">Instagram</Label>
                  <Input
                    id="instagram"
                    name="instagram"
                    value={companyData.socialMedia.instagram}
                    onChange={handleSocialChange}
                    placeholder="@tuempresa"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="facebook">Facebook</Label>
                  <Input
                    id="facebook"
                    name="facebook"
                    value={companyData.socialMedia.facebook}
                    onChange={handleSocialChange}
                    placeholder="fb.com/tuempresa"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </>
  );
}
