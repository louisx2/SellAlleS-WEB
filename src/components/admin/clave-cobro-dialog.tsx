'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { Copy, KeyRound, Loader2 } from 'lucide-react';

interface ClaveCobroDialogProps {
  companyId: string | null;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EstadoClave {
  activa: boolean;
  etiqueta: string | null;
  creadaEn: string | null;
  ultimoUso: string | null;
}

const fechaHora = (s: string | null) =>
  s ? new Date(s).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santo_Domingo' }) : '—';

// Panel del super admin: la clave con la que un sistema externo (Anadsll) cobra a ESTA empresa por la
// función cobro-externo. Se ve una sola vez al generarla; la base guarda solo su hash.
export function ClaveCobroDialog({ companyId, companyName, open, onOpenChange }: ClaveCobroDialogProps) {
  const { toast } = useToast();
  const [estado, setEstado] = useState<EstadoClave | null>(null);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [etiqueta, setEtiqueta] = useState('Anadsll');
  const [claveNueva, setClaveNueva] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!companyId) return;
    setCargando(true);
    const { data, error } = await supabase.rpc('estado_clave_cobro_externo', { p_company_id: companyId });
    setCargando(false);
    if (error) {
      toast({ title: 'No se pudo leer la clave', description: error.message, variant: 'destructive' });
      return;
    }
    const f = (data ?? [])[0];
    setEstado(f
      ? { activa: true, etiqueta: f.etiqueta ?? null, creadaEn: f.creada_en ?? null, ultimoUso: f.ultimo_uso ?? null }
      : { activa: false, etiqueta: null, creadaEn: null, ultimoUso: null });
  }, [companyId, toast]);

  useEffect(() => {
    if (open) {
      setClaveNueva(null);
      void cargar();
    }
  }, [open, cargar]);

  const generar = async () => {
    if (!companyId) return;
    setTrabajando(true);
    const { data, error } = await supabase.rpc('generar_clave_cobro_externo', {
      p_company_id: companyId, p_etiqueta: etiqueta,
    });
    setTrabajando(false);
    if (error) {
      toast({ title: 'No se pudo generar la clave', description: error.message, variant: 'destructive' });
      return;
    }
    setClaveNueva(String(data));
    void cargar();
  };

  const revocar = async () => {
    if (!companyId) return;
    setTrabajando(true);
    const { error } = await supabase.rpc('revocar_clave_cobro_externo', { p_company_id: companyId });
    setTrabajando(false);
    if (error) {
      toast({ title: 'No se pudo revocar la clave', description: error.message, variant: 'destructive' });
      return;
    }
    setClaveNueva(null);
    toast({ title: 'Clave revocada', description: 'El sistema que la usaba ya no puede conectarse.' });
    void cargar();
  };

  const copiar = async () => {
    if (!claveNueva) return;
    try {
      await navigator.clipboard.writeText(claveNueva);
      toast({ title: 'Clave copiada' });
    } catch {
      toast({ title: 'No se pudo copiar', description: 'Selecciónala y cópiala a mano.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Clave de conexión</DialogTitle>
          <DialogDescription>
            Con esta clave, otro sistema (por ejemplo Anadsll) ve la cuenta de {companyName}, sube sus comprobantes y
            descarga sus facturas. Se muestra una sola vez.
          </DialogDescription>
        </DialogHeader>

        {cargando ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border p-3 text-sm">
              {estado?.activa ? (
                <>
                  <p className="font-medium">Hay una clave activa{estado.etiqueta ? ` (${estado.etiqueta})` : ''}.</p>
                  <p className="text-muted-foreground">Creada: {fechaHora(estado.creadaEn)} · Último uso: {fechaHora(estado.ultimoUso)}</p>
                </>
              ) : (
                <p className="text-muted-foreground">Esta empresa no tiene una clave activa.</p>
              )}
            </div>

            {claveNueva && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                <p className="text-sm font-medium">Copia la clave ahora: no se vuelve a mostrar.</p>
                <div className="flex gap-2">
                  <Input readOnly value={claveNueva} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" onClick={copiar} aria-label="Copiar la clave">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="clave-etiqueta">Nombre de la conexión</Label>
              <Input id="clave-etiqueta" value={etiqueta} maxLength={60} onChange={(e) => setEtiqueta(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {estado?.activa && (
            <Button type="button" variant="destructive" onClick={revocar} disabled={trabajando}>Revocar</Button>
          )}
          <Button type="button" onClick={generar} disabled={trabajando || cargando}>
            {trabajando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {estado?.activa ? 'Generar otra (revoca la actual)' : 'Generar clave'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
