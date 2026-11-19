'use client';

import { useCompanyProfile } from '@/context/company-profile-provider';
import { slugParaEnlace } from '@/lib/receipt-sharing';
import { trackingUrl } from '@/lib/taller';

/** Arma el enlace de seguimiento con el nombre de la empresa en el enlace (el que
 *  se configura en Perfil de Empresa, o su nombre), como el de las facturas. */
export function useEnlaceSeguimiento(): (code?: string) => string | undefined {
  const { profile } = useCompanyProfile();
  const empresa = slugParaEnlace(profile.linkSlug) || slugParaEnlace(profile.name);
  return (code?: string) => (code ? trackingUrl(code, empresa) : undefined);
}
