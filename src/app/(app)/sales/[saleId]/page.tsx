import SaleReceiptClient from './sale-receipt-client';

export function generateStaticParams() {
  return [{ saleId: 'placeholder' }];
}

export default function SaleReceiptPage() {
  return <SaleReceiptClient />;
}
