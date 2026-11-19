import { Suspense } from 'react';
import SeguimientoClient from './seguimiento-client';

export default function SeguimientoPage() {
  return (
    <Suspense>
      <SeguimientoClient />
    </Suspense>
  );
}
