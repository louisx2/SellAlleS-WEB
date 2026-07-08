'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FolderOpen } from 'lucide-react';
import { CategoryManager } from './category-manager';

interface CategoryDialogProps {
  children?: React.ReactNode;
}

export function CategoryDialog({ children }: CategoryDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="icon">
            <FolderOpen className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gestionar Categorías</DialogTitle>
          <DialogDescription>
            Crea, edita o elimina las categorías del inventario.
          </DialogDescription>
        </DialogHeader>
        <CategoryManager />
      </DialogContent>
    </Dialog>
  );
}
