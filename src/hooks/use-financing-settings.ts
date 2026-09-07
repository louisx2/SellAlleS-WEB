'use client';

import { useCompanyProfile } from '@/context/company-profile-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import type { InterestMode, PaymentFrequency } from '@/lib/frequency';

// Ajustes de financiamiento que aplican de verdad en una sucursal: lo que la
// sucursal tenga cargado gana, y lo que no, se hereda de la empresa. Mismo
// patrón que `useTicketProfile` — columnas NULL en `branches` = hereda.
//
// Son los valores con los que ABRE el diálogo del POS; el cajero puede
// cambiarlos en cada venta. Lo que queda grabado lo recalcula el servidor
// (`before_sale_credit_checks`), esto nunca es la fuente de verdad del dinero.
export interface FinancingSettings {
  interestRate: number;
  interestMode: InterestMode;
  frequency: PaymentFrequency;
  installments: number;
  /** Solo para mostrar la mora estimada; la del plan queda congelada al crearlo. */
  lateFeeRate: number;
  /** Si esta sucursal ofrece financiamiento. */
  financingEnabled: boolean;
}

// branchRef: acepta el uuid o el nombre de la sucursal (las ventas guardan el
// NOMBRE en branchId). Sin argumento usa la sucursal activa del usuario.
export function useFinancingSettings(branchRef?: string | null): FinancingSettings {
  const { profile } = useCompanyProfile();
  const { branches } = useBranches();
  const { appUser } = useAuth();

  const target = branchRef || appUser?.activeBranchId || appUser?.branch || '';
  const branch = target ? branches.find((b) => b.id === target || b.name === target) : undefined;

  return {
    interestRate: branch?.defaultInterestRate ?? profile.defaultInterestRate,
    interestMode: branch?.financingInterestMode ?? profile.financingInterestMode,
    frequency: branch?.financingDefaultFrequency ?? profile.financingDefaultFrequency,
    installments: branch?.financingDefaultInstallments ?? profile.financingDefaultInstallments,
    lateFeeRate: branch?.lateFeeRate ?? profile.lateFeeRate,
    // Si no se encuentra la sucursal se financia: es como funcionaba antes de
    // que existiera el interruptor, y el trigger de la base rechaza igual una
    // venta financiada en una sucursal apagada.
    financingEnabled: branch?.financingEnabled ?? true,
  };
}
