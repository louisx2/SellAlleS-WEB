'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { CompanyProfile } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToCompanyProfile, companyProfileToRow } from '@/lib/supabase/mappers';

interface CompanyProfileContextType {
  profile: CompanyProfile;
  updateProfile: (profile: CompanyProfile) => void;
}

const EMPTY: CompanyProfile = {
  name: 'SellAlleS', phone: '', rnc: '', address: '',
  socialMedia: { instagram: '', facebook: '' }, logoUrl: '', ticketLogoUrl: '', receiptFooter: '',
  lateFeeRate: 5, defaultInterestRate: 3.5,
  loanLateFeeRate: 5, defaultLoanInterestRate: 5,
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
      const { data } = await supabase.from('companies').select('*').eq('id', targetCompanyId).maybeSingle();
      if (data) {
        setCompanyId(data.id);
        setProfile(rowToCompanyProfile(data));
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

  return (
    <CompanyProfileContext.Provider value={{ profile, updateProfile }}>
      {children}
    </CompanyProfileContext.Provider>
  );
}

export const useCompanyProfile = (): CompanyProfileContextType => {
  const context = useContext(CompanyProfileContext);
  if (context === undefined) throw new Error('useCompanyProfile must be used within a CompanyProfileProvider');
  return context;
};
