'use client';

import React from 'react';
import AuthedLayout from './authed-layout';
import { CompanyProfileProvider } from '@/context/company-profile-provider';
import { BranchProvider } from '@/context/branch-provider';
import { UserProvider } from '@/context/user-provider';
import { ProductProvider } from '@/context/product-provider';
import { CustomerProvider } from '@/context/customer-provider';
import { SalesProvider } from '@/context/sales-provider';
import { SupplierProvider } from '@/context/supplier-provider';
import { ExpenseProvider } from '@/context/expense-provider';
import { SidebarProvider } from '@/components/ui/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompanyProfileProvider>
      <BranchProvider>
        <UserProvider>
          <ProductProvider>
            <CustomerProvider>
              <SalesProvider>
                <SupplierProvider>
                  <ExpenseProvider>
                    <SidebarProvider defaultOpen={true}>
                      <AuthedLayout>{children}</AuthedLayout>
                    </SidebarProvider>
                  </ExpenseProvider>
                </SupplierProvider>
              </SalesProvider>
            </CustomerProvider>
          </ProductProvider>
        </UserProvider>
      </BranchProvider>
    </CompanyProfileProvider>
  );
}
