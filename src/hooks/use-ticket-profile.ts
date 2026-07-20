'use client';

import { useCompanyProfile } from '@/context/company-profile-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';

// Perfil efectivo que se imprime en un ticket: los datos propios de la
// sucursal ganan, y cualquier campo que la sucursal no tenga llenado hereda
// del perfil de la empresa. El RNC y las redes sociales son SIEMPRE de la
// empresa (identidad fiscal única).
export interface TicketProfile {
  name: string;
  // Segunda línea bajo `name` cuando la empresa configuró "mostrar ambos".
  secondaryName?: string;
  phone: string;
  address: string;
  rnc: string;
  ticketLogoUrl: string;
  receiptFooter: string;
  socialMedia: { instagram: string; facebook: string };
}

// branchRef: la sucursal donde se generó el documento — acepta nombre (las
// ventas/abonos guardan el NOMBRE en branchId) o UUID (los préstamos guardan
// el id real). Si no se pasa o no se encuentra, cae a la sucursal activa del
// usuario, y en último caso a los datos de la empresa.
export function useTicketProfile(branchRef?: string | null): TicketProfile {
  const { profile } = useCompanyProfile();
  const { branches } = useBranches();
  const { appUser } = useAuth();

  const target = branchRef || appUser?.branch || '';
  const branch = target ? branches.find((b) => b.name === target || b.id === target) : undefined;

  const companyName = profile.name;
  const branchName = branch?.displayName?.trim() || branch?.name?.trim() || '';

  // Qué nombre encabeza el ticket, según lo configurado en el perfil de la
  // empresa: el de la empresa (por defecto), el de la sucursal, o ambos.
  let name = companyName;
  let secondaryName: string | undefined;
  if (profile.ticketNameDisplay === 'branch') {
    name = branchName || companyName;
  } else if (profile.ticketNameDisplay === 'both' && branchName && branchName !== companyName) {
    secondaryName = branchName;
  }

  return {
    name,
    secondaryName,
    phone: branch?.phone?.trim() || profile.phone,
    address: branch?.address?.trim() || profile.address,
    rnc: branch?.rnc?.trim() || profile.rnc,
    ticketLogoUrl: branch?.ticketLogoUrl || profile.ticketLogoUrl,
    receiptFooter: branch?.receiptFooter?.trim() || profile.receiptFooter,
    socialMedia: profile.socialMedia,
  };
}
