import { ThemeProvider } from '@/components/theme-provider';
import { AuthThemeToggle } from './auth-theme-toggle';

// Las páginas públicas (login, recuperar contraseña) usan su propio tema,
// independiente del que cada usuario configure dentro del SaaS: siempre
// arrancan en claro y se guardan en una llave de localStorage separada,
// para que un admin con tema oscuro no le imponga oscuro a un visitante.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="auth-theme">
      <AuthThemeToggle />
      {children}
    </ThemeProvider>
  );
}
