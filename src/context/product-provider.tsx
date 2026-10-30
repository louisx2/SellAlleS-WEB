'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Product, ProductPresentation } from '@/lib/types';
import type { PresentationDraft, PresentationInput } from '@/lib/presentations';
import { supabase } from '@/lib/supabase/client';
import { useRealtimeReload } from '@/lib/use-realtime-reload';
import { rowToProduct, productToRow, rowToPresentation } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';

// Productos con sus presentaciones en la misma consulta (embed de PostgREST).
const PRODUCT_SELECT = '*, product_presentations(*)';

export interface BulkImportItem {
  /** null = crear; id = actualizar ese producto existente. */
  existingId: string | null;
  data: Omit<Product, 'id'>;
  /** Se vende suelto; undefined = no tocar (en un producto nuevo queda en sí). */
  soldLoose?: boolean;
  /** Presentaciones ya validadas del CSV; se escriben sin borrar las que existan. */
  presentations?: PresentationInput[];
}

export interface BulkImportResult {
  created: number;
  updated: number;
  failed: { name: string; error: string }[];
}

interface ProductContextType {
  products: Product[];
  updateStock: (productId: string, quantitySold: number) => Promise<void>;
  /** Devuelve el producto ya guardado (con su id) para poder usarlo enseguida. */
  addProduct: (product: Omit<Product, 'id'>) => Promise<Product>;
  updateProduct: (product: Product) => Promise<void>;
  /** Borra el artículo; si ya tiene historial lo archiva y devuelve 'archivado'. */
  deleteProduct: (id: string) => Promise<'eliminado' | 'archivado'>;
  /** Los archivados de esta sucursal, con la fecha en que se archivaron. */
  archivedProducts: (Product & { archivedAt?: string | null })[];
  loadArchived: () => Promise<void>;
  restoreProduct: (id: string) => Promise<void>;
  bulkImportProducts: (items: BulkImportItem[], onProgress?: (done: number, total: number) => void) => Promise<BulkImportResult>;
  /**
   * Guarda el estado completo de las presentaciones del producto (las que no vengan
   * se borran) y si se vende suelto, en una sola transacción. Los borradores ya tienen
   * que haber pasado `validateDrafts`. Devuelve las presentaciones como quedaron y
   * actualiza el producto en el estado local.
   */
  savePresentations: (productId: string, soldLoose: boolean, drafts: PresentationDraft[]) => Promise<ProductPresentation[]>;
  /** Relee productos de la base (p. ej. tras una compra que sumó stock en el servidor). */
  reload: () => Promise<void>;
  loading: boolean;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

// ---------- Importación de presentaciones ----------

// Forma que espera `import_product_presentations`: una fila por producto. `code` solo
// va cuando tiene valor (la base lo deja como está cuando la clave falta, y lo borra
// cuando viene vacía); `sold_loose` ausente deja el valor actual.
type ImportPresentationRow = {
  product_id: string;
  sold_loose?: boolean;
  presentations: { name: string; units: number; price: number; code?: string }[];
};

// Va a la RPC todo el que trae presentaciones o dice sí/no en «se vende suelto» (un sí
// explícito sirve para volver a vender suelto un producto que ya no lo estaba). Con
// `soldLoose` undefined —celda vacía— no se toca nada de eso.
const wantsPresentations = (item: BulkImportItem) =>
  (item.presentations?.length ?? 0) > 0 || item.soldLoose !== undefined;

const toImportPresentationRow = (item: BulkImportItem, productId: string): ImportPresentationRow => ({
  product_id: productId,
  ...(item.soldLoose !== undefined ? { sold_loose: item.soldLoose } : {}),
  presentations: (item.presentations ?? []).map((p) => {
    const code = p.code?.trim() ?? '';
    return {
      name: p.name.trim(),
      units: p.units,
      price: p.price,
      ...(code !== '' ? { code } : {}),
    };
  }),
});

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

// Empareja cada producto del lote con la fila que devolvió el insert (el orden de un
// insert múltiple no está garantizado): primero por código y, a los que no tienen
// código o no aparecen, por nombre. Cada fila se usa una sola vez, así dos productos
// con el mismo nombre no se quedan con el mismo id. Devuelve el id (o undefined) en el
// mismo orden del lote.
function matchCreatedProducts(
  batch: BulkImportItem[],
  rows: { id: string; code?: string | null; name?: string | null }[],
): (string | undefined)[] {
  const used = new Set<string>();
  const ids: (string | undefined)[] = batch.map(() => undefined);

  batch.forEach((b, idx) => {
    const code = norm(b.data.code);
    if (code === '') return;
    const hit = rows.find((r) => !used.has(r.id) && norm(r.code) === code);
    if (hit) { used.add(hit.id); ids[idx] = hit.id; }
  });
  batch.forEach((b, idx) => {
    if (ids[idx]) return;
    const name = norm(b.data.name);
    const hit = rows.find((r) => !used.has(r.id) && norm(r.name) === name);
    if (hit) { used.add(hit.id); ids[idx] = hit.id; }
  });
  return ids;
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  // Los archivados no se traen con el inventario: solo cuando se piden, que es al
  // abrir la vista de archivados. No hace falta cargarlos en cada visita al POS.
  const [archivedProducts, setArchivedProducts] = useState<(Product & { archivedAt?: string | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const { appUser } = useAuth();
  const activeBranchId = appUser?.activeBranchId;

  const load = useCallback(async () => {
    if (!activeBranchId) return;
    // Los archivados no se listan: siguen en la base por su historial de ventas.
    const { data, error } = await supabase.from('products').select(PRODUCT_SELECT)
      .eq('branch_id', activeBranchId).eq('is_active', true).order('name');
    if (!error && data) setProducts(data.map(rowToProduct));
    setLoading(false);
  }, [activeBranchId]);

  useEffect(() => { load(); }, [load]);

  // El stock lo baja un trigger en la base cada vez que alguien vende, desde
  // cualquier dispositivo. Sin esto, la tablet de al lado seguía anunciando
  // existencias que ya no estaban.
  useRealtimeReload('products', load);

  const addProduct = async (productData: Omit<Product, 'id'>): Promise<Product> => {
    if (!activeBranchId) throw new Error('No hay sucursal activa');
    const row = productToRow({ ...productData, branchId: activeBranchId });
    const { data, error } = await supabase.from('products').insert(row).select().single();
    if (error) throw error;
    // `.single()` ya falla si no vuelve la fila, así que `data` siempre existe.
    const created = rowToProduct(data);
    setProducts((prev) => [...prev, created]);
    return created;
  };

  const updateProduct = async (updated: Product) => {
    const { error } = await supabase.from('products').update(productToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  // Se intenta borrar de verdad, que es lo que se quiere con un artículo creado
  // por error. Si ya tiene historial (ventas, cotizaciones, servicios o facturas
  // de proveedor), la base lo rechaza con un 23503 y entonces se archiva: sale
  // del POS y del inventario, pero el historial y los reportes por artículo
  // siguen cuadrando. No se comprueba antes a propósito: entre la comprobación y
  // el borrado podría colarse una venta.
  const deleteProduct = async (id: string): Promise<'eliminado' | 'archivado'> => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (!error) {
      setProducts((prev) => prev.filter((p) => p.id !== id));
      return 'eliminado';
    }
    if (error.code !== '23503') throw error;

    const { error: eArchivar } = await supabase
      .from('products').update({ is_active: false }).eq('id', id);
    if (eArchivar) throw eArchivar;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    return 'archivado';
  };

  const loadArchived = useCallback(async () => {
    if (!activeBranchId) { setArchivedProducts([]); return; }
    const { data } = await supabase.from('products').select(PRODUCT_SELECT)
      .eq('branch_id', activeBranchId).eq('is_active', false)
      .order('archived_at', { ascending: false });
    setArchivedProducts((data ?? []).map((row: any) => ({
      ...rowToProduct(row), archivedAt: row.archived_at ?? null,
    })));
  }, [activeBranchId]);

  const restoreProduct = async (id: string) => {
    // archived_at y restored_at las escribe un trigger, así que aquí solo se
    // cambia el estado.
    const { error } = await supabase.from('products').update({ is_active: true }).eq('id', id);
    if (error) throw error;
    setArchivedProducts((prev) => prev.filter((p) => p.id !== id));
    await load();
  };

  // Importación por lote: inserta los nuevos en tandas y actualiza los emparejados
  // por código uno a uno. company_id lo pone la base (default current_company_id()).
  // Las presentaciones del CSV se escriben al final, todas juntas, con una sola
  // llamada a `import_product_presentations`: necesita el id de cada producto, por eso
  // los nuevos se insertan pidiendo `id, code, name` de vuelta. Si esa llamada falla,
  // la base deshace todas las presentaciones del lote (los productos ya están creados)
  // y el error sale en `failed` con el nombre "Presentaciones".
  const bulkImportProducts = async (
    items: BulkImportItem[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<BulkImportResult> => {
    const result: BulkImportResult = { created: 0, updated: 0, failed: [] };
    if (!activeBranchId) {
      result.failed.push({ name: 'Error general', error: 'No hay sucursal activa' });
      return result;
    }
    const total = items.length;
    let done = 0;

    const toCreate = items.filter((i) => !i.existingId);
    const toUpdate = items.filter((i) => i.existingId);

    // Una fila por producto que trae presentaciones o que dice si se vende suelto.
    const presentationRows: ImportPresentationRow[] = [];
    const queuePresentations = (item: BulkImportItem, productId: string) => {
      if (wantsPresentations(item)) presentationRows.push(toImportPresentationRow(item, productId));
    };

    const BATCH = 200;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const batch = toCreate.slice(i, i + BATCH);
      const { data: createdRows, error } = await supabase.from('products')
        .insert(batch.map((b) => productToRow({ ...b.data, branchId: activeBranchId })))
        .select('id, code, name');
      if (error) {
        // Si el lote falla, insertar fila a fila para reportar cuáles fallaron.
        for (const b of batch) {
          const { data: one, error: e2 } = await supabase.from('products')
            .insert(productToRow({ ...b.data, branchId: activeBranchId }))
            .select('id, code, name').single();
          if (e2) {
            result.failed.push({ name: b.data.name, error: e2.message });
          } else {
            result.created += 1;
            queuePresentations(b, one.id);
          }
        }
      } else {
        result.created += batch.length;
        const ids = matchCreatedProducts(batch, createdRows ?? []);
        batch.forEach((b, idx) => {
          const id = ids[idx];
          if (id) queuePresentations(b, id);
          else if (wantsPresentations(b)) {
            result.failed.push({
              name: b.data.name,
              error: 'Se creó, pero no se encontró para guardarle las presentaciones.',
            });
          }
        });
      }
      done += batch.length;
      onProgress?.(done, total);
    }

    for (const b of toUpdate) {
      const { error } = await supabase.from('products').update(productToRow(b.data)).eq('id', b.existingId!);
      if (error) {
        result.failed.push({ name: b.data.name, error: error.message });
      } else {
        result.updated += 1;
        queuePresentations(b, b.existingId!);
      }
      done += 1;
      onProgress?.(done, total);
    }

    if (presentationRows.length > 0) {
      const { error } = await supabase.rpc('import_product_presentations', { p_rows: presentationRows });
      if (error) result.failed.push({ name: 'Presentaciones', error: error.message });
    }

    await load();
    return result;
  };

  const savePresentations = async (
    productId: string,
    soldLoose: boolean,
    drafts: PresentationDraft[],
  ): Promise<ProductPresentation[]> => {
    // Los borradores llegan validados, pero un '' convertido con Number() daría 0 y
    // se guardaría como si fuera un dato.
    if (drafts.some((d) => d.units === '' || d.price === '')) {
      throw new Error('Cada presentación necesita cuántas unidades trae y su precio.');
    }
    const items = drafts.map((d) => {
      const code = d.code.trim();
      return {
        // Sin id = presentación nueva. Un id vacío no puede llegar: la columna es uuid.
        ...(d.id ? { id: d.id } : {}),
        name: d.name.trim(),
        units: Number(d.units),
        price: Number(d.price),
        // Sin `code` la presentación queda sin código.
        ...(code !== '' ? { code } : {}),
      };
    });
    const { data, error } = await supabase.rpc('save_product_presentations', {
      p_product_id: productId,
      p_sold_loose: soldLoose,
      p_items: items,
    });
    if (error) throw error;
    const saved: ProductPresentation[] = ((data ?? []) as any[]).map(rowToPresentation);
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, soldLoose, presentations: saved } : p)));
    return saved;
  };

  const updateStock = async (productId: string, quantitySold: number) => {
    const current = products.find((p) => p.id === productId);
    const newStock = (current?.stock ?? 0) - quantitySold;
    const { error } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, stock: newStock } : p)));
  };

  return (
    <ProductContext.Provider value={{ products, updateStock, addProduct, updateProduct, deleteProduct, bulkImportProducts, savePresentations, archivedProducts, loadArchived, restoreProduct, reload: load, loading }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProducts = (): ProductContextType => {
  const context = useContext(ProductContext);
  if (context === undefined) throw new Error('useProducts must be used within a ProductProvider');
  return context;
};
