'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useProducts, type BulkImportItem, type BulkImportResult } from '@/context/product-provider';
import { useCategories } from '@/context/category-provider';
import { useSuppliers } from '@/context/supplier-provider';
import { useLocations } from '@/context/location-provider';
import { parseProductsCsv, buildTemplateCsv, downloadTextFile, type ParsedProductRow } from '@/lib/inventory-csv';
import type { Product } from '@/lib/types';
import { Download, FileUp, Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

type Step = 'upload' | 'preview' | 'done';

// Decisión por fila cuyo código ya existe: actualizar el producto o crear uno
// nuevo con otro código.
interface DupDecision {
  action: 'update' | 'create';
  newCode: string;
}

interface ImportProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const normName = (s: string) => s.trim().toLowerCase();

export function ImportProductsDialog({ open, onOpenChange }: ImportProductsDialogProps) {
  const { toast } = useToast();
  const { products, bulkImportProducts } = useProducts();
  const { categories, addCategory } = useCategories();
  const { suppliers, addSupplier } = useSuppliers();
  const { locations, addLocation } = useLocations();

  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<ParsedProductRow[]>([]);
  const [dupDecisions, setDupDecisions] = useState<Record<number, DupDecision>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Código (normalizado) -> producto existente de la empresa.
  const codeMap = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => { if (p.code) m.set(normName(p.code), p); });
    return m;
  }, [products]);

  // Filas con código repetido DENTRO del archivo (todas menos la primera aparición).
  const inFileDupRows = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<number>();
    rows.forEach((r) => {
      const c = normName(r.code);
      if (!c) return;
      if (seen.has(c)) dups.add(r.rowNumber);
      else seen.set(c, r.rowNumber);
    });
    return dups;
  }, [rows]);

  const conflictRows = useMemo(
    () => rows.filter((r) => r.errors.length === 0 && !inFileDupRows.has(r.rowNumber) && r.code && codeMap.has(normName(r.code))),
    [rows, codeMap, inFileDupRows],
  );
  const errorRows = useMemo(
    () => rows.filter((r) => r.errors.length > 0 || inFileDupRows.has(r.rowNumber)),
    [rows, inFileDupRows],
  );
  const cleanRows = useMemo(
    () => rows.filter((r) => r.errors.length === 0 && !inFileDupRows.has(r.rowNumber) && (!r.code || !codeMap.has(normName(r.code)))),
    [rows, codeMap, inFileDupRows],
  );

  // Referencias nuevas que se crearán automáticamente.
  const newRefs = useMemo(() => {
    const catSet = new Set(categories.map((c) => normName(c.name)));
    const supSet = new Set(suppliers.map((s) => normName(s.name)));
    const locSet = new Set(locations.map((l) => normName(l.name)));
    const cats = new Set<string>(); const sups = new Set<string>(); const locs = new Set<string>();
    rows.forEach((r) => {
      if (r.errors.length > 0) return;
      if (r.categoryName && !catSet.has(normName(r.categoryName))) cats.add(r.categoryName);
      if (r.supplierName && !supSet.has(normName(r.supplierName))) sups.add(r.supplierName);
      if (r.locationName && !locSet.has(normName(r.locationName))) locs.add(r.locationName);
    });
    return { cats: [...cats], sups: [...sups], locs: [...locs] };
  }, [rows, categories, suppliers, locations]);

  // Sugerir un código libre: ABC -> ABC-2, ABC-3…
  const suggestCode = (base: string): string => {
    const taken = new Set<string>(codeMap.keys());
    rows.forEach((r) => { if (r.code) taken.add(normName(r.code)); });
    let i = 2;
    while (taken.has(normName(`${base}-${i}`))) i++;
    return `${base}-${i}`;
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = await parseProductsCsv(text);
      if (parsed.length === 0) {
        toast({ title: 'Archivo vacío', description: 'No se encontraron filas de productos.', variant: 'destructive' });
        return;
      }
      setRows(parsed);
      // Decisión inicial para cada conflicto: actualizar (con sugerencia lista por si eligen crear).
      const decisions: Record<number, DupDecision> = {};
      parsed.forEach((r) => {
        if (r.errors.length === 0 && r.code && codeMap.has(normName(r.code))) {
          decisions[r.rowNumber] = { action: 'update', newCode: suggestCode(r.code) };
        }
      });
      setDupDecisions(decisions);
      setStep('preview');
    } catch (err: any) {
      toast({ title: 'No se pudo leer el archivo', description: err?.message ?? 'Error de lectura.', variant: 'destructive' });
    }
  };

  const handleImport = async () => {
    // Validar códigos nuevos elegidos en conflictos que se crearán.
    for (const r of conflictRows) {
      const d = dupDecisions[r.rowNumber];
      if (d?.action === 'create') {
        const nc = d.newCode.trim();
        if (!nc) {
          toast({ title: 'Falta un código', description: `Fila ${r.rowNumber}: escribe el código nuevo.`, variant: 'destructive' });
          return;
        }
        if (codeMap.has(normName(nc))) {
          toast({ title: 'Código en uso', description: `Fila ${r.rowNumber}: "${nc}" ya existe.`, variant: 'destructive' });
          return;
        }
      }
    }

    setImporting(true);
    try {
      // 1) Crear referencias faltantes (una vez por nombre) y armar mapas nombre->id.
      const catId = new Map(categories.map((c) => [normName(c.name), c.id]));
      const supId = new Map(suppliers.map((s) => [normName(s.name), s.id]));
      const locId = new Map(locations.map((l) => [normName(l.name), l.id]));
      for (const name of newRefs.cats) { const c = await addCategory({ name }); catId.set(normName(name), c.id); }
      for (const name of newRefs.sups) {
        const s = await addSupplier({ name, contactPerson: '', phone: '', email: '', address: '', rnc: '' });
        supId.set(normName(name), s.id);
      }
      for (const name of newRefs.locs) { const l = await addLocation({ name }); locId.set(normName(name), l.id); }

      // 2) Armar items.
      const toItem = (r: ParsedProductRow, existingId: string | null, codeOverride?: string): BulkImportItem => ({
        existingId,
        data: {
          code: (codeOverride ?? r.code) || '',
          name: r.name,
          description: r.description,
          categoryId: r.categoryName ? catId.get(normName(r.categoryName)) : undefined,
          supplierId: r.supplierName ? supId.get(normName(r.supplierName)) : undefined,
          cost: r.cost,
          price: r.price,
          itbis: r.itbis,
          stock: r.stock,
          locationId: r.locationName ? locId.get(normName(r.locationName)) : undefined,
          wholesalePrice: r.wholesalePrice,
          wholesaleMinQuantity: r.wholesaleMinQuantity,
          image: r.imageUrl && /^(https?:|data:)/i.test(r.imageUrl) ? r.imageUrl : 'placeholder',
        },
      });

      const items: BulkImportItem[] = [
        ...cleanRows.map((r) => toItem(r, null)),
        ...conflictRows.map((r) => {
          const d = dupDecisions[r.rowNumber];
          if (d?.action === 'create') return toItem(r, null, d.newCode.trim());
          return toItem(r, codeMap.get(normName(r.code))!.id);
        }),
      ];

      setProgress({ done: 0, total: items.length });
      const res = await bulkImportProducts(items, (done, total) => setProgress({ done, total }));
      setResult(res);
      setStep('done');
    } catch (err: any) {
      toast({ title: 'Error al importar', description: err?.message ?? 'Falló la importación.', variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep('upload'); setRows([]); setDupDecisions({}); setResult(null); setProgress({ done: 0, total: 0 });
  };

  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };

  const importable = cleanRows.length + conflictRows.length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar inventario</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Sube un archivo CSV con tus productos, o descarga la plantilla para llenarla.'}
            {step === 'preview' && 'Revisa lo que se va a importar. Nada se guarda hasta que confirmes.'}
            {step === 'done' && 'Resultado de la importación.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Button variant="outline" onClick={() => downloadTextFile('plantilla_inventario.csv', buildTemplateCsv())}>
              <Download className="mr-2 h-4 w-4" /> Descargar plantilla CSV
            </Button>
            <p className="text-sm text-muted-foreground">Columnas: codigo, nombre, categoria, proveedor, costo, precio, itbis, existencias, ubicacion…</p>
            <Button onClick={() => fileRef.current?.click()}>
              <FileUp className="mr-2 h-4 w-4" /> Elegir archivo CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
            />
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="default">{cleanRows.length} nuevos</Badge>
              <Badge variant="secondary">{conflictRows.length} con código existente</Badge>
              <Badge variant={errorRows.length > 0 ? 'destructive' : 'outline'}>{errorRows.length} con error (se omiten)</Badge>
            </div>

            {(newRefs.cats.length > 0 || newRefs.sups.length > 0 || newRefs.locs.length > 0) && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium mb-1">Se crearán automáticamente:</p>
                {newRefs.cats.length > 0 && <p>Categorías: {newRefs.cats.join(', ')}</p>}
                {newRefs.sups.length > 0 && <p>Proveedores: {newRefs.sups.join(', ')}</p>}
                {newRefs.locs.length > 0 && <p>Ubicaciones: {newRefs.locs.join(', ')}</p>}
              </div>
            )}

            {conflictRows.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
                <p className="font-medium text-sm mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Códigos que ya existen en tu inventario — decide qué hacer con cada uno:
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Producto del archivo</TableHead>
                        <TableHead>Ya existe como</TableHead>
                        <TableHead>Acción</TableHead>
                        <TableHead>Código nuevo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {conflictRows.map((r) => {
                        const existing = codeMap.get(normName(r.code))!;
                        const d = dupDecisions[r.rowNumber] ?? { action: 'update' as const, newCode: '' };
                        return (
                          <TableRow key={r.rowNumber}>
                            <TableCell className="font-mono text-xs">{r.code}</TableCell>
                            <TableCell className="text-sm">{r.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{existing.name}</TableCell>
                            <TableCell>
                              <Select
                                value={d.action}
                                onValueChange={(v) => setDupDecisions((prev) => ({ ...prev, [r.rowNumber]: { ...d, action: v as DupDecision['action'] } }))}
                              >
                                <SelectTrigger className="w-[190px] h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="update">Actualizar el existente</SelectItem>
                                  <SelectItem value="create">Crear con código nuevo</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              {d.action === 'create' ? (
                                <Input
                                  className="h-8 w-[130px] font-mono text-xs"
                                  value={d.newCode}
                                  onChange={(e) => setDupDecisions((prev) => ({ ...prev, [r.rowNumber]: { ...d, newCode: e.target.value } }))}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {errorRows.length > 0 && (
              <div className="rounded-lg border border-destructive/40 p-3">
                <p className="font-medium text-sm mb-2 text-destructive">Filas con error (no se importarán):</p>
                <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
                  {errorRows.map((r) => (
                    <li key={r.rowNumber}>
                      Fila {r.rowNumber} {r.name ? `(${r.name})` : ''}: {inFileDupRows.has(r.rowNumber) ? `Código "${r.code}" repetido dentro del archivo. ` : ''}{r.errors.join(' ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {importing && (
              <div className="space-y-1">
                <div className="h-2 w-full rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%' }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">{progress.done} de {progress.total}</p>
              </div>
            )}
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-3 py-4">
            <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {result.created} productos creados</p>
            <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {result.updated} productos actualizados</p>
            {result.failed.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-sm text-destructive"><XCircle className="h-4 w-4" /> {result.failed.length} fallaron:</p>
                <ul className="text-xs mt-1 space-y-1 max-h-32 overflow-y-auto">
                  {result.failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
                </ul>
              </div>
            )}
            {errorRows.length > 0 && (
              <p className="text-xs text-muted-foreground">{errorRows.length} filas se omitieron por errores en el archivo.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={() => close(false)}>Cancelar</Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={reset} disabled={importing}>Atrás</Button>
              <Button onClick={handleImport} disabled={importing || importable === 0}>
                {importing ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importando…</>) : `Importar ${importable} productos`}
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={() => close(false)}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
