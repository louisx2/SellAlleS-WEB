'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useGarantes } from '@/hooks/use-garantes';
import type { Customer } from '@/lib/types';

type Campo = { key: string; label: string; placeholder?: string };

const CAMPOS_GARANTE: Campo[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'idDoc', label: 'Cédula' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'relationship', label: 'Parentesco', placeholder: 'Madre, hermano, amigo…' },
  { key: 'address', label: 'Dirección' },
];

const CAMPOS_REFERENCIA: Campo[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'relationship', label: 'Relación', placeholder: 'Vecino, jefe, colmado…' },
];

type Fila = { id: string; name: string } & Record<string, string | undefined>;

interface ListaProps {
  titulo: string;
  vacio: string;
  campos: Campo[];
  filas: Fila[];
  onAgregar: (datos: Record<string, string>) => Promise<void>;
  onEditar: (id: string, datos: Record<string, string>) => Promise<void>;
  onQuitar: (id: string) => Promise<void>;
}

// Una lista con su formulario: el mismo formulario agrega o edita. Quitar pide
// confirmar en la misma fila (sin otro diálogo encima de este).
function Lista({ titulo, vacio, campos, filas, onAgregar, onEditar, onQuitar }: ListaProps) {
  const { toast } = useToast();
  const vacia = () => Object.fromEntries(campos.map((c) => [c.key, ''])) as Record<string, string>;
  const [form, setForm] = useState<Record<string, string>>(vacia);
  const [editando, setEditando] = useState<string | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const guardar = async () => {
    if (!form.name?.trim()) {
      toast({ title: 'Falta el nombre', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editando) await onEditar(editando, form);
      else await onAgregar(form);
      setForm(vacia());
      setEditando(null);
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const quitar = async (id: string) => {
    try {
      await onQuitar(id);
      setQuitando(null);
      if (editando === id) { setEditando(null); setForm(vacia()); }
    } catch (e: any) {
      toast({ title: 'No se pudo quitar', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {filas.length === 0 && <p className="text-sm text-muted-foreground">{vacio}</p>}
      <ul className="space-y-2">
        {filas.map((f) => (
          <li key={f.id} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground">
                {campos.filter((c) => c.key !== 'name' && f[c.key]).map((c) => f[c.key]).join(' · ')}
              </p>
            </div>
            {quitando === f.id ? (
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-xs">¿Quitar?</span>
                <Button size="sm" variant="destructive" onClick={() => quitar(f.id)}>Sí</Button>
                <Button size="sm" variant="outline" onClick={() => setQuitando(null)}>No</Button>
              </div>
            ) : (
              <div className="flex shrink-0 gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Editar ${f.name}`}
                  onClick={() => { setEditando(f.id); setForm(Object.fromEntries(campos.map((c) => [c.key, f[c.key] ?? '']))); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Quitar ${f.name}`}
                  onClick={() => setQuitando(f.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="grid gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
        {campos.map((c) => (
          <div key={c.key} className="grid gap-1">
            <Label className="text-xs">{c.label}{c.key === 'name' && <span className="text-destructive"> *</span>}</Label>
            <Input value={form[c.key] ?? ''} placeholder={c.placeholder}
              onChange={(e) => setForm((x) => ({ ...x, [c.key]: e.target.value }))} />
          </div>
        ))}
        <div className="flex gap-2 sm:col-span-2">
          <Button size="sm" onClick={guardar} disabled={saving}>
            {editando ? 'Guardar cambios' : <><Plus className="mr-1 h-4 w-4" /> Agregar</>}
          </Button>
          {editando && (
            <Button size="sm" variant="outline" onClick={() => { setEditando(null); setForm(vacia()); }}>Cancelar</Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  customer: Customer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Garantes (fiadores) y referencias del cliente. Van por cliente: el contrato
 *  imprime los garantes del cliente. */
export function GarantesDialog({ customer, open, onOpenChange }: Props) {
  const g = useGarantes(open ? customer.id : undefined);
  const [clave, setClave] = useState(0);
  // Formularios limpios cada vez que se abre.
  useEffect(() => { if (open) setClave((k) => k + 1); }, [open]);

  const texto = (d: Record<string, string>) => ({
    name: d.name, idDoc: d.idDoc, phone: d.phone, address: d.address, relationship: d.relationship,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Garantes y referencias</DialogTitle>
          <DialogDescription>{customer.name}</DialogDescription>
        </DialogHeader>
        <div key={clave} className="space-y-5">
          <Lista
            titulo="Garantes o fiadores"
            vacio="Sin garantes."
            campos={CAMPOS_GARANTE}
            filas={g.garantes as unknown as Fila[]}
            onAgregar={(d) => g.addGarante(texto(d))}
            onEditar={(id, d) => g.updateGarante(id, texto(d))}
            onQuitar={g.removeGarante}
          />
          <Separator />
          <Lista
            titulo="Referencias"
            vacio="Sin referencias."
            campos={CAMPOS_REFERENCIA}
            filas={g.referencias as unknown as Fila[]}
            onAgregar={(d) => g.addReferencia({ name: d.name, phone: d.phone, relationship: d.relationship })}
            onEditar={(id, d) => g.updateReferencia(id, { name: d.name, phone: d.phone, relationship: d.relationship })}
            onQuitar={g.removeReferencia}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
