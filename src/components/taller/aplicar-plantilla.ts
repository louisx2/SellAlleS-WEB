import { supabase } from '@/lib/supabase/client';
import { RUBROS, filasDeAjustes, tiposQueFaltan } from '@/lib/taller';

/** Carga la plantilla de un rubro: crea los tipos de ficha que falten (por nombre) con
 *  sus chequeos (los dos primeros obligatorios, también en «Atender ahora»). Si el
 *  rubro es a domicilio, deja las órdenes nuevas a domicilio en las sucursales DE
 *  ESA EMPRESA. `companyId` es obligatorio: un super admin sin impersonar o alguien
 *  de varias empresas ve sucursales de otras, y sin el filtro se tocarían. */
export async function aplicarPlantilla(
  key: string,
  opts: { companyId: string; existentes: string[] },
): Promise<{ creados: string[]; error?: string }> {
  const rubro = RUBROS.find((r) => r.key === key);
  if (!rubro) return { creados: [], error: 'Rubro desconocido' };
  if (!opts.companyId) return { creados: [], error: 'Falta la empresa' };
  const nuevos = tiposQueFaltan(key, opts.existentes);
  const creados: string[] = [];
  let pos = opts.existentes.length;
  for (const eq of nuevos) {
    const { data, error } = await supabase.from('service_equipment_types').insert({
      company_id: opts.companyId,
      name: eq.name,
      brand_label: eq.brandLabel,
      model_label: eq.modelLabel,
      serial_label: eq.serialLabel,
      asks_password: eq.asksPassword,
      stays_in_shop: eq.staysInShop,
      is_repair: eq.isRepair,
      extra_fields: eq.extraFields ?? [],
      position: pos++,
    }).select('id').single();
    if (error || !data) return { creados, error: error?.message ?? 'No se pudo crear el tipo de ficha' };
    creados.push(eq.name);
    if (eq.checklist.length > 0) {
      const { error: e2 } = await supabase.from('service_checklist_items').insert(
        eq.checklist.map((label, i) => ({
          company_id: opts.companyId,
          equipment_type_id: data.id, label, position: i, required: i < 2, required_quick: i < 2,
        })),
      );
      if (e2) return { creados, error: e2.message };
    }
  }
  if (rubro.aDomicilio) {
    const { data: sucs, error: e3 } = await supabase.from('branches').select('id, company_id').eq('company_id', opts.companyId);
    if (e3) return { creados, error: e3.message };
    // Solo las de esta empresa, cada una con su company_id (filtro también aquí, no solo en la consulta).
    const filas = filasDeAjustes(opts.companyId, sucs ?? []);
    if (filas.length > 0) {
      const { error: e4 } = await supabase.from('taller_settings').upsert(filas, { onConflict: 'branch_id' });
      if (e4) return { creados, error: e4.message };
    }
  }
  return { creados };
}
