import { Suspense } from 'react';
import SaleReceiptClient from './sale-receipt-client';

export default function SaleReceiptPage() {
  return (
    <Suspense>
      <SaleReceiptClient />
    </Suspense>
  );
}
