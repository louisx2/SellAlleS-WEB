'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Trash, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { comprimirDocumento } from '@/lib/image-optim';
import type { ServicePhoto } from '@/lib/types';

const BUCKET = 'taller';
const MAX_FOTOS = 12;

/** Comprime y sube una foto del equipo: taller/<empresa>/<caso>/<uuid>.<ext>. */
export async function subirFotoDelCaso(companyId: string, serviceId: string, file: File): Promise<void> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error('Solo fotos.');
  }
  let blob: Blob = file;
  let ext = 'jpg';
  let mime = file.type || 'image/jpeg';
  try {
    const c = await comprimirDocumento(file, 1600, 0.8);
    blob = c.blob; ext = c.ext; mime = c.mime;
  } catch {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      throw new Error('No se pudo leer esa foto. Prueba con otra.');
    }
  }
  const path = `${companyId}/${serviceId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  const { error: rowError } = await supabase.from('service_photos').insert({ service_id: serviceId, path });
  if (rowError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(rowError.message);
  }
}

/** Fotos del equipo en la pantalla del caso. */
export function FotosDelCaso({ serviceId, companyId, canEdit }: { serviceId: string; companyId?: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [fotos, setFotos] = useState<ServicePhoto[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [grande, setGrande] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('service_photos').select('id, path, created_at').eq('service_id', serviceId).order('created_at');
    const rows = (data ?? []).map((r: any) => ({ id: r.id, path: r.path, createdAt: new Date(r.created_at) }));
    if (rows.length === 0) { setFotos([]); return; }
    const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
    const porRuta = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
    setFotos(rows.map((r) => ({ ...r, url: porRuta.get(r.path) ?? undefined })));
  }, [serviceId]);

  useEffect(() => { load(); }, [load]);

  const subir = async (files: FileList | null) => {
    if (!files?.length || !companyId) return;
    const lista = Array.from(files).slice(0, Math.max(0, MAX_FOTOS - fotos.length));
    if (lista.length === 0) { toast({ title: `Máximo ${MAX_FOTOS} fotos por orden`, variant: 'destructive' }); return; }
    setSubiendo(true);
    for (const f of lista) {
      try { await subirFotoDelCaso(companyId, serviceId, f); }
      catch (e) { toast({ title: 'Una foto no se subió', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    }
    setSubiendo(false);
    if (inputRef.current) inputRef.current.value = '';
    load();
  };

  const borrar = async (foto: ServicePhoto) => {
    if (!confirm('¿Borrar esta foto?')) return;
    const { error } = await supabase.from('service_photos').delete().eq('id', foto.id);
    if (error) { toast({ title: 'No se pudo borrar', description: error.message, variant: 'destructive' }); return; }
    await supabase.storage.from(BUCKET).remove([foto.path]);
    load();
  };

  return (
    <div className="space-y-3">
      {fotos.length === 0 && <p className="text-sm text-muted-foreground">Sin fotos. Sirven para dejar constancia de cómo llegó.</p>}
      {fotos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {fotos.map((f) => (
            <div key={f.id} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
              {f.url && (
                <button type="button" className="h-full w-full" onClick={() => setGrande(f.url!)} aria-label="Ver foto">
                  <img src={f.url} alt="Foto de la orden" className="h-full w-full object-cover" />
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => borrar(f)}
                  className="absolute right-1 top-1 rounded bg-background/80 p-1 text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label="Borrar foto"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && companyId && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => subir(e.target.files)}
          />
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={subiendo}>
            {subiendo ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Camera className="mr-1 h-4 w-4" />}
            {subiendo ? 'Subiendo…' : 'Agregar fotos'}
          </Button>
        </>
      )}
      {grande && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setGrande(null)}
          aria-label="Cerrar foto"
        >
          <img src={grande} alt="Foto de la orden" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </div>
  );
}
