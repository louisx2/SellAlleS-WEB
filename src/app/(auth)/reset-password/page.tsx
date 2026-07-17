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

  // Detecta la sesión de recuperación creada al abrir el enlace del correo.
  // El cliente (detectSessionInUrl) consume el token del hash y dispara el
  // evento PASSWORD_RECOVERY; puede llegar un instante después de montar, así
  // que además de consultar getSession() escuchamos el cambio de estado. Si en
  // unos segundos no aparece sesión, el enlace es inválido o expiró.
  useEffect(() => {
    let settled = false;
    const markReady = () => { if (!settled) { settled = true; setStatus('ready'); } };
    const markInvalid = () => {
      if (!settled) {
        settled = true;
        setInvalidReason('El enlace de recuperación es inválido o ya expiró. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".');
        setStatus('invalid');
      }
    };

    // 1. ¿Ya hay sesión? (recovery ya procesado, o el usuario ya estaba dentro).
    supabase.auth.getSession().then(({ data }) => { if (data.session) markReady(); });

    // 2. La sesión de recuperación puede llegar un poco después.
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'PASSWORD_RECOVERY' || sess?.user) markReady();
    });

    // 3. Nada llegó: enlace inválido/expirado.
    const timer = setTimeout(markInvalid, 5000);

    return () => { clearTimeout(timer); sub.subscription.unsubscribe(); };
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
