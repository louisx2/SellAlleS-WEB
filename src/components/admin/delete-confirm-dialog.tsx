'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle } from 'lucide-react';

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Nombre exacto que el usuario debe escribir para habilitar el botón. */
  confirmName: string;
  onConfirm: () => Promise<void>;
}

// Confirmación reforzada para borrados irreversibles: el botón de eliminar
// permanece deshabilitado hasta que el usuario escribe el nombre exacto.
export function DeleteConfirmDialog({ open, onOpenChange, title, description, confirmName, onConfirm }: DeleteConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => { if (!open) setTyped(''); }, [open]);

  const matches = typed.trim() === confirmName.trim();

  const handleConfirm = async () => {
    if (!matches) return;
    setWorking(true);
    try {
      await onConfirm();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!working) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="confirmName">
            Escribe <span className="font-semibold">{confirmName}</span> para confirmar
          </Label>
          <Input
            id="confirmName"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>Cancelar</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!matches || working}>
            {working ? 'Eliminando…' : 'Eliminar definitivamente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
