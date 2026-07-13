import { ThemeProvider } from '@/components/theme-provider';

// Portal público de clientes finales ("Mi Estado de Cuenta"): siempre en tema claro,
// independiente del tema que tenga configurado cualquier usuario del SaaS en
// este mismo navegador — mismo criterio que (auth)/layout.tsx.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="portal-theme">
      {children}
    </ThemeProvider>
  );
}
