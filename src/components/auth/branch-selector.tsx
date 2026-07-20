import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Store, LogOut, Building2 } from 'lucide-react';

interface BranchSelectorProps {
  userName: string;
  branches: { id: string; name: string }[];
  onSelect: (id: string, name: string) => void;
  onSignOut: () => void;
  /** Solo para usuarios con más de una empresa: ir directo a Mis Empresas sin tener que entrar primero a una sucursal. */
  onGoToCompanies?: () => void;
}

export function BranchSelector({ userName, branches, onSelect, onSignOut, onGoToCompanies }: BranchSelectorProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <Store className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Hola, {userName}</CardTitle>
          <CardDescription>Selecciona la sucursal que vas a administrar</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {branches.map((b) => (
            <Button
              key={b.id}
              variant="outline"
              className="w-full justify-start h-auto py-3 px-4 text-left"
              onClick={() => onSelect(b.id, b.name)}
            >
              <Store className="mr-3 h-5 w-5 text-muted-foreground" />
              <div className="flex flex-col items-start">
                <span className="font-medium">{b.name}</span>
                <span className="text-xs text-muted-foreground">Entrar a esta sucursal</span>
              </div>
            </Button>
          ))}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {onGoToCompanies && (
            <Button variant="outline" className="w-full" onClick={onGoToCompanies}>
              <Building2 className="mr-2 h-4 w-4" />
              Ir a Mis Empresas
            </Button>
          )}
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={onSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
