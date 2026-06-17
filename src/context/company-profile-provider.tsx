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
  socialMedia: { instagram: '', facebook: '' }, logoUrl: '', receiptFooter: '',
};

const CompanyProfileContext = createContext<CompanyProfileContextType | undefined>(undefined);

export function CompanyProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY);
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('companies').select('*').limit(1).maybeSingle();
      if (data) {
        setCompanyId(data.id);
        setProfile(rowToCompanyProfile(data));
      }
    })();
  }, []);

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
