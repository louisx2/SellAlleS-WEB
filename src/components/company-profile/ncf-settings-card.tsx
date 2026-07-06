'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { Loader2, Plus } from 'lucide-react';

type NcfTipo = 'consumer' | 'fiscal';

interface FiscalState {
  companyId: string;
  isFormalized: boolean;
  ncfEnabled: boolean;
}

interface NcfSequenceRow {
  id: string;
  tipo: NcfTipo;
  prefix: string | null;
  range_from: number;
  range_to: number;
  current_val: number;
  expires_at: string | null;
  active: boolean;
}

const TIPO_LABEL: Record<NcfTipo, string> = {
  consumer: 'Consumidor Final (B02)',
  fiscal: 'Crédito Fiscal (B01)',
};
const TIPO_PREFIX: Record<NcfTipo, string> = { consumer: 'B02', fiscal: 'B01' };

// Gestión fiscal de la empresa: formalización DGII, emisión de NCF y
// secuencias autorizadas. El número lo asigna la base (trigger set_sale_ncf).
export function NcfSettingsCard() {
  const { toast } = useToast();
  const [fiscal, setFiscal] = useState<FiscalState | null>(null);
  const [sequences, setSequences] = useState<NcfSequenceRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Formulario de nueva secuencia
  const [tipo, setTipo] = useState<NcfTipo>('consumer');
  const [prefix, setPrefix] = useState(TIPO_PREFIX.consumer);
  const [rangeFrom, setRangeFrom] = useState('1');
  const [rangeTo, setRangeTo] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const load = useCallback(async () => {
    const { data: company } = await supabase
      .from('companies')
      .select('id, is_formalized, ncf_enabled')
      .limit(1)
      .maybeSingle();
    if (company) {
      setFiscal({ companyId: company.id, isFormalized: company.is_formalized, ncfEnabled: company.ncf_enabled });
    }
    const { data: seqs } = await supabase
      .from('ncf_sequences')
      .select('id, tipo, prefix, range_from, range_to, current_val, expires_at, active')
      .order('created_at', { ascending: false });
    if (seqs) setSequences(seqs as NcfSequenceRow[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateCompanyFlag = async (patch: Partial<Pick<FiscalState, 'isFormalized' | 'ncfEnabled'>>) => {
    if (!fiscal) return;
    const row: Record<string, boolean> = {};
    if (patch.isFormalized !== undefined) row.is_formalized = patch.isFormalized;
    if (patch.ncfEnabled !== undefined) row.ncf_enabled = patch.ncfEnabled;

    const { error } = await supabase.from('companies').update(row).eq('id', fiscal.companyId);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    setFiscal({ ...fiscal, ...patch });

    if (patch.ncfEnabled && !sequences.some((s) => s.active)) {
      toast({
        title: 'Falta una secuencia NCF',
        description: 'Activaste la emisión, pero no hay secuencias activas: agrega el rango autorizado por DGII abajo.',
      });
    }
  };

  const handleAddSequence = async () => {
    const from = Number(rangeFrom);
    const to = Number(rangeTo);
    if (!prefix.trim() || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      toast({
        title: 'Datos inválidos',
        description: 'Revisa el prefijo y el rango: "hasta" debe ser mayor o igual que "desde".',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('ncf_sequences').insert({
      tipo,
      prefix: prefix.trim().toUpperCase(),
      range_from: from,
      range_to: to,
      current_val: from,
      expires_at: expiresAt || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo agregar la secuencia', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Secuencia agregada', description: `${TIPO_LABEL[tipo]}: ${prefix}${String(from).padStart(8, '0')} — ${prefix}${String(to).padStart(8, '0')}` });
    setRangeFrom('1');
    setRangeTo('');
    setExpiresAt('');
    load();
  };

  const toggleSequence = async (seq: NcfSequenceRow) => {
    const { error } = await supabase.from('ncf_sequences').update({ active: !seq.active }).eq('id', seq.id);
    if (error) {
      toast({ title: 'No se pudo actualizar', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  if (!fiscal) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Facturación Fiscal (NCF)</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Facturación Fiscal (NCF)</CardTitle>
        <CardDescription>
          Si tu negocio está formalizado en DGII, activa la emisión de comprobantes y registra
          las secuencias autorizadas. Cada venta tomará su NCF automáticamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Formalizada en DGII</p>
              <p className="text-xs text-muted-foreground">Tu negocio tiene RNC y opera formalmente.</p>
            </div>
            <Switch
              checked={fiscal.isFormalized}
              onCheckedChange={(v) => updateCompanyFlag({ isFormalized: v, ...(v ? {} : { ncfEnabled: false }) })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Emitir comprobantes (NCF)</p>
              <p className="text-xs text-muted-foreground">Las ventas nuevas llevarán NCF de tus secuencias.</p>
            </div>
            <Switch
              checked={fiscal.ncfEnabled}
              disabled={!fiscal.isFormalized}
              onCheckedChange={(v) => updateCompanyFlag({ ncfEnabled: v })}
            />
          </div>
        </div>

        {fiscal.isFormalized && (
          <>
            <div>
              <h4 className="text-sm font-semibold mb-2">Secuencias autorizadas</h4>
              {sequences.length === 0 ? (
                <p className="text-sm text-muted-foreground border rounded-lg p-4 text-center">
                  No hay secuencias registradas. Agrega el rango que te autorizó DGII.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Rango</TableHead>
                      <TableHead>Próximo</TableHead>
                      <TableHead>Vence</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sequences.map((seq) => {
                      const agotada = seq.current_val > seq.range_to;
                      return (
                        <TableRow key={seq.id}>
                          <TableCell className="font-medium">{TIPO_LABEL[seq.tipo] ?? seq.tipo}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {seq.prefix}{String(seq.range_from).padStart(8, '0')} — {seq.prefix}{String(seq.range_to).padStart(8, '0')}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {agotada ? '—' : `${seq.prefix}${String(seq.current_val).padStart(8, '0')}`}
                          </TableCell>
                          <TableCell className="text-xs">{seq.expires_at ?? 'Sin vencimiento'}</TableCell>
                          <TableCell>
                            {agotada ? (
                              <Badge variant="destructive">Agotada</Badge>
                            ) : seq.active ? (
                              <Badge>Activa</Badge>
                            ) : (
                              <Badge variant="secondary">Inactiva</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {!agotada && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => toggleSequence(seq)}>
                                {seq.active ? 'Desactivar' : 'Activar'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="text-sm font-semibold">Agregar secuencia</h4>
              <div className="grid sm:grid-cols-5 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Tipo de comprobante</Label>
                  <Select value={tipo} onValueChange={(v: NcfTipo) => { setTipo(v); setPrefix(TIPO_PREFIX[v]); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="consumer">{TIPO_LABEL.consumer}</SelectItem>
                      <SelectItem value="fiscal">{TIPO_LABEL.fiscal}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ncf-prefix" className="text-xs">Prefijo</Label>
                  <Input id="ncf-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={3} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ncf-from" className="text-xs">Desde</Label>
                  <Input id="ncf-from" type="number" min={1} value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ncf-to" className="text-xs">Hasta</Label>
                  <Input id="ncf-to" type="number" min={1} placeholder="Ej: 500" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
                </div>
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <div className="space-y-1">
                  <Label htmlFor="ncf-expires" className="text-xs">Vencimiento (opcional)</Label>
                  <Input id="ncf-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </div>
                <Button type="button" onClick={handleAddSequence} disabled={saving || !rangeTo}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Agregar
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
