// Envíos de mercancía entre sucursales (product_transfer_batches +
// product_transfers). Los escribe solo la RPC transfer_products; aquí se leen.
// Ver supabase/migrations/20260926000000_envios_entre_sucursales.sql.

import { supabase } from '@/lib/supabase/client';

export interface TransferLine {
  id: string;
  productName: string;
  productCode: string | null;
  quantity: number;
  unit: string | null;
  unitCost: number | null;
  /** El artículo no existía en la sucursal que recibió y se creó allá. */
  targetCreated: boolean;
  /** Existía archivado en la que recibió y se reactivó. */
  targetReactivated: boolean;
  /** Quedó en 0 en la que envió y se archivó allá. */
  sourceArchived: boolean;
}

export interface TransferBatch {
  id: string;
  number: number;
  fromBranchId: string;
  toBranchId: string;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  lines: TransferLine[];
}

const SELECT_BATCH = `
  id, number, from_branch_id, to_branch_id, notes, created_by_name, created_at,
  product_transfers(id, product_name, product_code, quantity, unit, unit_cost,
    target_created, target_reactivated, source_archived)
`;

const rowToBatch = (r: any): TransferBatch => ({
  id: r.id,
  number: r.number,
  fromBranchId: r.from_branch_id,
  toBranchId: r.to_branch_id,
  notes: r.notes ?? null,
  createdByName: r.created_by_name ?? null,
  createdAt: r.created_at,
  lines: ((r.product_transfers ?? []) as any[])
    .map((t) => ({
      id: t.id,
      productName: t.product_name,
      productCode: t.product_code ?? null,
      quantity: Number(t.quantity),
      unit: t.unit ?? null,
      unitCost: t.unit_cost != null ? Number(t.unit_cost) : null,
      targetCreated: !!t.target_created,
      targetReactivated: !!t.target_reactivated,
      sourceArchived: !!t.source_archived,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName, 'es')),
});

export async function fetchTransferBatch(id: string): Promise<TransferBatch | null> {
  const { data, error } = await supabase
    .from('product_transfer_batches')
    .select(SELECT_BATCH)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToBatch(data) : null;
}

/** Los envíos más recientes que la RLS deja ver. Con `branchId`, solo los que
 *  salieron de esa sucursal o llegaron a ella. */
export async function fetchTransferBatches(opts: { branchId?: string; limit?: number } = {}): Promise<TransferBatch[]> {
  let query = supabase
    .from('product_transfer_batches')
    .select(SELECT_BATCH)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.branchId) {
    query = query.or(`from_branch_id.eq.${opts.branchId},to_branch_id.eq.${opts.branchId}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToBatch);
}

export interface TransferItemInput {
  productId: string;
  quantity: number;
}

export interface TransferResult {
  batchId: string;
  number: number;
  items: number;
}

/** Todo o nada: si un artículo no se puede mandar, no sale ninguno. */
export async function sendTransfer(input: {
  fromBranchId: string;
  toBranchId: string;
  items: TransferItemInput[];
  targetLocationId: string | null;
  archiveEmpty: boolean;
  notes: string;
}): Promise<TransferResult> {
  const { data, error } = await supabase.rpc('transfer_products', {
    p_from_branch_id: input.fromBranchId,
    p_to_branch_id: input.toBranchId,
    p_items: input.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
    p_target_location_id: input.targetLocationId,
    p_archive_empty: input.archiveEmpty,
    p_notes: input.notes.trim() || null,
  });
  if (error) throw error;
  const r = data as { batch_id: string; number: number; items: number };
  return { batchId: r.batch_id, number: r.number, items: r.items };
}

export interface ExistingElsewhere {
  branchId: string;
  branchName: string;
  productId: string;
  productName: string;
  productCode: string | null;
  stock: number;
  unit: string | null;
  /** Quien pregunta podría transferirlo desde esa sucursal. */
  canTransfer: boolean;
}

/** Mismo código o mismo nombre, con existencias, en otras sucursales de la
 *  empresa. Si la consulta falla devuelve [] a propósito: es un aviso, y no
 *  debe impedir crear el artículo. */
export async function findInOtherBranches(branchId: string, code: string, name: string): Promise<ExistingElsewhere[]> {
  const { data, error } = await supabase.rpc('buscar_en_otras_sucursales', {
    p_branch_id: branchId,
    p_code: code,
    p_name: name,
  });
  if (error) {
    console.warn('No se pudo comprobar otras sucursales:', error.message);
    return [];
  }
  return ((data ?? []) as any[]).map((r) => ({
    branchId: r.branch_id,
    branchName: r.branch_name,
    productId: r.product_id,
    productName: r.product_name,
    productCode: r.product_code ?? null,
    stock: Number(r.stock),
    unit: r.unit ?? null,
    canTransfer: !!r.can_transfer,
  }));
}

/** Enlace que abre, en Inventario, la transferencia de ese artículo ya
 *  armada. La sucursal activa tiene que ser la que lo tiene. */
export const transferLink = (productId: string, toBranchId?: string) =>
  `/inventory?transferir=${encodeURIComponent(productId)}` +
  (toBranchId ? `&destino=${encodeURIComponent(toBranchId)}` : '');
