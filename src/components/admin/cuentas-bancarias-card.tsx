'use client';

// Cuentas de SellAlleS donde las empresas transfieren la suscripción. Salen en
// Mi Suscripción, en el diálogo de reportar pago y en los recordatorios por
// correo. Cada cambio se guarda al momento (no espera al "Guardar cambios" de
// la página): son filas propias, no columnas de platform_settings.

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Landmark, Loader2, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  BANCOS_RD, TIPO_DE_CUENTA, cargarCuentasBancarias, type CuentaBancaria,
} from '@/lib/payment-reports';

type Borrador = Omit<CuentaBancaria, 'id' | 'sortOrder'> & { id?: string };

const VACIA: Borrador = {
  bank: '', accountType: 'ahorro', accountNumber: '', holderName: '', holderId: '', currency: 'DOP', isActive: true,
};

export function CuentasBancariasCard() {
  const { toast } = useToast();
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState<CuentaBancaria | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCuentas(await cargarCuentasBancarias(false));
    } catch (err: any) {
      toast({ title: 'No se pudieron cargar las cuentas', description: err?.message, variant: 'destructive' });
    } finally {
      setCargando(false);
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    if (!editando) return;
    const fila = {
      bank: editando.bank.trim(),
      account_type: editando.accountType,
      account_number: editando.accountNumber.trim(),
      holder_name: editando.holderName.trim(),
      holder_id: editando.holderId?.trim() || null,
      currency: editando.currency,
      is_active: editando.isActive,
      updated_at: new Date().toISOString(),
    };
    if (!fila.bank || !fila.account_number || !fila.holder_name) {
      toast({ title: 'Faltan datos', description: 'Banco, número de cuenta y titular son obligatorios.', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    const { error } = editando.id
      ? await supabase.from('platform_bank_accounts').update(fila).eq('id', editando.id)
      : await supabase.from('platform_bank_accounts').insert({
          ...fila,
          sort_order: cuentas.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1,
        });
    setGuardando(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    setEditando(null);
    cargar();
  };

  const cambiarActiva = async (c: CuentaBancaria, activa: boolean) => {
    setCuentas((cs) => cs.map((x) => (x.id === c.id ? { ...x, isActive: activa } : x)));
    const { error } = await supabase.from('platform_bank_accounts').update({ is_active: activa, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (error) {
      toast({ title: 'No se pudo cambiar', description: error.message, variant: 'destructive' });
      cargar();
    }
  };

  const mover = async (i: number, dir: -1 | 1) => {
    const a = cuentas[i];
    const b = cuentas[i + dir];
    if (!a || !b) return;
    // Se reescriben los dos órdenes con su posición en la lista: si venían
    // repetidos (dos en 0), intercambiarlos no movería nada.
    const nuevos = [...cuentas];
    nuevos[i] = b; nuevos[i + dir] = a;
    setCuentas(nuevos.map((c, k) => ({ ...c, sortOrder: k })));
    const [r1, r2] = await Promise.all([
      supabase.from('platform_bank_accounts').update({ sort_order: i + dir }).eq('id', a.id),
      supabase.from('platform_bank_accounts').update({ sort_order: i }).eq('id', b.id),
    ]);
    if (r1.error || r2.error) {
      toast({ title: 'No se pudo reordenar', description: (r1.error ?? r2.error)?.message, variant: 'destructive' });
      cargar();
    }
  };

  const confirmarBorrado = async () => {
    if (!borrar) return;
    const { error } = await supabase.from('platform_bank_accounts').delete().eq('id', borrar.id);
    if (error) {
      toast({ title: 'No se pudo eliminar', description: error.message, variant: 'destructive' });
      return;
    }
    setBorrar(null);
    cargar();
  };

  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setEditando((e) => (e ? { ...e, [k]: v } : e));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5 text-primary" />
            Cuentas para cobrar
          </CardTitle>
          <CardDescription>
            Donde las empresas te transfieren. Las ven sus administradores en Mi Suscripción y en los recordatorios
            por correo. Se guardan al momento.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditando({ ...VACIA })}>
          <PlusCircle className="mr-1.5 h-4 w-4" /> Agregar
        </Button>
      </CardHeader>
      <CardContent>
        {cargando ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : cuentas.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Sin cuentas. Agrega la de Banreservas y la del Popular para que las empresas sepan dónde pagar.
          </p>
        ) : (
          <ul className="space-y-2">
            {cuentas.map((c, i) => (
              <li key={c.id} className={cn('flex flex-wrap items-center gap-3 rounded-lg border p-3', !c.isActive && 'opacity-60')}>
                <div className="flex flex-col">
                  <Button size="icon" variant="ghost" className="h-5 w-5" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-5 w-5" disabled={i === cuentas.length - 1} onClick={() => mover(i, 1)} aria-label="Bajar">
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.bank}</span>
                    {!c.isActive && <Badge variant="secondary">Oculta</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {TIPO_DE_CUENTA[c.accountType]} · <span className="font-mono">{c.accountNumber}</span> · {c.currency}
                  </p>
                  <p className="text-xs text-muted-foreground">{c.holderName}{c.holderId ? ` · ${c.holderId}` : ''}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={c.isActive} onCheckedChange={(v) => cambiarActiva(c, v)} aria-label="Mostrar a las empresas" />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditando({ ...c, holderId: c.holderId ?? '' })} aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setBorrar(c)} aria-label="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!editando} onOpenChange={(o) => { if (!o && !guardando) setEditando(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editando?.id ? 'Editar cuenta' : 'Nueva cuenta'}</DialogTitle>
            <DialogDescription>Los comprobantes ya enviados guardan la cuenta tal como estaba.</DialogDescription>
          </DialogHeader>
          {editando && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cb-banco">Banco *</Label>
                <Input id="cb-banco" list="bancos-rd" value={editando.bank} onChange={(e) => set('bank', e.target.value)} placeholder="Banreservas" />
                <datalist id="bancos-rd">{BANCOS_RD.map((b) => <option key={b} value={b} />)}</datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <Select value={editando.accountType} onValueChange={(v) => set('accountType', v as Borrador['accountType'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ahorro">Ahorro</SelectItem>
                      <SelectItem value="corriente">Corriente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Moneda</Label>
                  <Select value={editando.currency} onValueChange={(v) => set('currency', v as Borrador['currency'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DOP">Pesos (DOP)</SelectItem>
                      <SelectItem value="USD">Dólares (USD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cb-numero">Número de cuenta *</Label>
                <Input id="cb-numero" inputMode="numeric" className="font-mono" value={editando.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cb-titular">A nombre de *</Label>
                <Input id="cb-titular" value={editando.holderName} onChange={(e) => set('holderName', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cb-cedula">Cédula o RNC del titular</Label>
                <Input id="cb-cedula" value={editando.holderId ?? ''} onChange={(e) => set('holderId', e.target.value)} placeholder="Opcional; algunos bancos lo piden" />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="cb-activa" className="font-normal">Mostrarla a las empresas</Label>
                <Switch id="cb-activa" checked={editando.isActive} onCheckedChange={(v) => set('isActive', v)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditando(null)} disabled={guardando}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!borrar} onOpenChange={(o) => { if (!o) setBorrar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la cuenta de {borrar?.bank}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de mostrarse a las empresas. Los comprobantes que ya la mencionan la conservan. Si solo quieres
              ocultarla por un tiempo, apaga el interruptor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarBorrado} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
