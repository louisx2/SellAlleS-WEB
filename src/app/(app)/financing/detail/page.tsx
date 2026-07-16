import { Suspense } from 'react';
import FinancingDetailClient from './financing-detail-client';

export default function FinancingDetailPage() {
  return (
    <Suspense>
      <FinancingDetailClient />
    </Suspense>
  );
}
