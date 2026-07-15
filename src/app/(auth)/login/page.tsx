'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Store, Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';

type Mode = 'login' | 'register' | 'recover';

const AUTH_TRANSLATIONS: Record<string, string> = {
  'Email not confirmed': 'El correo electrónico no ha sido confirmado. Por favor, revisa tu bandeja de entrada o carpeta de spam.',
  'Invalid login credentials': 'El correo o la contraseña son incorrectos. Inténtalo de nuevo.',
  'User already registered': 'Este correo electrónico ya está registrado en la plataforma.',
  'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.',
};

function translateError(msg: string): string {
  for (const [english, spanish] of Object.entries(AUTH_TRANSLATIONS)) {
    if (msg.toLowerCase().includes(english.toLowerCase())) {
      return spanish;
    }
  }
  return msg;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>(searchParams.get('mode') === 'register' ? 'register' : 'login');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [keepSession, setKeepSession] = useState(true);

  // Auto-login desde la demo del landing: si llega la sesión en el hash de la
  // URL (#access_token=...&refresh_token=...), la establecemos y el
  // AuthProvider redirige solo al dashboard. Los tokens en el hash no viajan al
  // servidor (patrón estándar de Supabase para handoff de sesión entre dominios).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      setIsLoading(true);
      // Limpiar el hash para no dejar los tokens en la barra de direcciones.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      supabase.auth.setSession({ access_token, refresh_token }).then(({ error: sessErr }) => {
        if (sessErr) {
          setIsLoading(false);
          setError('No se pudo iniciar la sesión de prueba. Inicia sesión con las credenciales que te dimos.');
        }
        // Éxito: el AuthProvider detecta la sesión y redirige; mantenemos el overlay.
      });
    }
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'register') {
        const { needsConfirmation } = await signUp(name, email, password, businessName);
        if (needsConfirmation) {
          toast({
            title: 'Cuenta creada 🎉',
            description: 'Te enviamos un correo para confirmar tu cuenta. Revisa tu bandeja (y la carpeta de spam) y luego inicia sesión.',
          });
          setMode('login');
          setIsLoading(false);
          return;
        }
        toast({ title: '¡Bienvenido!', description: 'Tu cuenta fue creada. Empieza tu prueba gratis.' });
        // Hay sesión: el AuthProvider mostrará el skeleton y redirige.
      } else if (mode === 'recover') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        toast({ title: 'Enlace enviado', description: 'Revisa tu correo para recuperar tu contraseña.' });
        setMode('login');
        setIsLoading(false);
      } else {
        // Mode login
        if (!keepSession) {
          localStorage.setItem('keepSession', 'false');
          sessionStorage.setItem('tabSession', 'true');
        } else {
          localStorage.setItem('keepSession', 'true');
        }
        await signIn(email, password);
        // Éxito: mantener el overlay activo hasta que el AuthProvider tome el control.
      }
    } catch (err: any) {
      const rawMsg = err?.message ?? 'Ocurrió un error inesperado.';
      const msg = translateError(rawMsg);
      setError(msg);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
      setIsLoading(false);
    }
  };

  const isRegister = mode === 'register';

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <Store className="h-8 w-8 text-primary" />
            <span className="ml-2 font-bold text-2xl">SellAlleS</span>
          </div>
          <CardTitle>
            {mode === 'register' ? 'Crea tu cuenta gratis' : mode === 'recover' ? 'Recuperar Contraseña' : 'Iniciar Sesión'}
          </CardTitle>
          <CardDescription>
            {mode === 'register' ? 'Prueba todas las funciones 14 días. Sin tarjeta de crédito.' : mode === 'recover' ? 'Ingresa tu correo para recibir un enlace de recuperación' : 'Accede a tu cuenta para continuar'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {mode === 'recover' ? (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="tu@email.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} required disabled={isLoading} />
              </div>
            ) : (
              <>
                {isRegister && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="name">Tu nombre</Label>
                      <Input id="name" type="text" placeholder="Tu nombre" value={name}
                        onChange={(e) => setName(e.target.value)} required disabled={isLoading} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="business-name">Nombre del negocio</Label>
                      <Input id="business-name" type="text" placeholder="Ej: Ferretería Don Luis" value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)} required minLength={2} disabled={isLoading} />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="tu@email.com" value={email}
                    onChange={(e) => setEmail(e.target.value)} required disabled={isLoading} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Contraseña</Label>
                    {!isRegister && (
                      <Button variant="link" size="sm" type="button" className="h-auto p-0 text-xs" onClick={() => setMode('recover')}>
                        ¿Olvidaste tu contraseña?
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <Input id="password" type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)} required disabled={isLoading} minLength={6}
                      placeholder={isRegister ? 'Mínimo 6 caracteres' : undefined} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </div>
                </div>
                {!isRegister && (
                  <div className="flex items-center space-x-2">
                    <Checkbox id="keepSession" checked={keepSession} onCheckedChange={(c) => setKeepSession(c as boolean)} />
                    <Label htmlFor="keepSession" className="text-sm font-normal">
                      Mantener sesión activa
                    </Label>
                  </div>
                )}
                {isRegister && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    No necesitas RNC ni estar formalizado para empezar.
                  </p>
                )}
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'register' ? 'Crear cuenta gratis' : mode === 'recover' ? 'Enviar enlace' : 'Entrar'}
            </Button>
            {mode === 'recover' ? (
              <Button type="button" variant="link" size="sm" className="text-muted-foreground"
                onClick={() => { setError(null); setMode('login'); }}>
                Volver a Iniciar Sesión
              </Button>
            ) : (
              <Button type="button" variant="link" size="sm" className="text-muted-foreground"
                onClick={() => { setError(null); setMode(isRegister ? 'login' : 'register'); }}>
                {isRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate gratis'}
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
