import { Suspense } from 'react';
import CasoClient from './caso-client';

export default function CasoPage() {
  return (
    <Suspense>
      <CasoClient />
    </Suspense>
  );
}
