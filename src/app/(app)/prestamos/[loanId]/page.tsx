import LoanDetailClient from './loan-detail-client';

export function generateStaticParams() {
  return [{ loanId: 'placeholder' }];
}

export default function LoanDetailPage() {
  return <LoanDetailClient />;
}
