'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Store, Loader2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';

// Misma política que el registro (login/page.tsx).
function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Z]/.test(pw)) return 'Debe incluir al menos una letra mayúscula.';
  if (!/[a-z]/.test(pw)) return 'Debe incluir al menos una letra minúscula.';
  if (!/\d/.test(pw)) return 'Debe incluir al menos un número.';
  if (!/[@$!%*?&._\-\/#]/.test(pw)) return 'Debe incluir al menos un carácter especial (@, $, !, %, *, ?, &, ., _, -, /, #).';
  return null;
}

type Status = 'verifying' | 'ready' | 'invalid';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>('verifying');
  const [invalidReason, setInvalidReason] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // El hash del enlace de recuperación (#access_token...&type=recovery) lo
  // captura un script inline en el layout raíz ANTES de que cargue cualquier
  // bundle (sessionStorage 'pwRecoveryHash') — así no hay carrera posible con
  // supabase-js consumiéndolo y disparando PASSWORD_RECOVERY antes de que
  // esta página se monte (eso era lo que hacía fallar el flujo en producción).
  // Aquí la página establece la sesión ELLA MISMA con esos tokens: si son
  // forjados o vencidos, el servidor los rechaza → inválido. NUNCA se confía
  // en una sesión ya abierta (getSession) — eso permitiría cambiar la clave
  // de un navegador logueado sin conocer la contraseña anterior.
  useEffect(() => {
    let cancelled = false;
    // El hash guardado solo se borra al validar CON ÉXITO (markReady): así un
    // refresh (o el doble-mount de StrictMode en dev) reproduce el mismo
    // resultado en vez de caer al mensaje genérico de "sin enlace".
    const markReady = () => {
      sessionStorage.removeItem('pwRecoveryHash');
      sessionStorage.setItem('passwordRecoveryActive', '1');
      // Marcador DURABLE (localStorage, por-origen): la sesión de recuperación
      // que Supabase persiste en localStorage puede sobrevivir a que el usuario
      // salga de la app (p. ej. "Volver al inicio" → sellalles.com) y regrese.
      // sessionStorage se pierde al cruzar de origen; localStorage no. Con este
      // marcador, el AuthProvider reconoce esa sesión como "de recuperación" al
      // volver y la cierra en vez de dejar entrar al perfil sin la contraseña.
      localStorage.setItem('pwRecoveryPending', '1');
      if (!cancelled) setStatus('ready');
    };
    const markInvalid = (reason: string) => {
      if (!cancelled) { setInvalidReason(reason); setStatus('invalid'); }
    };

    (async () => {
      const rawHash = sessionStorage.getItem('pwRecoveryHash');

      if (!rawHash) {
        // Refresh de la pestaña después de que el flujo ya validó una vez.
        if (sessionStorage.getItem('passwordRecoveryActive') === '1') { markReady(); return; }
        markInvalid('Abre esta página desde el enlace de recuperación que te enviamos por correo. Si ya lo usaste, solicita uno nuevo desde "¿Olvidaste tu contraseña?".');
        return;
      }

      const params = new URLSearchParams(rawHash);

      // Supabase redirige con el error en el hash cuando el enlace ya se usó o venció.
      const errCode = params.get('error_code');
      if (errCode || params.get('error')) {
        markInvalid(errCode === 'otp_expired'
          ? 'Este enlace ya fue usado o expiró. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".'
          : (params.get('error_description') || 'El enlace de recuperación es inválido. Solicita uno nuevo.'));
        return;
      }

      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (!access_token || !refresh_token) {
        markInvalid('El enlace llegó incompleto. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".');
        return;
      }

      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) {
        markInvalid('El enlace de recuperación es inválido o ya expiró. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".');
        return;
      }
      markReady();
    })();

    // Redundancia: si por algún motivo el script inline no capturó el hash y
    // supabase-js sí lo procesó, el evento PASSWORD_RECOVERY también habilita.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') markReady();
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const policyError = validatePassword(password);
    if (policyError) {
      toast({ title: 'Contraseña insegura', description: policyError, variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Las contraseñas no coinciden', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Cerrar la sesión de recuperación: el usuario entra de nuevo con su
      // contraseña nueva (y no queda una sesión de recuperación abierta).
      await supabase.auth.signOut();
      sessionStorage.removeItem('passwordRecoveryActive');
      localStorage.removeItem('pwRecoveryPending');
      toast({ title: 'Contraseña actualizada', description: 'Ya puedes iniciar sesión con tu nueva contraseña.' });
      router.replace('/login');
    } catch (err: any) {
      const raw = err?.message ?? '';
      const msg = /different from the old|should be different/i.test(raw)
        ? 'La nueva contraseña debe ser distinta a la anterior.'
        : /session|not authenticated|Auth session missing/i.test(raw)
          ? 'La sesión de recuperación expiró. Solicita un nuevo enlace.'
          : (raw || 'No se pudo actualizar la contraseña.');
      toast({ title: 'Error al actualizar', description: msg, variant: 'destructive' });
      setIsSaving(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <Store className="h-8 w-8 text-primary" />
            <span className="ml-2 font-bold text-2xl">SellAlleS</span>
          </div>
          <CardTitle>Nueva Contraseña</CardTitle>
          <CardDescription>
            {status === 'invalid'
              ? 'No pudimos validar tu enlace de recuperación.'
              : 'Ingresa tu nueva contraseña para acceder a tu cuenta.'}
          </CardDescription>
        </CardHeader>

        {status === 'verifying' && (
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Verificando enlace…</p>
          </CardContent>
        )}

        {status === 'invalid' && (
          <>
            <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{invalidReason}</p>
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full">
                <Link href="/login">Volver a Iniciar Sesión</Link>
              </Button>
            </CardFooter>
          </>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Nueva Contraseña</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)} required disabled={isSaving}
                    placeholder="Mínimo 8 caracteres" />
                  <Button type="button" variant="ghost" size="icon"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar Contraseña</Label>
                <div className="relative">
                  <Input id="confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)} required disabled={isSaving} />
                  <Button type="button" variant="ghost" size="icon"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                    {showConfirmPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Usa al menos 8 caracteres, con mayúscula, minúscula, número y un carácter especial.
              </p>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Actualizar Contraseña
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
