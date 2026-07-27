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
  // El modo de ITBIS solo surte efecto donde se cobran precios: el carrito del
  // POS y las cotizaciones que salen de él. Con esos módulos apagados la
  // configuración se conserva en la sucursal, pero no se muestra.
  const canConfigureTaxes = isModuleEnabled('pos') || isModuleEnabled('quotes');

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
