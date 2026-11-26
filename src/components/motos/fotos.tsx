'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, Trash } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { comprimirDocumento } from '@/lib/image-optim';
import type { MotosPhoto } from '@/lib/types';

const BUCKET = 'motos';

type Dueno = { tipo: 'vehiculo' | 'cliente'; id: string };

// Dónde vive cada foto: tabla, columna, carpeta del bucket y cuántas caben.
const DESTINO = {
  vehiculo: { tabla: 'vehicle_photos', columna: 'vehicle_id', carpeta: 'vehiculos', max: 12, vacio: 'Sin fotos. Sirven para dejar constancia de cómo está la moto.' },
  cliente: { tabla: 'customer_photos', columna: 'customer_id', carpeta: 'clientes', max: 4, vacio: 'Sin fotos de la cédula.' },
} as const;

/** Comprime y sube una foto: motos/<empresa>/<vehiculos|clientes>/<id>/<uuid>.<ext>. */
async function subirFoto(companyId: string, dueno: Dueno, file: File): Promise<void> {
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
  const d = DESTINO[dueno.tipo];
  const path = `${companyId}/${d.carpeta}/${dueno.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  const { error: rowError } = await supabase.from(d.tabla).insert({ [d.columna]: dueno.id, path });
  if (rowError) {
    // Sin su fila la foto quedaría huérfana en el bucket.
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(rowError.message);
  }
}

/** Fotos de una moto (hasta 12) o de la cédula de un cliente (hasta 4). */
export function FotosMotos({ owner, canEdit }: { owner: Dueno; canEdit: boolean }) {
  const { toast } = useToast();
  const { appUser } = useAuth();
  const companyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const d = DESTINO[owner.tipo];
  const [fotos, setFotos] = useState<MotosPhoto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [grande, setGrande] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase.from(d.tabla).select('id, path, created_at').eq(d.columna, owner.id).order('created_at');
    if (error) { setErrorCarga(error.message); setCargando(false); return; }
    setErrorCarga(null);
    const rows = (data ?? []).map((r: any) => ({ id: r.id, path: r.path, createdAt: new Date(r.created_at) }));
    if (rows.length === 0) { setFotos([]); setCargando(false); return; }
    const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
    const porRuta = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
    setFotos(rows.map((r) => ({ ...r, url: porRuta.get(r.path) ?? undefined })));
    setCargando(false);
  }, [d.tabla, d.columna, owner.id]);

  useEffect(() => { load(); }, [load]);

  const subir = async (files: FileList | null) => {
    if (!files?.length || !companyId) return;
    const lista = Array.from(files).slice(0, Math.max(0, d.max - fotos.length));
    if (lista.length === 0) { toast({ title: `Máximo ${d.max} fotos`, variant: 'destructive' }); return; }
    setSubiendo(true);
    for (const f of lista) {
      try { await subirFoto(companyId, owner, f); }
      catch (e) { toast({ title: 'Una foto no se subió', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    }
    setSubiendo(false);
    if (inputRef.current) inputRef.current.value = '';
    load();
  };

  const borrar = async (foto: MotosPhoto) => {
    if (!confirm('¿Borrar esta foto?')) return;
    const { error } = await supabase.from(d.tabla).delete().eq('id', foto.id);
    if (error) { toast({ title: 'No se pudo borrar', description: error.message, variant: 'destructive' }); return; }
    await supabase.storage.from(BUCKET).remove([foto.path]);
    load();
  };

  return (
    <div className="space-y-3">
      {errorCarga && <p className="text-sm text-destructive">No se pudieron cargar las fotos: {errorCarga}</p>}
      {!errorCarga && cargando && fotos.length === 0 && <p className="text-sm text-muted-foreground">Cargando fotos…</p>}
      {!errorCarga && !cargando && fotos.length === 0 && <p className="text-sm text-muted-foreground">{d.vacio}</p>}
      {fotos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {fotos.map((f) => (
            <div key={f.id} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
              {f.url && (
                <button type="button" className="h-full w-full" onClick={() => setGrande(f.url!)} aria-label="Ver foto">
                  <img src={f.url} alt="Foto" className="h-full w-full object-cover" />
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
      {canEdit && companyId && fotos.length < d.max && (
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
          <img src={grande} alt="Foto" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </div>
  );
}
