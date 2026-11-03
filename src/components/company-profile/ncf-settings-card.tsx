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
import { useModules } from '@/context/modules-provider';
import {
  SECUENCIA_E_MAXIMA, TIPO_PREFIX_E, avisoSerieB, certificadoPorVencer, diasParaVencer, fechaDMA, formatearNcf,
  secuenciaExigeVencimiento,
} from '@/lib/ecf';
import { Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type NcfTipo = 'consumer' | 'fiscal' | 'nota_credito' | 'gubernamental' | 'regimen_especial' | 'nota_debito';

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
  electronica: boolean;
}

// La serie de la secuencia: B (papel, la de siempre) o E (comprobante electrónico).
type Serie = 'B' | 'E';

// Lo que la empresa ve de su ecf_config (solo lectura: la escribe el super admin).
interface EcfConfigRow {
  estado: 'preparacion' | 'activa' | 'suspendida';
  ambiente: 'TesteCF' | 'CerteCF' | 'eCF';
  certificado_vence: string | null;
}

const TIPO_LABEL: Record<NcfTipo, string> = {
  consumer: 'Consumidor Final (B02)',
  fiscal: 'Crédito Fiscal (B01)',
  nota_credito: 'Nota de Crédito (B04)',
  gubernamental: 'Gubernamental (B15)',
  regimen_especial: 'Régimen Especial (B14)',
  nota_debito: 'Nota de Débito (B03)',
};
const TIPO_LABEL_E: Record<NcfTipo, string> = {
  consumer: 'Consumidor Final (E32)',
  fiscal: 'Crédito Fiscal (E31)',
  nota_credito: 'Nota de Crédito (E34)',
  gubernamental: 'Gubernamental (E45)',
  regimen_especial: 'Régimen Especial (E44)',
  nota_debito: 'Nota de Débito (E33)',
};
const TIPO_PREFIX: Record<NcfTipo, string> = {
  consumer: 'B02', fiscal: 'B01', nota_credito: 'B04',
  gubernamental: 'B15', regimen_especial: 'B14', nota_debito: 'B03',
};
// El nombre del tipo según la serie de la secuencia.
const etiquetaDeSecuencia = (seq: NcfSequenceRow): string =>
  (seq.electronica ? TIPO_LABEL_E : TIPO_LABEL)[seq.tipo] ?? seq.tipo;

const ECF_ESTADO: Record<EcfConfigRow['estado'], { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  preparacion: { label: 'En preparación', variant: 'secondary' },
  activa: { label: 'Activa', variant: 'default' },
  suspendida: { label: 'Suspendida', variant: 'destructive' },
};
const ECF_AMBIENTE: Record<EcfConfigRow['ambiente'], string> = {
  TesteCF: 'Pruebas',
  CerteCF: 'Certificación',
  eCF: 'Producción',
};
// Los seis tipos que acepta ncf_sequences_tipo_check. Antes el formulario solo
// ofrecía tres, así que un cliente marcado B15/B14 no tenía secuencia posible y
// su venta moría en assign_ncf.
const TIPOS: NcfTipo[] = [
  'consumer', 'fiscal', 'nota_credito', 'gubernamental', 'regimen_especial', 'nota_debito',
];

// Aviso cuando a una secuencia en uso le quedan pocos números: sin esto el
// aviso llega el día que el POS deja de facturar. El umbral se mide contra el
// tamaño del rango, no en absoluto: 50 sobre un talonario de 500 avisa a
// tiempo, pero sobre uno de 15 estaría encendido desde el primer día.
const UMBRAL_MAXIMO = 50;
const umbralPorAgotarse = (seq: NcfSequenceRow): number => {
  const total = Math.max(seq.range_to - seq.range_from + 1, 1);
  return Math.min(UMBRAL_MAXIMO, Math.max(3, Math.ceil(total * 0.2)));
};

type EstadoSeq = {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  disponibles: number;
  /** La base la tomaría ahora mismo (mismo filtro que assign_ncf). */
  usable: boolean;
};

// Espeja exactamente el filtro de assign_ncf: active, con números y sin vencer.
// Si esto y la función se separan, la tarjeta miente sobre lo que hará el POS.
const estadoDeSecuencia = (seq: NcfSequenceRow, hoy: string): EstadoSeq => {
  const disponibles = Math.max(seq.range_to - seq.current_val + 1, 0);
  if (seq.current_val > seq.range_to) {
    return { label: 'Agotada', variant: 'destructive', disponibles: 0, usable: false };
  }
  if (seq.expires_at && seq.expires_at < hoy) {
    return { label: 'Vencida', variant: 'destructive', disponibles, usable: false };
  }
  if (!seq.active) {
    return { label: 'Inactiva', variant: 'secondary', disponibles, usable: false };
  }
  return { label: 'Activa', variant: 'default', disponibles, usable: true };
};

