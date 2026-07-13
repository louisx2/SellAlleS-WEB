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
import { Info } from 'lucide-react';
import { NcfSettingsCard } from '@/components/company-profile/ncf-settings-card';
import { FinancingSettingsCard } from '@/components/company-profile/financing-settings-card';
import { LoanSettingsCard } from '@/components/company-profile/loan-settings-card';
import { LoyaltySettingsCard } from '@/components/company-profile/loyalty-settings-card';
import { CajaEmailSettingsCard } from '@/components/company-profile/caja-email-settings-card';
import { BranchSharingCard } from '@/components/company-profile/branch-sharing-card';
import { useModules } from '@/context/modules-provider';
import { useAuth } from '@/context/auth-provider';

export default function CompanyProfilePage() {
  const { profile, updateProfile } = useCompanyProfile();
  const { isModuleEnabled } = useModules();
  const { appUser } = useAuth();
  const [formData, setFormData] = useState<CompanyProfile>(profile);
  const { toast } = useToast();

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
                  <Label htmlFor="logoUrl">URL del Logo</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Sube tu logo a un servicio como postimages.org.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input id="logoUrl" name="logoUrl" value={formData.logoUrl} onChange={handleChange} />
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
    {/* Fuera del form: tiene sus propios controles de guardado y no debe
        dispararse con el submit de "Guardar Cambios". */}
    <div className="mt-6">
      <NcfSettingsCard />
    </div>
    <div className="mt-6">
      <FinancingSettingsCard />
    </div>
    {isModuleEnabled('prestamos') && (
      <div className="mt-6">
        <LoanSettingsCard />
      </div>
    )}
    {isModuleEnabled('loyalty') && (
      <div className="mt-6">
        <LoyaltySettingsCard />
      </div>
    )}
    {isModuleEnabled('caja') && (
      <div className="mt-6">
        <CajaEmailSettingsCard />
      </div>
    )}
    <div className="mt-6">
      <BranchSharingCard />
    </div>
    </>
  );
}
