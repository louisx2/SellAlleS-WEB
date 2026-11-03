'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PasswordInput } from '@/components/ui/password-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { administrarEcf } from '@/lib/ecf-client';
import { PLANES_MSELLER, type PlanMseller } from '@/lib/ecf-planes';
import {
  ECF_AMBIENTES, ECF_AMBIENTE_NOMBRE, ECF_ESTADO_CONFIG_NOMBRE,
  certificadoPorVencer, diasParaVencer, fechaDMA,
  type AmbienteEcf, type EstadoEcfConfig,
} from '@/lib/ecf';
import { formatCedulaOrRnc } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface EcfConfigDialogProps {
  companyId: string | null;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Lo que la base guarda en ecf_config y que el formulario no escribe: el estado
// solo cambia con ecf_cambiar_estado (que comprueba que todo esté listo) y la
// marca de conexión solo la pone ecf-admin al probar.
interface ConfigGuardada {
  estado: EstadoEcfConfig;
  ambiente: AmbienteEcf;
  conexion_probada_at: string | null;
  activada_at: string | null;
}

interface CredencialGuardada {
  ambiente: AmbienteEcf;
  email: string;
  updated_at: string;
}

// El formulario guarda todo como texto; se convierte al guardar.
interface FormEcf {
  rnc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  ambiente: AmbienteEcf;
  plan: PlanMseller;
  cupoComprobantes: string;
  cupoRequests: string;
  minutos: string;
  certificadoVence: string;
}

const PLANES = Object.keys(PLANES_MSELLER) as PlanMseller[];

const ESTADOS: { valor: EstadoEcfConfig; boton: string }[] = [
  { valor: 'preparacion', boton: 'Preparación' },
  { valor: 'activa', boton: 'Activa' },
  { valor: 'suspendida', boton: 'Suspendida' },
];

const ESTADO_VARIANT: Record<EstadoEcfConfig, 'default' | 'secondary' | 'destructive'> = {
  preparacion: 'secondary',
  activa: 'default',
  suspendida: 'destructive',
};

const COLUMNAS_CONFIG =
  'estado, ambiente, rnc_emisor, razon_social, nombre_comercial, direccion, plan, cupo_comprobantes, cupo_requests, minutos_entre_consultas, certificado_vence, conexion_probada_at, activada_at';

const numero = (n: number) => n.toLocaleString('es-DO');

const fechaHora = (s: string) =>
  new Date(s).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const etiquetaAmbiente = (a: AmbienteEcf) => `${ECF_AMBIENTE_NOMBRE[a]} (${a})`;

// Los cupos que trae el plan: se copian al formulario al elegirlo.
const cuposDelPlan = (plan: PlanMseller) => ({
  cupoComprobantes: String(PLANES_MSELLER[plan].comprobantes),
  cupoRequests: String(PLANES_MSELLER[plan].requests),
  minutos: String(PLANES_MSELLER[plan].minutos),
});

const FORM_NUEVO: FormEcf = {
  rnc: '',
  razonSocial: '',
  nombreComercial: '',
  direccion: '',
  ambiente: 'TesteCF',
  plan: 'gratis',
  ...cuposDelPlan('gratis'),
  certificadoVence: '',
};

const soloDigitos = (s: string) => s.replace(/\D/g, '');

// Panel del super admin: alta y seguimiento de la facturación electrónica (e-CF)
// de UNA empresa. Todo lo que pasa por aquí es solo de SellAlleS; la empresa
// únicamente ve el estado en su perfil.
export function EcfConfigDialog({ companyId, companyName, open, onOpenChange }: EcfConfigDialogProps) {
  const { appUser } = useAuth();
  // Las funciones de la base comprueban is_super_admin(), que es falso mientras
  // el super admin está dentro de una empresa. Sin este aviso la ventana se vería
  // como una empresa sin configurar y guardar fallaría sin explicación.
  const dentroDeEmpresa = !!appUser?.impersonatedCompanyId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Facturación electrónica — {companyName}</DialogTitle>
          <DialogDescription>
            Alta y seguimiento del e-CF con MSeller. Los cambios de estado comprueban que todo esté listo.
          </DialogDescription>
        </DialogHeader>

        {dentroDeEmpresa ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Estás dentro de una empresa. Sal de ella para administrar la facturación electrónica.
          </p>
        ) : companyId ? (
          // Todo el estado vive en este hijo: al cerrar el diálogo se desmonta,
          // y con él la contraseña y la API key que se hayan escrito.
          <EcfConfigContenido companyId={companyId} />
        ) : null}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EcfConfigContenido({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState<string | null>(null);
  // null: la empresa todavía no tiene fila en ecf_config.
  const [config, setConfig] = useState<ConfigGuardada | null>(null);
  const [formalizada, setFormalizada] = useState(true);
  const [guardadas, setGuardadas] = useState<CredencialGuardada[]>([]);
  const [form, setForm] = useState<FormEcf>(FORM_NUEVO);
  // El formulario como quedó en la base, para saber si hay algo por guardar.
  const [inicial, setInicial] = useState<FormEcf>(FORM_NUEVO);
  // Si el RNC del formulario no vino de la base sino de la empresa o su sucursal, de dónde.
  const [prellenado, setPrellenado] = useState<{ rnc: string; origen: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cambiandoA, setCambiandoA] = useState<EstadoEcfConfig | null>(null);

  // Lo que cambia por fuera del formulario (estado, marca de conexión, credenciales).
  // No toca el formulario: lo que se esté escribiendo no se pierde.
  const recargarEstado = useCallback(async () => {
    const [cfg, cred] = await Promise.all([
      supabase.from('ecf_config').select(COLUMNAS_CONFIG).eq('company_id', companyId).maybeSingle(),
      supabase.rpc('ecf_credenciales_guardadas', { p_company: companyId }),
    ]);
    if (!cfg.error) setConfig(cfg.data as ConfigGuardada | null);
    if (!cred.error) setGuardadas((cred.data ?? []) as CredencialGuardada[]);
  }, [companyId]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [cfg, empresa, sucursales, cred] = await Promise.all([
        supabase.from('ecf_config').select(COLUMNAS_CONFIG).eq('company_id', companyId).maybeSingle(),
        supabase.from('companies').select('rnc, is_formalized').eq('id', companyId).maybeSingle(),
        supabase.from('branches').select('rnc').eq('company_id', companyId).order('created_at', { ascending: true }),
        supabase.rpc('ecf_credenciales_guardadas', { p_company: companyId }),
      ]);
      if (cancelado) return;
      const error = cfg.error ?? empresa.error ?? sucursales.error ?? cred.error;
      if (error) {
        setFallo(error.message);
        setCargando(false);
        return;
      }

      const fila = cfg.data as (ConfigGuardada & {
        rnc_emisor: string | null; razon_social: string; nombre_comercial: string | null; direccion: string;
        plan: PlanMseller; cupo_comprobantes: number; cupo_requests: number; minutos_entre_consultas: number;
        certificado_vence: string | null;
      }) | null;

      // El RNC del emisor: el de la empresa o, si no lo tiene, el de la primera
      // sucursal que lo tenga (así está el de Vilow).
      const rncEmpresa = ((empresa.data?.rnc as string | null) ?? '').trim();
      const rncSucursal = ((sucursales.data ?? []) as { rnc: string | null }[])
        .map((s) => (s.rnc ?? '').trim())
        .find((r) => r !== '') ?? '';

      // Lo que dice la base; sin fila, un formulario vacío.
      const desdeBase: FormEcf = fila
        ? {
            rnc: formatCedulaOrRnc(fila.rnc_emisor ?? ''),
            razonSocial: fila.razon_social,
            nombreComercial: fila.nombre_comercial ?? '',
            direccion: fila.direccion,
            ambiente: fila.ambiente,
            plan: fila.plan,
            cupoComprobantes: String(fila.cupo_comprobantes),
            cupoRequests: String(fila.cupo_requests),
            minutos: String(fila.minutos_entre_consultas),
            certificadoVence: fila.certificado_vence ?? '',
          }
        : FORM_NUEVO;
      const rncPrellenado = desdeBase.rnc
        ? null
        : rncEmpresa
          ? { rnc: formatCedulaOrRnc(rncEmpresa), origen: 'la empresa' }
          : rncSucursal
            ? { rnc: formatCedulaOrRnc(rncSucursal), origen: 'su sucursal' }
            : null;
      setPrellenado(rncPrellenado);

      setConfig(fila ? { estado: fila.estado, ambiente: fila.ambiente, conexion_probada_at: fila.conexion_probada_at, activada_at: fila.activada_at } : null);
      setFormalizada(!!empresa.data?.is_formalized);
      setGuardadas((cred.data ?? []) as CredencialGuardada[]);
      setForm(rncPrellenado ? { ...desdeBase, rnc: rncPrellenado.rnc } : desdeBase);
      setInicial(desdeBase);
      setCargando(false);
    })();
    return () => { cancelado = true; };
  }, [companyId]);

  const cambiar = (patch: Partial<FormEcf>) => setForm((f) => ({ ...f, ...patch }));

  const elegirPlan = (plan: PlanMseller) => cambiar({ plan, ...cuposDelPlan(plan) });

  const hayCambios = (Object.keys(form) as (keyof FormEcf)[]).some((k) => form[k] !== inicial[k]);

  const guardar = async () => {
    const rnc = soloDigitos(form.rnc);
    if (!/^\d{9}(\d{2})?$/.test(rnc)) {
      toast({ title: 'RNC no válido', description: 'Debe tener 9 dígitos (RNC) u 11 (cédula).', variant: 'destructive' });
      return;
    }
    if (!form.razonSocial.trim()) {
      toast({ title: 'Falta la razón social', description: 'Es el nombre con que la empresa figura ante la DGII.', variant: 'destructive' });
      return;
    }
    if (!form.direccion.trim()) {
      toast({ title: 'Falta la dirección', description: 'Aparece en el comprobante como dirección del emisor.', variant: 'destructive' });
      return;
    }
    const cupos = [form.cupoComprobantes, form.cupoRequests, form.minutos].map(Number);
    if (cupos.some((n) => !Number.isInteger(n) || n <= 0)) {
      toast({ title: 'Cupo no válido', description: 'Los cupos y los minutos entre consultas son números enteros mayores que cero.', variant: 'destructive' });
      return;
    }

    setGuardando(true);
    // Sin estado, conexion_probada_at ni activada_at: esos no se escriben desde aquí.
    const { error } = await supabase.from('ecf_config').upsert(
      {
        company_id: companyId,
        rnc_emisor: rnc,
        razon_social: form.razonSocial.trim(),
        nombre_comercial: form.nombreComercial.trim() || null,
        direccion: form.direccion.trim(),
        ambiente: form.ambiente,
        plan: form.plan,
        cupo_comprobantes: cupos[0],
        cupo_requests: cupos[1],
        minutos_entre_consultas: cupos[2],
        certificado_vence: form.certificadoVence || null,
      },
      { onConflict: 'company_id' },
    );
    setGuardando(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    setInicial(form);
    toast({ title: 'Datos guardados' });
    // Cambiar el ambiente borra la marca de conexión probada (la base lo hace).
    await recargarEstado();
  };

  const cambiarEstado = async (estado: EstadoEcfConfig) => {
    setCambiandoA(estado);
    const { error } = await supabase.rpc('ecf_cambiar_estado', { p_company: companyId, p_estado: estado });
    setCambiandoA(null);
    if (error) {
      // La base dice qué falta, en español (formalizada, módulo, datos, conexión, secuencia E32…).
      toast({ title: 'No se pudo cambiar el estado', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `Estado: ${ECF_ESTADO_CONFIG_NOMBRE[estado]}` });
    await recargarEstado();
  };

  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (fallo) {
    return (
      <p className="py-6 text-center text-sm text-destructive">
        No se pudo cargar la configuración: {fallo}
      </p>
    );
  }

  const hoy = new Date().toLocaleDateString('en-CA');
  const dias = diasParaVencer(form.certificadoVence, hoy);
  const cambioDeAmbienteEnActiva = config?.estado === 'activa' && config.ambiente !== form.ambiente;

  return (
    <div className="space-y-4">
      {/* Emisor */}
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Emisor</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ecf-rnc">RNC o cédula</Label>
            <Input
              id="ecf-rnc"
              value={form.rnc}
              onChange={(e) => cambiar({ rnc: formatCedulaOrRnc(e.target.value) })}
              placeholder="000-00000-0"
              inputMode="numeric"
            />
            {prellenado && form.rnc === prellenado.rnc && (
              <p className="text-xs text-muted-foreground">Tomado de {prellenado.origen}: confírmalo.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecf-razon">Razón social</Label>
            <Input id="ecf-razon" value={form.razonSocial} onChange={(e) => cambiar({ razonSocial: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecf-comercial">Nombre comercial (opcional)</Label>
            <Input id="ecf-comercial" value={form.nombreComercial} onChange={(e) => cambiar({ nombreComercial: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecf-direccion">Dirección</Label>
            <Input id="ecf-direccion" value={form.direccion} onChange={(e) => cambiar({ direccion: e.target.value })} />
          </div>
        </div>
      </section>

      {/* Ambiente y plan */}
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Ambiente y plan</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Ambiente</Label>
            <Select value={form.ambiente} onValueChange={(v) => cambiar({ ambiente: v as AmbienteEcf })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ECF_AMBIENTES.map((a) => (
                  <SelectItem key={a} value={a}>{etiquetaAmbiente(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cambioDeAmbienteEnActiva && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                La empresa está activa: al guardar, los comprobantes saldrán por este ambiente y la conexión
                tendrá que probarse de nuevo.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Plan de MSeller</Label>
            <Select value={form.plan} onValueChange={(v) => elegirPlan(v as PlanMseller)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLANES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLANES_MSELLER[p].nombre} — {numero(PLANES_MSELLER[p].comprobantes)} comprobantes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ecf-cupo-comp">Comprobantes al mes</Label>
            <Input id="ecf-cupo-comp" type="number" min={1} value={form.cupoComprobantes} onChange={(e) => cambiar({ cupoComprobantes: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecf-cupo-req">Requests al mes</Label>
            <Input id="ecf-cupo-req" type="number" min={1} value={form.cupoRequests} onChange={(e) => cambiar({ cupoRequests: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecf-minutos">Minutos entre consultas</Label>
            <Input id="ecf-minutos" type="number" min={1} value={form.minutos} onChange={(e) => cambiar({ minutos: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Al elegir el plan se rellenan los tres valores; se pueden ajustar si el acuerdo con MSeller es otro.
          El plan es por RNC emisor: esta empresa tiene su propio cupo.
        </p>
      </section>

      {/* Certificado */}
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Vencimiento del certificado</h3>
        <div className="space-y-1.5 sm:max-w-xs">
          <Label htmlFor="ecf-certificado">Fecha en que vence el certificado digital</Label>
          <Input id="ecf-certificado" type="date" value={form.certificadoVence} onChange={(e) => cambiar({ certificadoVence: e.target.value })} />
          {dias !== null && (
            <p className={cn('text-xs', certificadoPorVencer(form.certificadoVence, hoy) ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              {dias < 0
                ? `Venció el ${fechaDMA(form.certificadoVence)}`
                : dias === 0
                  ? 'Vence hoy'
                  : `Faltan ${dias} día${dias === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {config && hayCambios && <span className="text-xs text-muted-foreground">Hay cambios sin guardar.</span>}
        <Button onClick={guardar} disabled={guardando || (!!config && !hayCambios)}>
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar datos
        </Button>
      </div>

      {/* Credenciales */}
      <CredencialesEcf
        companyId={companyId}
        ambienteInicial={config?.ambiente ?? form.ambiente}
        ambienteEnUso={config?.ambiente ?? null}
        guardadas={guardadas}
        onCambio={recargarEstado}
      />

      {/* Estado */}
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Estado</h3>
          {config && <Badge variant={ESTADO_VARIANT[config.estado]}>{ECF_ESTADO_CONFIG_NOMBRE[config.estado]}</Badge>}
        </div>

        {!config ? (
          <p className="text-xs text-muted-foreground">Guarda los datos del emisor para poder cambiar el estado.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {config.conexion_probada_at
                ? `Conexión probada el ${fechaHora(config.conexion_probada_at)}.`
                : 'La conexión con MSeller todavía no se ha probado.'}
              {config.activada_at && ` Activada por última vez el ${fechaHora(config.activada_at)}.`}
            </p>
            {!formalizada && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                La empresa no está formalizada: no se podrá activar.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {ESTADOS.map(({ valor, boton }) => (
                <Button
                  key={valor}
                  size="sm"
                  variant={config.estado === valor ? 'default' : 'outline'}
                  disabled={config.estado === valor || cambiandoA !== null || hayCambios}
                  onClick={() => cambiarEstado(valor)}
                >
                  {cambiandoA === valor && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  {boton}
                </Button>
              ))}
            </div>
            {hayCambios && (
              <p className="text-xs text-muted-foreground">Guarda los cambios antes de cambiar el estado.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Para activar hace falta: empresa formalizada, módulo encendido, datos del emisor, conexión
              probada, una secuencia E32 vigente y el ambiente de producción (solo la empresa demo puede
              activarse en pruebas).
            </p>
          </>
        )}
      </section>
    </div>
  );
}

interface CredencialesEcfProps {
  companyId: string;
  ambienteInicial: AmbienteEcf;
  /** El ambiente guardado de la empresa; null si aún no tiene fila. */
  ambienteEnUso: AmbienteEcf | null;
  guardadas: CredencialGuardada[];
  /** Algo cambió en la base (credenciales o marca de conexión): que el diálogo lo vuelva a leer. */
  onCambio: () => void | Promise<void>;
}

// La contraseña y la API key viven solo en el estado de este componente: nunca
// se rellenan con lo guardado (el servidor no las devuelve), se borran en cuanto
// se guardan y desaparecen con el diálogo. No se registran en ningún sitio.
function CredencialesEcf({ companyId, ambienteInicial, ambienteEnUso, guardadas, onCambio }: CredencialesEcfProps) {
  const { toast } = useToast();
  const [ambiente, setAmbiente] = useState<AmbienteEcf>(ambienteInicial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [trabajando, setTrabajando] = useState<'guardar' | 'probar' | null>(null);

  const guardada = guardadas.find((g) => g.ambiente === ambiente);

  const limpiar = () => {
    setEmail('');
    setPassword('');
    setApiKey('');
  };

  // Lo escrito es de un ambiente: al cambiarlo se borra, para no guardar las
  // credenciales de pruebas como las de producción.
  const elegirAmbiente = (a: AmbienteEcf) => {
    setAmbiente(a);
    limpiar();
  };

  const guardarCredenciales = async () => {
    if (!email.trim() || !password || !apiKey.trim()) {
      toast({
        title: 'Faltan datos',
        description: 'Escribe el correo, la contraseña y la API key de la cuenta de MSeller.',
        variant: 'destructive',
      });
      return;
    }
    setTrabajando('guardar');
    const r = await administrarEcf({
      accion: 'guardar_credenciales',
      companyId,
      ambiente,
      email: email.trim(),
      password,
      apiKey: apiKey.trim(),
    });
    setTrabajando(null);
    if (!r.ok) {
      toast({ title: 'No se pudieron guardar las credenciales', description: r.error, variant: 'destructive' });
      return;
    }
    limpiar();
    toast({ title: 'Credenciales guardadas', description: 'Prueba la conexión para dejar la empresa lista.' });
    // Guardar otras credenciales del ambiente en uso borra la marca de conexión probada.
    await onCambio();
  };

  const probarConexion = async () => {
    setTrabajando('probar');
    const r = await administrarEcf({ accion: 'probar_conexion', companyId, ambiente });
    setTrabajando(null);
    if (!r.ok) {
      toast({ title: 'La conexión falló', description: r.error, variant: 'destructive' });
    } else if (r.marcada) {
      toast({ title: 'Conexión exitosa', description: 'Quedó marcada como probada.' });
    } else {
      toast({
        title: 'La cuenta inicia sesión',
        description: 'Pero la conexión no quedó marcada: este no es el ambiente en uso de la empresa o todavía no hay datos del emisor guardados.',
      });
    }
    await onCambio();
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Credenciales por ambiente</h3>

      <div className="space-y-1.5 sm:max-w-xs">
        <Label>Ambiente de las credenciales</Label>
        <Select value={ambiente} onValueChange={(v) => elegirAmbiente(v as AmbienteEcf)} disabled={trabajando !== null}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ECF_AMBIENTES.map((a) => (
              <SelectItem key={a} value={a}>
                {etiquetaAmbiente(a)}{guardadas.some((g) => g.ambiente === a) ? ' — guardadas' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {ambienteEnUso && (
          <p className="text-xs text-muted-foreground">
            {ambiente === ambienteEnUso
              ? 'Es el ambiente en uso de la empresa.'
              : 'No es el ambiente en uso de la empresa: probarlo no cuenta para activarla.'}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {guardada
          // updated_at también se mueve cada vez que se renueva la sesión con MSeller:
          // dice cuándo hubo actividad, no cuándo se escribieron las credenciales.
          ? `Cuenta guardada: ${guardada.email}. Última actividad: ${fechaHora(guardada.updated_at)}.`
          : 'Todavía no hay credenciales guardadas en este ambiente.'}
        {' '}Por seguridad, la contraseña y la API key no se muestran nunca: para cambiarlas, escribe las nuevas.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="ecf-cred-email">Correo de la cuenta</Label>
          <Input
            id="ecf-cred-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ecf-cred-password">Contraseña</Label>
          <PasswordInput
            id="ecf-cred-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ecf-cred-apikey">API key</Label>
          <PasswordInput
            id="ecf-cred-apikey"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={probarConexion}
          disabled={trabajando !== null || !guardada}
          title={guardada ? 'Inicia sesión con las credenciales guardadas; no gasta cupo.' : 'Primero guarda las credenciales de este ambiente.'}
        >
          {trabajando === 'probar' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Probar conexión
        </Button>
        <Button onClick={guardarCredenciales} disabled={trabajando !== null}>
          {trabajando === 'guardar' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar credenciales
        </Button>
      </div>
    </section>
  );
}
