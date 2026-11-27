'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

// La ruta vieja del reporte: los marcadores y enlaces guardados siguen sirviendo.
export default function TallerReportRedirect() {
  const router = useRouter();
  React.useEffect(() => { router.replace('/reports/servicios'); }, [router]);
  return null;
}
