import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StoreIcon, LogOut } from 'lucide-react';

interface BranchInactiveScreenProps {
  userName: string;
  onSignOut: () => void;
}

export function BranchInactiveScreen({ userName, onSignOut }: BranchInactiveScreenProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <StoreIcon className="h-8 w-8" />
            </div>
          </div>
          <CardTitle className="text-xl">Sucursal desactivada</CardTitle>
          <CardDescription>Hola, {userName}</CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground space-y-4">
          <p>
            La sucursal a la que perteneces ha sido <strong>desactivada</strong> por un administrador. No puedes operar desde aquí por ahora.
          </p>
          <p className="bg-muted p-3 rounded-lg border text-xs text-left">
            💡 <strong>¿Qué hacer?</strong>
            <br />
            Comunícate con el administrador de tu empresa para que reactive la sucursal o te asigne a otra.
          </p>
        </CardContent>
        <CardFooter>
          <Button variant="outline" className="w-full" onClick={onSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar Sesión
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
