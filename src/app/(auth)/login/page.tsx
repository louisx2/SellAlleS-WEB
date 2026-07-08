'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Store, Loader2, Eye, EyeOff } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

type Mode = 'login' | 'register' | 'recover';

interface Plan { id: string; name: string; price: number; }

const MOCK_PLANS: Plan[] = [
  { id: 'free-fallback', name: 'Plan Gratis', price: 0 },
  { id: 'basic-fallback', name: 'Plan Básico', price: 1500 },
  { id: 'premium-fallback', name: 'Plan Premium', price: 3000 },
];

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

export default function LoginPage() {
  const { toast } = useToast();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [keepSession, setKeepSession] = useState(true);

  useEffect(() => {
    if (mode === 'register' && plans.length === 0) {
      (async () => {
        try {
          const { data } = await supabase.from('plans').select('id, name, price').order('price');
          if (data && data.length > 0) {
            setPlans(data as Plan[]);
            setSelectedPlanId(data[0].id);
          } else {
            setPlans(MOCK_PLANS);
            setSelectedPlanId(MOCK_PLANS[0].id);
          }
        } catch (e) {
          setPlans(MOCK_PLANS);
          setSelectedPlanId(MOCK_PLANS[0].id);
        }
      })();
    }
  }, [mode, plans.length]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'register') {
        if (!selectedPlanId) {
          toast({ title: 'Selecciona un plan', description: 'Por favor selecciona un plan de suscripción.', variant: 'destructive' });
          setIsLoading(false);
          return;
        }

        const selectedPlan = plans.find(p => p.id === selectedPlanId);
        const isPaid = selectedPlan && selectedPlan.price > 0;
        const companyStatus = isPaid ? 'suspended' : 'active';

        const { needsConfirmation } = await signUp(name, email, password, businessName, selectedPlanId, companyStatus);
        if (needsConfirmation) {
          toast({
            title: 'Cuenta creada',
            description: isPaid 
              ? 'Cuenta en espera de pago. Revisa tu correo para confirmarla.' 
              : 'Revisa tu correo para confirmar la cuenta antes de iniciar sesión.',
          });
          setMode('login');
          setIsLoading(false); // permanece en /login; reactivar el formulario
          return;
        }
        toast({ 
          title: '¡Bienvenido!', 
          description: isPaid 
            ? 'Cuenta creada en espera de activación por pago.' 
            : 'Cuenta creada e iniciada correctamente.' 
        });
        // Hay sesión: NO apagamos el overlay; el AuthProvider mostrará el skeleton y redirige.
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
            {mode === 'register' ? 'Crear Cuenta' : mode === 'recover' ? 'Recuperar Contraseña' : 'Iniciar Sesión'}
          </CardTitle>
          <CardDescription>
            {mode === 'register' ? 'Regístrate para empezar a usar el sistema' : mode === 'recover' ? 'Ingresa tu correo para recibir un enlace de recuperación' : 'Accede a tu cuenta para continuar'}
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
                {plans.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="plan">Plan de Suscripción</Label>
                    <Select value={selectedPlanId} onValueChange={setSelectedPlanId} disabled={isLoading}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} {p.price > 0 ? `(RD$${p.price}/mes)` : '(Gratis)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
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
                      onChange={(e) => setPassword(e.target.value)} required disabled={isLoading} minLength={6} />
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
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'register' ? 'Crear cuenta' : mode === 'recover' ? 'Enviar enlace' : 'Entrar'}
            </Button>
            {mode === 'recover' ? (
              <Button type="button" variant="link" size="sm" className="text-muted-foreground"
                onClick={() => { setError(null); setMode('login'); }}>
                Volver a Iniciar Sesión
              </Button>
            ) : (
              <Button type="button" variant="link" size="sm" className="text-muted-foreground"
                onClick={() => { setError(null); setMode(isRegister ? 'login' : 'register'); }}>
                {isRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
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
