'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProductDialog } from './product-dialog';
import { TransferProductDialog } from './transfer-product-dialog';
import type { Product } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useProducts } from '@/context/product-provider';
import { useAuth } from '@/context/auth-provider';

interface ProductActionsProps {
  product: Product;
}

export function ProductActions({ product }: ProductActionsProps) {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const { deleteProduct } = useProducts();
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const handleDelete = async () => {
    // Se avisan las dos salidas posibles: un artículo ya vendido no se puede
    // borrar sin romper el historial y los reportes, así que se archiva.
    if (!confirm(
      `¿Eliminar "${product.name}"?\n\n` +
      'Si ya tiene ventas, cotizaciones o servicios asociados no se borra: se archiva, ' +
      'para no romper el historial. Deja de aparecer en el POS y en el inventario.'
    )) {
      return;
    }

    try {
      const resultado = await deleteProduct(product.id);
      toast(resultado === 'archivado'
        ? {
            title: 'Producto archivado',
            description: `"${product.name}" tiene historial, así que se archivó en vez de borrarse. Ya no aparece en el POS ni en el inventario.`,
          }
        : {
            title: 'Producto eliminado',
            description: `El producto "${product.name}" ha sido eliminado del catálogo.`,
          });
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error al eliminar',
        description: error?.message ?? 'No se pudo eliminar el producto. Inténtalo de nuevo.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Abrir menú</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Acciones</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTimeout(() => setEditOpen(true), 0)}>
            <Pencil className="mr-2 h-4 w-4" />
            <span>Editar</span>
          </DropdownMenuItem>
          {product.tracksStock && appUser?.role === 'admin' && (
            <DropdownMenuItem onSelect={() => setTimeout(() => setTransferOpen(true), 0)}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              <span>Transferir</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Eliminar</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProductDialog product={product} open={editOpen} onOpenChange={setEditOpen} />
      <TransferProductDialog product={product} open={transferOpen} onOpenChange={setTransferOpen} />
    </>
  );
}
