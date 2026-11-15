'use client';

import * as React from 'react';
import { Loader2, Percent } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { parsePorcentaje } from '@/lib/comisiones';
import type { Vendedor } from '@/hooks/use-vendedores';

const ROL: Record<string, string> = { admin: 'Administrador', cashier: 'Cajero' };

/**
 * El % de comisión de cada miembro de la empresa (solo admin). Cambiarlo vale
 * para las ventas de aquí en adelante: cada venta guardó el % de su día.
 */
export function PorcentajesComision({
  vendedores,
  loading,
  onGuardado,
}: {
  vendedores: Vendedor[];
  loading: boolean;
  onGuardado: () => void;
}) {
  const { toast } = useToast();
  const [borrador, setBorrador] = React.useState<Record<string, string>>({});
  const [guardando, setGuardando] = React.useState<string | null>(null);

  const valor = (v: Vendedor) => borrador[v.id] ?? String(v.commissionRate ?? 0);
  const cambiado = (v: Vendedor) =>
    borrador[v.id] !== undefined && parsePorcentaje(borrador[v.id]) !== (v.commissionRate ?? 0);

  const guardar = async (v: Vendedor) => {
    const rate = parsePorcentaje(valor(v));
    if (rate === null) {
      toast({ title: 'Porcentaje inválido', description: 'Escribe un número entre 0 y 100.', variant: 'destructive' });
      return;
    }
    setGuardando(v.id);
    const { error } = await supabase.rpc('fijar_comision_vendedor', { p_profile_id: v.id, p_rate: rate });
    setGuardando(null);
    if (error) {
      toast({ title: 'No se guardó', description: error.message, variant: 'destructive' });
      return;
    }
    setBorrador((b) => {
      const { [v.id]: _, ...resto } = b;
      return resto;
    });
    toast({ title: 'Comisión guardada', description: `${v.nombre}: ${rate}% en las ventas desde ahora.` });
    onGuardado();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="h-5 w-5" />
          <span>Porcentaje por vendedor</span>
        </CardTitle>
        <CardDescription>
          Se aplica sobre lo vendido sin ITBIS. Un cambio vale para las ventas nuevas; las ya hechas
          conservan el % que tenían.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="w-[140px] text-right">Comisión (%)</TableHead>
                <TableHead className="w-[110px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-20 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : vendedores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                    No hay usuarios en esta empresa.
                  </TableCell>
                </TableRow>
              ) : (
                vendedores.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="font-medium">{v.nombre}</div>
                      <div className="text-xs text-muted-foreground">{v.email}</div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{ROL[v.rol] ?? v.rol}</span>
                      {!v.activo && <Badge variant="secondary" className="ml-2">Inactivo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        inputMode="decimal"
                        className="ml-auto w-24 text-right"
                        value={valor(v)}
                        onChange={(e) => setBorrador((b) => ({ ...b, [v.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && cambiado(v)) guardar(v); }}
                        aria-label={`Comisión de ${v.nombre}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant={cambiado(v) ? 'default' : 'ghost'} disabled={!cambiado(v) || guardando === v.id}
                        onClick={() => guardar(v)}>
                        {guardando === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
