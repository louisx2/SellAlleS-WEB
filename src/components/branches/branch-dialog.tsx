'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatPhone } from '@/lib/format';
import type { Branch } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useBranches } from '@/context/branch-provider';
import { supabase } from '@/lib/supabase/client';
import { Loader2, Upload } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface BranchDialogProps {
  branch?: Branch;
  children: React.ReactNode;
}

export function BranchDialog({ branch, children }: BranchDialogProps) {
  const { toast } = useToast();
  const { addBranch, updateBranch } = useBranches();
  const isEditMode = !!branch;
  const [open, setOpen] = useState(false);

  const [logoUrl, setLogoUrl] = useState(branch?.logoUrl || '');
  const [ticketLogoUrl, setTicketLogoUrl] = useState(branch?.ticketLogoUrl || '');
  const [phone, setPhone] = useState(branch?.phone || '');
  const [itbisIncluded, setItbisIncluded] = useState(branch?.itbisIncluded ?? false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingTicketLogo, setUploadingTicketLogo] = useState(false);

  useEffect(() => {
    if (open) {
      setLogoUrl(branch?.logoUrl || '');
      setTicketLogoUrl(branch?.ticketLogoUrl || '');
      setPhone(branch?.phone || '');
      setItbisIncluded(branch?.itbisIncluded ?? false);
    }
  }, [open, branch]);

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

      // Si es una sucursal nueva, usamos un UUID aleatorio para la imagen.
      const fileId = branch?.id || crypto.randomUUID();
      const filename = `logos/branch_${fileId}_${type}.png`;

      const { error } = await supabase.storage
        .from('product-images')
        .upload(filename, blob, { contentType: 'image/png', upsert: true });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(filename);

      if (isLogo) {
        setLogoUrl(publicUrl);
        toast({ title: 'Logo de sucursal subido', description: 'El logo principal se cargó correctamente.' });
      } else {
        setTicketLogoUrl(publicUrl);
        toast({ title: 'Logo de ticket subido', description: 'El logo del ticket se optimizó correctamente.' });
      }
    } catch (err: any) {
      toast({
        title: 'Error de carga',
        description: err?.message || 'Ocurrió un error al procesar la imagen.',
        variant: 'destructive',
      });
    } finally {
      if (isLogo) setUploadingLogo(false);
      else setUploadingTicketLogo(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newBranchData = {
      id: branch?.id ?? '',
      name: formData.get('name') as string,
      location: formData.get('location') as string,
      isActive: branch?.isActive ?? true,
      logoUrl: logoUrl || undefined,
      ticketLogoUrl: ticketLogoUrl || undefined,
      itbisIncluded: itbisIncluded,
      // Perfil del ticket: vacío = hereda del perfil de la empresa.
      displayName: (formData.get('displayName') as string) || undefined,
      phone: phone || undefined,
      address: (formData.get('address') as string) || undefined,
      receiptFooter: (formData.get('receiptFooter') as string) || undefined,
    };

    if (isEditMode && branch) {
      updateBranch({ ...branch, ...newBranchData });
      toast({
        title: `Sucursal actualizada`,
        description: `La sucursal '${newBranchData.name}' ha sido actualizada.`,
      });
    } else {
      addBranch(newBranchData);
      toast({
        title: `Sucursal añadida`,
        description: `La sucursal '${newBranchData.name}' ha sido añadida.`,
      });
    }
    setOpen(false);
    setTimeout(() => window.location.reload(), 800);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Sucursal' : 'Añadir Sucursal'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Edita los detalles de la sucursal y sus logotipos.' : 'Añade una nueva sucursal y sus logotipos.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Nombre
              </Label>
              <Input id="name" name="name" defaultValue={branch?.name} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="location" className="text-right">
                Ubicación
              </Label>
              <Input id="location" name="location" defaultValue={branch?.location} className="col-span-3" required />
            </div>

            <div className="border-t pt-3">
              <p className="text-sm font-medium">Configuración de Impuestos</p>
              <p className="text-xs text-muted-foreground">
                Define cómo se calcula el ITBIS en los precios de venta de esta sucursal.
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 border rounded-lg p-3">
              <div className="space-y-0.5 col-span-3">
                <Label htmlFor="itbisIncluded" className="font-medium cursor-pointer text-sm">
                  Precios con ITBIS incluido
                </Label>
                <p className="text-xs text-muted-foreground leading-normal">
                  El POS desglosará el 18% hacia adentro. Desactivado sumará el 18% al total.
                </p>
              </div>
              <Switch
                id="itbisIncluded"
                checked={itbisIncluded}
                onCheckedChange={setItbisIncluded}
              />
            </div>

            <div className="border-t pt-3">
              <p className="text-sm font-medium">Perfil del ticket</p>
              <p className="text-xs text-muted-foreground">
                Datos que salen impresos en los tickets de esta sucursal. Si dejas un campo vacío, se usa el del perfil de la empresa.
              </p>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="displayName" className="text-right">
                Nombre comercial
              </Label>
              <Input id="displayName" name="displayName" defaultValue={branch?.displayName} className="col-span-3" placeholder="El de la empresa" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="branch-phone" className="text-right">
                Teléfono
              </Label>
              <Input
                id="branch-phone"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                className="col-span-3"
                placeholder="809-000-0000"
                inputMode="tel"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="branch-address" className="text-right">
                Dirección
              </Label>
              <Input id="branch-address" name="address" defaultValue={branch?.address} className="col-span-3" placeholder="La de la empresa" />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="receiptFooter" className="text-right pt-2">
                Pie de recibo
              </Label>
              <Textarea id="receiptFooter" name="receiptFooter" defaultValue={branch?.receiptFooter} className="col-span-3" rows={2} placeholder="El de la empresa" />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="logo" className="text-right">
                Logo App
              </Label>
              <div className="col-span-3 flex items-center gap-2">
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
                  size="sm"
                  disabled={uploadingLogo}
                  onClick={() => document.getElementById('branch-logo-file')?.click()}
                >
                  {uploadingLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Subir
                </Button>
                {logoUrl && (
                  <img src={logoUrl} alt="Preview logo" className="h-8 w-8 object-contain border rounded bg-muted" />
                )}
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ticket-logo" className="text-right">
                Logo Ticket
              </Label>
              <div className="col-span-3 flex items-center gap-2">
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
                  size="sm"
                  disabled={uploadingTicketLogo}
                  onClick={() => document.getElementById('branch-ticket-file')?.click()}
                >
                  {uploadingTicketLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Subir
                </Button>
                {ticketLogoUrl && (
                  <img src={ticketLogoUrl} alt="Preview ticket" className="h-8 w-8 object-contain border rounded bg-muted filter grayscale" />
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
             <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit">Guardar Cambios</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
