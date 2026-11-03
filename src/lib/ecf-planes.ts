// Los planes de MSeller y lo que cada uno permite al mes. Sin dependencias: las
// pruebas (`scripts/tests/ecf.test.mjs`) cargan este archivo directamente con
// Node, que quita los tipos pero no resuelve imports de valores.

/** Los seis planes que acepta `ecf_config.plan` (ecf_config_plan_check). */
export type PlanMseller = 'gratis' | 'emprende' | 'basico' | 'negocio' | 'avanzado' | 'empresa';

export interface PlanInfo {
  nombre: string;
  /** Comprobantes al mes. */
  comprobantes: number;
  /** Llamadas a la API al mes. */
  requests: number;
  /** Cada cuántos minutos se consulta el estado en la DGII: 60 en el plan gratis, 30 en los de pago. */
  minutos: number;
}

/**
 * Cupo mensual de cada plan. Al elegir uno en el panel se copian a
 * `ecf_config.cupo_comprobantes`, `cupo_requests` y `minutos_entre_consultas`.
 * El plan es por RNC emisor: cada empresa tiene el suyo y su propio contador.
 */
export const PLANES_MSELLER: Record<PlanMseller, PlanInfo> = {
  gratis:   { nombre: 'Gratis',   comprobantes: 250,   requests: 1000,   minutos: 60 },
  emprende: { nombre: 'Emprende', comprobantes: 500,   requests: 2000,   minutos: 30 },
  basico:   { nombre: 'Básico',   comprobantes: 1000,  requests: 4000,   minutos: 30 },
  negocio:  { nombre: 'Negocio',  comprobantes: 2500,  requests: 10000,  minutos: 30 },
  avanzado: { nombre: 'Avanzado', comprobantes: 6000,  requests: 24000,  minutos: 30 },
  empresa:  { nombre: 'Empresa',  comprobantes: 10000, requests: 100000, minutos: 30 },
};
