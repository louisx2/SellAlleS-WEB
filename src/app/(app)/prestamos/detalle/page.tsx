import LoanDetailClient from './loan-detail-client';

// Ruta estática (el préstamo se identifica por ?id=), no dinámica: se prerenderiza
// una sola página que funciona para cualquier id en el export estático.
export default function LoanDetailPage() {
  return <LoanDetailClient />;
}
