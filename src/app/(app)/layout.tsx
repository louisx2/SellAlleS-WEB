'use client';

import React from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import AuthedLayout from './authed-layout';
import { CompanyProfileProvider } from '@/context/company-profile-provider';
import { BranchProvider } from '@/context/branch-provider';
import { UserProvider } from '@/context/user-provider';
import { ProductProvider } from '@/context/product-provider';
import { CategoryProvider } from '@/context/category-provider';
import { LocationProvider } from '@/context/location-provider';
import { CustomerProvider } from '@/context/customer-provider';
import { SalesProvider } from '@/context/sales-provider';
import { SupplierProvider } from '@/context/supplier-provider';
import { ExpenseProvider } from '@/context/expense-provider';
import { QuotesProvider } from '@/context/quotes-provider';
import { LoanProvider } from '@/context/loan-provider';
import { CajaProvider } from '@/context/caja-provider';
import { ModulesProvider } from '@/context/modules-provider';
import { SidebarProvider } from '@/components/ui/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <ModulesProvider>
    <CompanyProfileProvider>
      <BranchProvider>
        <UserProvider>
          <CategoryProvider>
            <LocationProvider>
              <ProductProvider>
                <CustomerProvider>
                  <SalesProvider>
                    <SupplierProvider>
                      <ExpenseProvider>
                        <QuotesProvider>
                          <LoanProvider>
                            <CajaProvider>
                              <SidebarProvider defaultOpen={false}>
                                <AuthedLayout>{children}</AuthedLayout>
                              </SidebarProvider>
                            </CajaProvider>
                          </LoanProvider>
                        </QuotesProvider>
                      </ExpenseProvider>
                    </SupplierProvider>
                  </SalesProvider>
                </CustomerProvider>
              </ProductProvider>
            </LocationProvider>
          </CategoryProvider>
        </UserProvider>
      </BranchProvider>
    </CompanyProfileProvider>
    </ModulesProvider>
    </ThemeProvider>
  );
}
