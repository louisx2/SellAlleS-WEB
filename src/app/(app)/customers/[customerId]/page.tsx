import CustomerHistoryClient from './customer-history-client';

export function generateStaticParams() {
  return [{ customerId: 'placeholder' }];
}

export default function CustomerHistoryPage() {
  return <CustomerHistoryClient />;
}