// Lo que dice la tarjeta del certificado digital; en rojo (ver certificadoPorVencer)
// cuando faltan 30 días o menos.
const textoCertificado = (vence: string | null, hoy: string): string => {
  const dias = diasParaVencer(vence, hoy);
  if (!vence || dias === null) return 'Sin registrar';
  if (dias < 0) return `Venció el ${fechaDMA(vence)}`;
  if (dias === 0) return `Vence hoy (${fechaDMA(vence)})`;
  return certificadoPorVencer(vence, hoy)
    ? `Vence el ${fechaDMA(vence)} (faltan ${dias} día${dias === 1 ? '' : 's'})`
    : `Vence el ${fechaDMA(vence)}`;
};

// Gestión fiscal de la empresa: formalización DGII, emisión de NCF y
// secuencias autorizadas. El número lo asigna la base (trigger set_sale_ncf).
export function NcfSettingsCard() {
  const { toast } = useToast();
  const { isModuleEnabled } = useModules();
  const ecfModulo = isModuleEnabled('ecf');
  const [fiscal, setFiscal] = useState<FiscalState | null>(null);
  const [sequences, setSequences] = useState<NcfSequenceRow[]>([]);
  const [saving, setSaving] = useState(false);
  // undefined: aún no se consulta; null: la empresa no tiene fila en ecf_config.
  const [ecfConfig, setEcfConfig] = useState<EcfConfigRow | null | undefined>(undefined);
  const [ecfConfigFallo, setEcfConfigFallo] = useState(false);
  // Desde la fecha de corte la serie B ya no se puede emitir. Si la consulta
  // falla se deja como si siguiera vigente: la base la rechaza igual.
  const [ncfBVigente, setNcfBVigente] = useState(true);
  const [fechaCorteB, setFechaCorteB] = useState<string | null>(null);

  // Formulario de nueva secuencia
  const [serieElegida, setSerieElegida] = useState<Serie>('E');
  const [tipo, setTipo] = useState<NcfTipo>('consumer');
  const [prefix, setPrefix] = useState(TIPO_PREFIX.consumer);
  const [rangeFrom, setRangeFrom] = useState('1');
  const [rangeTo, setRangeTo] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  // current_date de la base es hora local del servidor; comparamos en el mismo
  // formato AAAA-MM-DD que devuelve la columna date.
  const hoy = new Date().toLocaleDateString('en-CA');

  // Misma regla que ecf_activa: formalizada, con el módulo y la configuración activa.
  const ecfActiva = ecfModulo && !!fiscal?.isFormalized && ecfConfig?.estado === 'activa';
  // Sin el módulo solo hay serie B, y pasada la fecha de corte ni siquiera esa.
  const serie: Serie = !ecfModulo ? 'B' : serieElegida === 'B' && !ncfBVigente ? 'E' : serieElegida;
  const formularioDisponible = ecfModulo || ncfBVigente;
  const mostrarSerie = ecfModulo || sequences.some((s) => s.electronica);
  const prefijoEfectivo = serie === 'E' ? TIPO_PREFIX_E[tipo] : prefix.trim().toUpperCase();
  // E31, E33, E44 y E45 llevan el vencimiento en el comprobante: la base no las acepta sin él.
  const vencimientoObligatorio = secuenciaExigeVencimiento(serie === 'E', tipo);

  // Avisos que hay que ver ANTES de que el POS deje de facturar: secuencias por
  // agotarse, y secuencias encendidas que la base ya no tomaría. Solo cuentan las
  // de la serie con que se factura ahora (assign_ncf: las E con e-CF activo, las
  // B sin él); las de la otra no las toma el POS, así que no avisan.
  const avisos = sequences.filter((seq) => seq.electronica === ecfActiva).flatMap((seq) => {
    const estado = estadoDeSecuencia(seq, hoy);
    const label = etiquetaDeSecuencia(seq);
    if (estado.usable && estado.disponibles <= umbralPorAgotarse(seq)) {
      return [`A ${label} le quedan ${estado.disponibles} comprobante${estado.disponibles === 1 ? '' : 's'}: pide el próximo rango a DGII.`];
    }
    if (seq.active && !estado.usable) {
      return [`${label}: secuencia ${estado.label.toLowerCase()}. Las ventas que pidan este comprobante serán rechazadas.`];
    }
    return [];
  });

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
      .select('id, tipo, prefix, range_from, range_to, current_val, expires_at, active, electronica')
      .order('created_at', { ascending: false });
    if (seqs) setSequences(seqs as NcfSequenceRow[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ¿Sigue vigente la serie B para esta empresa? ncf_b_vigente decide por el día
  // local de la empresa; la fecha de corte solo sirve para decirla en el aviso.
  const companyId = fiscal?.companyId;
  useEffect(() => {
    if (!companyId) return;
    let cancelado = false;
    Promise.all([
      supabase.rpc('ncf_b_vigente', { p_company: companyId }),
      supabase.from('platform_settings').select('ncf_b_fecha_corte').maybeSingle(),
    ]).then(([vigente, ajustes]) => {
      if (cancelado) return;
      setNcfBVigente(vigente.error ? true : vigente.data !== false);
      setFechaCorteB(ajustes.error ? null : (ajustes.data?.ncf_b_fecha_corte as string | null | undefined) ?? null);
    });
    return () => { cancelado = true; };
  }, [companyId]);

  // Estado de la facturación electrónica: solo se consulta con el módulo encendido.
  useEffect(() => {
    if (!ecfModulo || !companyId) {
      setEcfConfig(undefined);
      setEcfConfigFallo(false);
      return;
    }
    let cancelado = false;
    supabase
      .from('ecf_config')
      .select('estado, ambiente, certificado_vence')
      .eq('company_id', companyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        setEcfConfigFallo(!!error);
        setEcfConfig(error ? undefined : (data as EcfConfigRow | null));
      });
    return () => { cancelado = true; };
  }, [ecfModulo, companyId]);

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
    // La base ya no emite B pasada la fecha de corte: no se carga una que no se usaría.
    if (serie === 'B' && !ncfBVigente) return;
    const from = Number(rangeFrom);
    const to = Number(rangeTo);
    if (!prefijoEfectivo || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      toast({
        title: 'Datos inválidos',
        description: 'Revisa el prefijo y el rango: "hasta" debe ser mayor o igual que "desde".',
        variant: 'destructive',
      });
      return;
    }
    if (serie === 'E' && to > SECUENCIA_E_MAXIMA) {
      toast({
        title: 'Rango inválido',
        description: 'Un e-NCF lleva 10 dígitos de secuencia: "hasta" no puede pasar de 9999999999.',
        variant: 'destructive',
      });
      return;
    }
    if (vencimientoObligatorio && !expiresAt) {
      toast({
        title: 'Falta el vencimiento',
        description: `La secuencia ${prefijoEfectivo} lleva la fecha de vencimiento que autorizó la DGII.`,
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('ncf_sequences').insert({
      tipo,
      prefix: prefijoEfectivo,
      electronica: serie === 'E',
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
    const electronica = serie === 'E';
    toast({
      title: 'Secuencia agregada',
      description: `${(electronica ? TIPO_LABEL_E : TIPO_LABEL)[tipo]}: ${formatearNcf(prefijoEfectivo, from, electronica)} — ${formatearNcf(prefijoEfectivo, to, electronica)}`,
    });
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
            {ecfModulo && (
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h4 className="text-sm font-semibold">Facturación electrónica</h4>
                  {ecfConfig === undefined ? (
                    ecfConfigFallo
                      ? <span className="text-xs text-destructive">No se pudo consultar el estado.</span>
                      : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : ecfConfig === null ? (
                    <Badge variant="outline">Sin configurar</Badge>
                  ) : (
                    <Badge variant={ECF_ESTADO[ecfConfig.estado].variant}>{ECF_ESTADO[ecfConfig.estado].label}</Badge>
                  )}
                </div>

                {ecfConfig === null && (
                  <p className="text-xs text-muted-foreground">
                    SellAlleS todavía no ha preparado la facturación electrónica de tu empresa.
                  </p>
                )}

                {ecfConfig && (
                  <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Ambiente</dt>
                      <dd>{ECF_AMBIENTE[ecfConfig.ambiente]} ({ecfConfig.ambiente})</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Certificado digital</dt>
                      <dd className={cn(certificadoPorVencer(ecfConfig.certificado_vence, hoy) && 'font-semibold text-destructive')}>
                        {textoCertificado(ecfConfig.certificado_vence, hoy)}
                      </dd>
                    </div>
                  </dl>
                )}

                <details open={!ecfActiva}>
                  <summary className="cursor-pointer text-sm font-medium">Lo que te toca hacer</summary>
                  <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
                    <li>
                      Certificado digital a nombre del RNC o la cédula: lo emiten la Cámara de Comercio de
                      Santo Domingo, Avansi o Novosit.
                    </li>
                    <li>
                      Postulación en la Oficina Virtual de la DGII, como software externo &quot;MSeller&quot;
                      versión 1.0:
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                        <li>
                          URL de recepción y de aprobación comercial:{' '}
                          <code className="rounded bg-muted px-1 py-0.5 break-all">https://ecf.api.mseller.app/CerteCF</code>
                          {' '}(en producción, <code className="rounded bg-muted px-1 py-0.5 break-all">https://ecf.api.mseller.app/eCF</code>).
                        </li>
                        <li>URL de autenticación: en blanco.</li>
                      </ul>
                    </li>
                    <li>Declaración jurada y solicitud de secuencias E en la Oficina Virtual.</li>
                    <li>Cargar aquí las secuencias E.</li>
                  </ol>
                </details>
              </div>
            )}

            {(fiscal.ncfEnabled || ecfActiva) && avisos.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 space-y-1">
                <p className="text-sm font-semibold text-destructive">Atención a las secuencias</p>
                <ul className="text-xs text-destructive space-y-0.5 list-disc pl-4">
                  {avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}
                </ul>
              </div>
            )}

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
                      {mostrarSerie && <TableHead>Serie</TableHead>}
                      <TableHead>Rango</TableHead>
                      <TableHead>Próximo</TableHead>
                      <TableHead>Disponibles</TableHead>
                      <TableHead>Vence</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sequences.map((seq) => {
                      const estado = estadoDeSecuencia(seq, hoy);
                      const agotada = estado.label === 'Agotada';
                      const porAgotarse = estado.usable && estado.disponibles <= umbralPorAgotarse(seq);
                      return (
                        <TableRow key={seq.id}>
                          <TableCell className="font-medium">{etiquetaDeSecuencia(seq)}</TableCell>
                          {mostrarSerie && (
                            <TableCell>
                              <Badge variant={seq.electronica ? 'default' : 'outline'}>{seq.electronica ? 'E' : 'B'}</Badge>
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-xs">
                            {formatearNcf(seq.prefix, seq.range_from, seq.electronica)} — {formatearNcf(seq.prefix, seq.range_to, seq.electronica)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {agotada ? '—' : formatearNcf(seq.prefix, seq.current_val, seq.electronica)}
                          </TableCell>
                          <TableCell className={cn('text-xs tabular-nums', porAgotarse && 'font-semibold text-destructive')}>
                            {estado.disponibles}
                          </TableCell>
                          <TableCell className={cn('text-xs', estado.label === 'Vencida' && 'font-semibold text-destructive')}>
                            {seq.expires_at ?? 'Sin vencimiento'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={estado.variant}>{estado.label}</Badge>
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
              {!ncfBVigente && (
                // Con e-CF activo no es un problema, solo que la B ya no se carga.
                <p
                  className={cn(
                    'rounded-lg border p-3 text-xs',
                    ecfActiva ? 'text-muted-foreground' : 'border-destructive/50 bg-destructive/5 text-destructive',
                  )}
                >
                  {avisoSerieB(fechaCorteB, ecfActiva)}
                </p>
              )}
              {formularioDisponible && (
                <div className="space-y-4">
                  <div className={cn('grid gap-3', ecfModulo ? 'sm:grid-cols-6' : 'sm:grid-cols-5')}>
                    {ecfModulo && (
                      <div className="space-y-1">
                        <Label className="text-xs">Serie</Label>
                        <Select value={serie} onValueChange={(v: Serie) => setSerieElegida(v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="B" disabled={!ncfBVigente}>B</SelectItem>
                            <SelectItem value="E">E (electrónica)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Tipo de comprobante</Label>
                      <Select value={tipo} onValueChange={(v: NcfTipo) => { setTipo(v); setPrefix(TIPO_PREFIX[v]); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIPOS.map((t) => (
                            <SelectItem key={t} value={t}>{(serie === 'E' ? TIPO_LABEL_E : TIPO_LABEL)[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ncf-prefix" className="text-xs">Prefijo</Label>
                      {/* En la serie E el prefijo lo fija el tipo: la base no acepta otro. */}
                      <Input
                        id="ncf-prefix"
                        value={serie === 'E' ? TIPO_PREFIX_E[tipo] : prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        maxLength={3}
                        disabled={serie === 'E'}
                      />
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
                      <Label htmlFor="ncf-expires" className="text-xs">
                        {vencimientoObligatorio ? 'Vencimiento' : 'Vencimiento (opcional)'}
                      </Label>
                      <Input
                        id="ncf-expires"
                        type="date"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        required={vencimientoObligatorio}
                        aria-required={vencimientoObligatorio}
                      />
                    </div>
                    <Button type="button" onClick={handleAddSequence} disabled={saving || !rangeTo}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Agregar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
