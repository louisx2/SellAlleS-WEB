import { ArrowLeft } from 'lucide-react';

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || 'https://sellalles.com';

export function BackToLanding() {
  return (
    <a
      href={LANDING_URL}
      className="absolute left-4 top-4 z-10 inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-amber-950 px-3.5 text-xs font-bold shadow-sm transition-all hover:scale-105 active:scale-95"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Volver al inicio
    </a>
  );
}
