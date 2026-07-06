'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Building2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface CreateCompanyScreenProps {
  userName: string;
  onSignOut: () => Promise<void>;
}

// Pantalla de onboarding para cuentas autenticadas que aún no pertenecen a
// ninguna empresa (registros previos al onboarding o sin nombre de negocio).
export function CreateCompanyScreen({ userName, onSignOut }: CreateCompanyScreenProps) {
  const [businessName, setBusinessName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('create_my_company', { p_name: businessName });
    if (rpcError) {
      setError(rpcError.message);
      setIsLoading(false);
      return;
    }
    // Empresa creada: recargar para que el AuthProvider tome el perfil completo.
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>¡Bienvenido, {userName}!</CardTitle>
          <CardDescription>
            Para empezar, dinos el nombre de tu negocio. Crearemos tu empresa con su
            sucursal principal y el plan Gratis.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="business-name">Nombre del negocio</Label>
              <Input
                id="business-name"
                type="text"
                placeholder="Ej: Ferretería Don Luis"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
                minLength={2}
                disabled={isLoading}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading || businessName.trim().length < 2}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear mi empresa
            </Button>
            <Button type="button" variant="link" size="sm" className="text-muted-foreground" onClick={() => onSignOut()}>
              Salir y entrar con otra cuenta
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
