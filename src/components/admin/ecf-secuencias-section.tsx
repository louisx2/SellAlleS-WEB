'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import {
  SECUENCIA_E_MAXIMA, TESTECF_SECUENCIA_MAXIMA, TESTECF_VENCIMIENTO, TIPO_PREFIX_E, fechaDMA, formatearNcf,
  secuenciaExigeVencimiento, type AmbienteEcf, type TipoSecuencia,
} from '@/lib/ecf';
import {
  TIPO_LABEL_E, estadoDeSecuencia, etiquetaDeSecuencia, umbralPorAgotarse, type NcfSequenceRow,
} from '@/lib/ncf-secuencias';
import { cn } from '@/lib/utils';
import { Loader2, Plus } from 'lucide-react';

// Los que más se usan primero: consumo, crédito fiscal y nota de crédito.
const TIPOS_E: TipoSecuencia[] = [
  'consumer', 'fiscal', 'nota_credito', 'gubernamental', 'regimen_especial', 'nota_debito',
];

interface EcfSecuenciasSectionProps {
  companyId: string;
  /** El ambiente guardado de la empresa; null si aún no tiene configuración. */
  ambiente: AmbienteEcf | null;
  /** Solo las secuencias electrónicas de la empresa. */
  secuencias: NcfSequenceRow[];
  /** AAAA-MM-DD, el mismo "hoy" con que el panel decide si hay E32 vigente. */
  hoy: string;
  /** Algo cambió: que el panel vuelva a leer las secuencias. */
  onCambio: () => void | Promise<void>;
}

