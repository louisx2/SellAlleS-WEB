import FinancingDetailClient from './financing-detail-client';

export function generateStaticParams() {
  return [{ saleId: 'placeholder' }];
}

export default function FinancingDetailPage() {
  return <FinancingDetailClient />;
}
