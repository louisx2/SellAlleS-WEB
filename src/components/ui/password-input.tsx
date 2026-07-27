'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Campo de contraseña con el ojito para mostrar/ocultar.
 *
 * Existe para no repetir el mismo estado y el mismo botón en cada formulario:
 * antes solo dos pantallas lo tenían y el resto obligaba a escribir a ciegas.
 * Acepta las mismas props que <Input>, así que reemplaza a un
 * `<Input type="password" />` sin tocar nada más.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<typeof Input>, 'type'>
>(({ className, disabled, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        // Espacio a la derecha para que el texto largo no quede debajo del ojo.
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        // tabIndex -1 a propósito: al tabular desde la contraseña se debe ir al
        // siguiente campo del formulario, no al botón de ver.
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
