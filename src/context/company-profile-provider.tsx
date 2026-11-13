'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { CompanyProfile } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToCompanyProfile, companyProfileToRow } from '@/lib/supabase/mappers';

interface CompanyProfileContextType {
  profile: CompanyProfile;
  updateProfile: (profile: CompanyProfile) => void;
  /** Pone al día el perfil en memoria sin escribir en la base: para las
   *  tarjetas de Ajustes que guardan sus columnas por su cuenta. */
  mergeProfile: (partial: Partial<CompanyProfile>) => void;
}

const EMPTY: CompanyProfile = {
  name: 'SellAlleS', phone: '', rnc: '', address: '',
  isFormalized: false, ncfEnabled: false, ecfActiva: false,
  socialMedia: { instagram: '', facebook: '' }, email: '', logoUrl: '', ticketLogoUrl: '', receiptFooter: '',
  ticketNameDisplay: 'company', headerNameDisplay: 'company', ticketSocialDisplay: 'company', linkSlug: '',
  receiptCustomerInfoEnabled: false, receiptCustomerFields: ['address', 'phone'],
  // Los mismos defaults que las columnas en la base: mora fija del 5% por cuota
  // vencida, sin gracia y sin tope, que es como se ha cobrado siempre.
  lateFeeRate: 5, lateFeeMode: 'once', lateFeeGraceDays: 0, lateFeeMaxRate: 0,
  defaultInterestRate: 3.5,
  // Mismos defaults que las columnas en la base, para que el POS abra igual
  // mientras el perfil todavía no ha cargado.
  financingInterestMode: 'monthly_prorated',
  financingDefaultFrequency: 'monthly',
  financingDefaultInstallments: 12,
  loanLateFeeRate: 5, loanLateFeeMode: 'once', loanLateFeeGraceDays: 0, loanLateFeeMaxRate: 0,
  defaultLoanInterestRate: 5,
  loyaltyEnabled: false, loyaltyPurchasesRequired: null, loyaltyRewardDescription: '', loyaltyCouponValidDays: 30,
};

const CompanyProfileContext = createContext<CompanyProfileContextType | undefined>(undefined);

import { useAuth } from '@/context/auth-provider';

export function CompanyProfileProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY);
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    const targetCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
    
    if (!targetCompanyId) {
      setProfile(EMPTY);
      setCompanyId(null);
      return;
    }

    (async () => {
      // ecf_activa no es una columna: la decide el servidor (formalizada, módulo
      // encendido y e-CF activo). Si la consulta falla, la empresa sigue
      // vendiendo con NCF de la serie B como hasta ahora.
      const [{ data }, { data: ecfActiva, error: ecfError }] = await Promise.all([
        supabase.from('companies').select('*').eq('id', targetCompanyId).maybeSingle(),
        supabase.rpc('ecf_activa', { p_company: targetCompanyId }),
      ]);
      if (data) {
        setCompanyId(data.id);
        setProfile(rowToCompanyProfile(data, !ecfError && ecfActiva === true));
      } else {
        setProfile(EMPTY);
        setCompanyId(null);
      }
    })();
  }, [appUser?.companyId, appUser?.impersonatedCompanyId]);

  const updateProfile = (newProfile: CompanyProfile) => {
    setProfile(newProfile);
    if (companyId) {
      supabase.from('companies').update(companyProfileToRow(newProfile)).eq('id', companyId).then(() => {});
    }
  };

  const mergeProfile = (partial: Partial<CompanyProfile>) => {
    setProfile((prev) => ({ ...prev, ...partial }));
  };

  return (
    <CompanyProfileContext.Provider value={{ profile, updateProfile, mergeProfile }}>
      {children}
    </CompanyProfileContext.Provider>
  );
}

export const useCompanyProfile = (): CompanyProfileContextType => {
  const context = useContext(CompanyProfileContext);
  if (context === undefined) throw new Error('useCompanyProfile must be used within a CompanyProfileProvider');
  return context;
};
