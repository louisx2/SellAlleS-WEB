'use client';

import { useState } from 'react';
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
import type { Branch } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useBranches } from '@/context/branch-provider';
import { supabase } from '@/lib/supabase/client';
import { Loader2, Upload } from 'lucide-react';

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
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingTicketLogo, setUploadingTicketLogo] = useState(false);

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
