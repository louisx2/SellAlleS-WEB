import { redirect } from 'next/navigation';

export default function ReportsPage() {
  // Redirect to the first reports page by default
  redirect('/reports/sales-summary');
}
