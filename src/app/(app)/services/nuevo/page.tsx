import { Suspense } from 'react';
import NuevoIngresoClient from './nuevo-client';

export default function NuevoIngresoPage() {
  return (
    <Suspense>
      <NuevoIngresoClient />
    </Suspense>
  );
}