// Secuencias e-NCF de UNA empresa, en el panel del super admin. Es el único
// lugar donde se cargan las E: en el perfil de la empresa solo se ven. Se
// escriben con el company_id explícito porque el super admin está fuera de la
// empresa (la columna toma current_company_id() por defecto).
export function EcfSecuenciasSection({ companyId, ambiente, secuencias, hoy, onCambio }: EcfSecuenciasSectionProps) {
  const { toast } = useToast();
  const enPruebas = ambiente === 'TesteCF';
  // En Pruebas el vencimiento es siempre el mismo: se deja puesto.
  const venceInicial = enPruebas ? TESTECF_VENCIMIENTO : '';
  const [tipo, setTipo] = useState<TipoSecuencia>('consumer');
  const [desde, setDesde] = useState('1');
  const [hasta, setHasta] = useState('');
  const [vence, setVence] = useState(venceInicial);
  const [guardando, setGuardando] = useState(false);
  const [cambiandoId, setCambiandoId] = useState<string | null>(null);

  const prefijo = TIPO_PREFIX_E[tipo];
  // E31, E33, E44 y E45 llevan el vencimiento en el comprobante: la base no las acepta sin él.
  const vencimientoObligatorio = secuenciaExigeVencimiento(true, tipo);

  const agregar = async () => {
    const from = Number(desde);
    const to = Number(hasta);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      toast({
        title: 'Rango inválido',
        description: 'Revisa el rango: "hasta" debe ser mayor o igual que "desde".',
        variant: 'destructive',
      });
      return;
    }
    if (to > SECUENCIA_E_MAXIMA) {
      toast({
        title: 'Rango inválido',
        description: 'Un e-NCF lleva 10 dígitos de secuencia: "hasta" no puede pasar de 9999999999.',
        variant: 'destructive',
      });
      return;
    }
    if (enPruebas && to > TESTECF_SECUENCIA_MAXIMA) {
      toast({
        title: 'Rango inválido',
        description: `En Pruebas (TesteCF) MSeller solo acepta números del 1 al ${TESTECF_SECUENCIA_MAXIMA.toLocaleString('es-DO')}.`,
        variant: 'destructive',
      });
      return;
    }
    if (vencimientoObligatorio && !vence) {
      toast({
        title: 'Falta el vencimiento',
        description: `La secuencia ${prefijo} lleva la fecha de vencimiento que autorizó la DGII.`,
        variant: 'destructive',
      });
      return;
    }
    setGuardando(true);
    const { error } = await supabase.from('ncf_sequences').insert({
      company_id: companyId,
      tipo,
      prefix: prefijo,
      electronica: true,
      range_from: from,
      range_to: to,
      current_val: from,
      expires_at: vence || null,
    });
    setGuardando(false);
    if (error) {
      toast({ title: 'No se pudo agregar la secuencia', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Secuencia agregada',
      description: `${TIPO_LABEL_E[tipo]}: ${formatearNcf(prefijo, from, true)} — ${formatearNcf(prefijo, to, true)}`,
    });
    setDesde('1');
    setHasta('');
    setVence(venceInicial);
    await onCambio();
  };

  const alternar = async (seq: NcfSequenceRow) => {
    setCambiandoId(seq.id);
    const { error } = await supabase.from('ncf_sequences').update({ active: !seq.active }).eq('id', seq.id);
    setCambiandoId(null);
    if (error) {
      toast({ title: 'No se pudo actualizar', description: error.message, variant: 'destructive' });
      return;
    }
    await onCambio();
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Secuencias e-NCF</h3>
      <p className="text-xs text-muted-foreground">
        {enPruebas
          ? `En Pruebas (TesteCF) la DGII no autoriza secuencias: MSeller acepta cualquier número sin usar del 1 al ${TESTECF_SECUENCIA_MAXIMA.toLocaleString('es-DO')} de cada tipo, con vencimiento ${fechaDMA(TESTECF_VENCIMIENTO)}.`
          : 'Los rangos que la DGII le autorizó a este RNC en la Oficina Virtual.'}
        {' '}La empresa los ve en su perfil, pero solo se cargan aquí.
      </p>

      {secuencias.length === 0 ? (
        <p className="rounded-lg border p-4 text-center text-sm text-muted-foreground">
          Esta empresa no tiene secuencias E. Para activar hace falta al menos una E32 vigente.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Rango</TableHead>
                <TableHead>Próximo</TableHead>
                <TableHead>Disponibles</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secuencias.map((seq) => {
                const estado = estadoDeSecuencia(seq, hoy);
                const agotada = estado.label === 'Agotada';
                const porAgotarse = estado.usable && estado.disponibles <= umbralPorAgotarse(seq);
                return (
                  <TableRow key={seq.id}>
                    <TableCell className="font-medium">{etiquetaDeSecuencia(seq)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {formatearNcf(seq.prefix, seq.range_from, true)} — {formatearNcf(seq.prefix, seq.range_to, true)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {agotada ? '—' : formatearNcf(seq.prefix, seq.current_val, true)}
                    </TableCell>
                    <TableCell className={cn('text-xs tabular-nums', porAgotarse && 'font-semibold text-destructive')}>
                      {estado.disponibles}
                    </TableCell>
                    <TableCell className={cn('whitespace-nowrap text-xs', estado.label === 'Vencida' && 'font-semibold text-destructive')}>
                      {seq.expires_at ? fechaDMA(seq.expires_at) : 'Sin vencimiento'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={estado.variant}>{estado.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!agotada && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={cambiandoId !== null}
                          onClick={() => alternar(seq)}
                        >
                          {cambiandoId === seq.id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                          {seq.active ? 'Desactivar' : 'Activar'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="space-y-3 rounded-lg bg-muted/40 p-3">
        <p className="text-xs font-medium">Agregar secuencia E</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Tipo de comprobante</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoSecuencia)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_E.map((t) => (
                  <SelectItem key={t} value={t}>{TIPO_LABEL_E[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ecf-seq-desde" className="text-xs">Desde</Label>
            <Input id="ecf-seq-desde" type="number" min={1} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ecf-seq-hasta" className="text-xs">Hasta</Label>
            <Input
              id="ecf-seq-hasta"
              type="number"
              min={1}
              placeholder="Ej: 1000"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="ecf-seq-vence" className="text-xs">
              {vencimientoObligatorio ? 'Vencimiento' : 'Vencimiento (opcional)'}
            </Label>
            <Input
              id="ecf-seq-vence"
              type="date"
              value={vence}
              onChange={(e) => setVence(e.target.value)}
              required={vencimientoObligatorio}
              aria-required={vencimientoObligatorio}
            />
          </div>
          <Button type="button" onClick={agregar} disabled={guardando || !hasta}>
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Agregar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {!vencimientoObligatorio
            ? `El ${prefijo} no lleva el vencimiento en el comprobante. Si pones una fecha, la secuencia deja de usarse ese día.`
            : enPruebas
              ? `En Pruebas la fecha tiene que ser ${fechaDMA(TESTECF_VENCIMIENTO)}: el ${prefijo} la lleva en el comprobante y, con otra, la DGII lo rechaza ("fecha de vencimiento de secuencia inválida").`
              : `La fecha tiene que ser la misma que sale en la autorización de la DGII: el ${prefijo} la lleva en el comprobante y, si no coincide, la DGII lo rechaza ("fecha de vencimiento de secuencia inválida").`}
        </p>
      </div>
    </section>
  );
}
