// En qué grupo sale cada empresa en el panel de Empresas del super admin
// (/admin/empresas), y en qué orden dentro de su grupo.
//
// Los grupos son el estado de la empresa, no el de sus cobros (eso es
// /admin/cobros): prueba vencida, en prueba, activa o suspendida. La prueba
// vencida se decide igual que el modo solo facturación (lib/bloqueo.ts): una
// empresa en prueba cuyo trial_ends_at ya pasó.
//
// Lógica pura y sin imports de valor: la prueban scripts/tests/grupos-empresa.test.mjs.

export type GrupoEmpresa = 'prueba_vencida' | 'prueba' | 'activas' | 'suspendidas';

export const GRUPOS_EMPRESA: { key: GrupoEmpresa; label: string; descripcion: string }[] = [
  { key: 'prueba_vencida', label: 'Prueba vencida', descripcion: 'Terminaron la prueba sin activarse: solo pueden facturar' },
  { key: 'prueba', label: 'En prueba', descripcion: 'Dentro de los días de prueba gratis' },
  { key: 'activas', label: 'Activas', descripcion: 'Clientes que pagan; la etiqueta dice cómo van con sus cuotas' },
  { key: 'suspendidas', label: 'Suspendidas', descripcion: 'No pueden operar hasta que se reactiven' },
];

export interface EmpresaParaGrupo {
  status: string;
  /** companies.trial_ends_at (timestamptz en ISO). */
  trialEndsAt?: string | null;
}

export function grupoDeEmpresa(e: EmpresaParaGrupo, ahora: number = Date.now()): GrupoEmpresa {
  if (e.status === 'suspended') return 'suspendidas';
  if (e.status === 'active') return 'activas';
  if (e.trialEndsAt && new Date(e.trialEndsAt).getTime() < ahora) return 'prueba_vencida';
  return 'prueba';
}

export interface EmpresaParaOrden {
  nombre: string;
  trialEndsAt?: string | null;
  suspendedAt?: string | null;
  /** Posición de su estado de cobro en ESTADO_COBRO_ORDEN (primero lo que
   *  hay que cobrar). Solo cuenta en las activas. */
  ordenCobro?: number;
}

const instante = (s?: string | null, siFalta = 0) => (s ? new Date(s).getTime() : siFalta);

/** Orden dentro de un grupo:
 *  - prueba vencida: la que venció hace menos primero (la más fácil de convertir);
 *  - en prueba: la que termina antes primero (sin fecha, al final);
 *  - activas: primero las que deben, luego por nombre;
 *  - suspendidas: la más reciente primero. */
export function compararEnGrupo(grupo: GrupoEmpresa, a: EmpresaParaOrden, b: EmpresaParaOrden): number {
  const porNombre = a.nombre.localeCompare(b.nombre, 'es');
  switch (grupo) {
    case 'prueba_vencida':
      return instante(b.trialEndsAt) - instante(a.trialEndsAt) || porNombre;
    case 'prueba':
      return instante(a.trialEndsAt, Infinity) - instante(b.trialEndsAt, Infinity) || porNombre;
    case 'activas':
      return (a.ordenCobro ?? 99) - (b.ordenCobro ?? 99) || porNombre;
    case 'suspendidas':
      return instante(b.suspendedAt) - instante(a.suspendedAt) || porNombre;
  }
}
