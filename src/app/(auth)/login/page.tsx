'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Store, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const { toast } = useToast();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'register') {
        const { needsConfirmation } = await signUp(name, email, password, businessName);
        if (needsConfirmation) {
          toast({
            title: 'Cuenta creada',
            description: 'Revisa tu correo para confirmar la cuenta antes de iniciar sesión.',
          });
          setMode('login');
          setIsLoading(false); // permanece en /login; reactivar el formulario
          return;
        }
        toast({ title: '¡Bienvenido!', description: 'Cuenta creada e iniciada correctamente.' });
        // Hay sesión: NO apagamos el overlay; el AuthProvider mostrará el skeleton y redirige.
      } else {
        await signIn(email, password);
        // Éxito: mantener el overlay activo hasta que el AuthProvider tome el control.
      }
    } catch (err: any) {
      const msg = err?.message ?? 'Ocurrió un error inesperado.';
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
          <CardTitle>{isRegister ? 'Crear Cuenta' : 'Iniciar Sesión'}</CardTitle>
          <CardDescription>
            {isRegister ? 'Regístrate para empezar a usar el sistema' : 'Accede a tu cuenta para continuar'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
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
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required disabled={isLoading} minLength={6} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRegister ? 'Crear cuenta' : 'Entrar'}
            </Button>
            <Button type="button" variant="link" size="sm" className="text-muted-foreground"
              onClick={() => { setError(null); setMode(isRegister ? 'login' : 'register'); }}>
              {isRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
            </Button>
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
