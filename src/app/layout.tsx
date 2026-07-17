import type { Metadata, Viewport } from 'next';
import { PT_Sans } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { AuthProvider } from '@/context/auth-provider';
import { PWARegister } from '@/components/pwa-register';

const ptSans = PT_Sans({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'SellAlleS',
  description: 'Sistema de Punto de Venta',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SellAlleS',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#35bbf0',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={cn("min-h-screen bg-background font-sans antialiased", ptSans.variable)}>
        {/* Captura DETERMINÍSTICA del enlace de recuperación de contraseña.
            Este script inline corre durante el parseo del HTML, antes de que
            cargue cualquier bundle (van con defer): guarda el hash del enlace
            (#access_token...&type=recovery, o #error_code=otp_expired) y lo
            quita de la URL para que supabase-js NO lo procese por su cuenta.
            La página /reset-password lo lee de sessionStorage y establece la
            sesión ella misma — sin carreras de eventos que se pierden. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(location.pathname==='/reset-password'&&location.hash.length>1){try{sessionStorage.setItem('pwRecoveryHash',location.hash.slice(1));}catch(e){}history.replaceState(null,'',location.pathname+location.search);}`,
          }}
        />
        <AuthProvider>
          <PWARegister />
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
