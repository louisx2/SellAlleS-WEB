import { ArrowLeft } from 'lucide-react';

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || 'https://landingpos.loui-s.workers.dev';

export function BackToLanding() {
  return (
    <a
      href={LANDING_URL}
      className="absolute left-4 top-4 z-10 inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Volver al sitio
    </a>
  );
}
