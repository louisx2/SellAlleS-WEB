'use client';

import { useCompanyProfile } from '@/context/company-profile-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';

// Perfil efectivo que se imprime en un ticket: los datos propios de la
// sucursal ganan, y cualquier campo que la sucursal no tenga llenado hereda
// del perfil de la empresa. El RNC es SIEMPRE de la empresa (identidad fiscal
// única); las redes y el correo dependen de `ticketSocialDisplay`.
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
  email: string;
  // Contacto de la sucursal como segunda línea, cuando se configuró "ambos".
  secondarySocialMedia?: { instagram: string; facebook: string };
  secondaryEmail?: string;
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

  // Contacto (redes + correo): igual que el nombre, la empresa decide si el
  // ticket lleva el suyo, el de la sucursal, o los dos.
  const companySocial = profile.socialMedia;
  const branchSocial = {
    instagram: branch?.instagram?.trim() || '',
    facebook: branch?.facebook?.trim() || '',
  };
  const branchEmail = branch?.email?.trim() || '';
  const branchTieneContacto = !!(branchSocial.instagram || branchSocial.facebook || branchEmail);

  let socialMedia = companySocial;
  let email = profile.email;
  let secondarySocialMedia: TicketProfile['secondarySocialMedia'];
  let secondaryEmail: string | undefined;

  if (profile.ticketSocialDisplay === 'branch') {
    // Por sucursal es por sucursal: lo que la sucursal no tenga cargado NO se
    // hereda de la empresa, se deja en blanco. Las redes de una sucursal son
    // suyas, y heredarlas hacía que un negocio imprimiera el Instagram de otro
    // (dos sucursales de la misma empresa con marcas distintas).
    socialMedia = branchSocial;
    email = branchEmail;
  } else if (profile.ticketSocialDisplay === 'both' && branchTieneContacto) {
    const repetido =
      branchSocial.instagram === companySocial.instagram &&
      branchSocial.facebook === companySocial.facebook &&
      branchEmail === profile.email;
    if (!repetido) {
      secondarySocialMedia = branchSocial;
      secondaryEmail = branchEmail;
    }
  }

  return {
    name,
    secondaryName,
    phone: branch?.phone?.trim() || profile.phone,
    address: branch?.address?.trim() || profile.address,
    rnc: branch?.rnc?.trim() || profile.rnc,
    ticketLogoUrl: branch?.ticketLogoUrl || profile.ticketLogoUrl,
    receiptFooter: branch?.receiptFooter?.trim() || profile.receiptFooter,
    socialMedia,
    email,
    secondarySocialMedia,
    secondaryEmail,
  };
}
