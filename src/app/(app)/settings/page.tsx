'use client';

import { PageHeader } from '@/components/page-header';
import { NcfSettingsCard } from '@/components/company-profile/ncf-settings-card';
import { FinancingSettingsCard } from '@/components/company-profile/financing-settings-card';
import { LoanSettingsCard } from '@/components/company-profile/loan-settings-card';
import { LoyaltySettingsCard } from '@/components/company-profile/loyalty-settings-card';
import { CajaEmailSettingsCard } from '@/components/company-profile/caja-email-settings-card';
import { BranchSharingCard } from '@/components/company-profile/branch-sharing-card';
import { PrintSettingsCard } from '@/components/company-profile/print-settings-card';
import { TaxSettingsCard } from '@/components/company-profile/tax-settings-card';
import { useModules } from '@/context/modules-provider';

export default function SettingsPage() {
  const { isModuleEnabled } = useModules();
  // El POS calcula el ITBIS y Reportes expone su control fiscal. Si alguno
  // está apagado, la configuración se conserva en la sucursal pero se oculta.
  const canConfigureTaxes = isModuleEnabled('pos') && isModuleEnabled('reports');

  return (
    <>
      <PageHeader title="Ajustes de la Empresa" />

      <div className="space-y-6 max-w-[1000px]">
        <div>
          <NcfSettingsCard />
        </div>
        {canConfigureTaxes && (
          <div>
            <TaxSettingsCard />
          </div>
        )}
        <div>
          <FinancingSettingsCard />
        </div>
        {isModuleEnabled('prestamos') && (
          <div>
            <LoanSettingsCard />
          </div>
        )}
        {isModuleEnabled('loyalty') && (
          <div>
            <LoyaltySettingsCard />
          </div>
        )}
        {isModuleEnabled('caja') && (
          <div>
            <CajaEmailSettingsCard />
          </div>
        )}
        <div>
          <BranchSharingCard />
        </div>
        <div>
          <PrintSettingsCard />
        </div>
      </div>
    </>
  );
}
