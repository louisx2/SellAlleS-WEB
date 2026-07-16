import { Suspense } from 'react';
import CustomerHistoryClient from './customer-history-client';

export default function CustomerHistoryPage() {
  return (
    <Suspense>
      <CustomerHistoryClient />
    </Suspense>
  );
}
