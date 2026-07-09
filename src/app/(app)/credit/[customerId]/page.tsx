import CustomerStatementClient from './customer-statement-client';

export function generateStaticParams() {
  return [{ customerId: 'placeholder' }];
}

export default function CustomerStatementPage() {
  return <CustomerStatementClient />;
}
