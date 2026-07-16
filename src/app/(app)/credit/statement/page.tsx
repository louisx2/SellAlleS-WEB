import { Suspense } from 'react';
import CustomerStatementClient from './customer-statement-client';

export default function CustomerStatementPage() {
  return (
    <Suspense>
      <CustomerStatementClient />
    </Suspense>
  );
}
