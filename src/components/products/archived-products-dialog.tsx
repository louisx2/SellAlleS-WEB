'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useProducts } from '@/context/product-provider';
import { useToast } from '@/hooks/use-toast';
import { ArchiveRestore, Undo2 } from 'lucide-react';

// Los artículos archivados no se borran: salen del POS y del inventario pero
// conservan su historial de ventas. Sin esta pantalla no había forma de volver a
// verlos ni de recuperarlos si se archivó uno por error.
export function ArchivedProductsDialog({ children }: { children?: React.ReactNode }) {
  const { archivedProducts, loadArchived, restoreProduct } = useProducts();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [restaurando, setRestaurando] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCargando(true);
    loadArchived().finally(() => setCargando(false));
  }, [open, loadArchived]);

  const handleRestaurar = async (id: string, nombre: string) => {
    setRestaurando(id);
    try {
      await restoreProduct(id);
      toast({ title: 'Producto restaurado', description: `"${nombre}" vuelve a estar en el inventario.` });
    } catch (err: any) {
      toast({ title: 'No se pudo restaurar', description: err?.message ?? 'Error desconocido.', variant: 'destructive' });
    } finally {
      setRestaurando(null);
    }
  };

  const fecha = (v?: string | null) =>
    v ? new Date(v).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <ArchiveRestore className="mr-2 h-4 w-4" /> Archivados
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Artículos archivados</DialogTitle>
          <DialogDescription>
            Se archivan en vez de borrarse cuando ya tienen ventas, para no romper el
            historial. Restaurar uno lo devuelve al inventario y al POS.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artículo</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Archivado</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando ? (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Cargando…</TableCell></TableRow>
              ) : archivedProducts.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No hay artículos archivados en esta sucursal.
                </TableCell></TableRow>
              ) : archivedProducts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.code || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fecha(p.archivedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline" size="sm" className="h-8 text-xs"
                      disabled={restaurando === p.id}
                      onClick={() => handleRestaurar(p.id, p.name)}
                    >
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                      {restaurando === p.id ? 'Restaurando…' : 'Restaurar'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
