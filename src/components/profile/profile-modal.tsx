'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Shield, User, Lock, Mail, Store } from 'lucide-react';

interface ProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileModal({ open, onOpenChange }: ProfileModalProps) {
  const { appUser, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    if (appUser?.name) {
      setName(appUser.name);
    }
  }, [appUser?.name]);

  // Limpieza forzada ultra-agresiva para evitar congelamientos de Radix UI
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        document.body.style.pointerEvents = '';
        document.body.removeAttribute('data-scroll-locked');
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!appUser) return null;

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: 'Error', description: 'El nombre no puede estar vacío.', variant: 'destructive' });
      return;
    }

    setIsUpdatingName(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ name: name.trim() })
        .eq('id', appUser.id);

      if (error) throw error;

      toast({ title: 'Nombre actualizado', description: 'Aplicando cambios y recargando...' });
      onOpenChange(false);
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message ?? 'No se pudo actualizar el nombre.', variant: 'destructive' });
    } finally {
      setIsUpdatingName(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || !confirmPassword) {
      toast({ title: 'Error', description: 'Por favor, completa todos los campos de contraseña.', variant: 'destructive' });
      return;
    }

    if (newPassword.length < 6) {
      toast({ title: 'Error', description: 'La nueva contraseña debe tener al menos 6 caracteres.', variant: 'destructive' });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({ title: 'Error', description: 'Las contraseñas nuevas no coinciden.', variant: 'destructive' });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      toast({ title: 'Contraseña actualizada', description: 'Aplicando cambios y recargando...' });
      onOpenChange(false);
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message ?? 'No se pudo cambiar la contraseña.', variant: 'destructive' });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Mi Perfil</DialogTitle>
          <DialogDescription>
            Administra tus datos personales y configuración de acceso.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-3 mt-4">
          {/* Resumen e Información Fija */}
          <div className="space-y-6 md:col-span-1">
            <div className="overflow-hidden rounded-xl border bg-gradient-to-b from-primary/5 to-transparent p-4 shadow-sm">
              <div className="text-center pb-2">
                <div className="mx-auto h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center mb-2">
                  <User className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold truncate">{appUser.name}</h3>
                <p className="text-sm text-muted-foreground capitalize">
                  {appUser.isSuperAdmin ? 'Super Administrador' : appUser.role}
                </p>
              </div>
              <div className="space-y-3 text-sm pt-4 border-t mt-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{appUser.email}</span>
                </div>
                {!appUser.isSuperAdmin && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Store className="h-4 w-4 shrink-0 text-primary" />
                    <span>Sucursal {appUser.branch}</span>
                  </div>
                )}
                {appUser.isSuperAdmin && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Shield className="h-4 w-4 shrink-0 text-indigo-500" />
                    <span>Acceso de Plataforma</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Formularios de Edición */}
          <div className="space-y-6 md:col-span-2">
            {/* Editar Nombre */}
            <div className="rounded-xl border shadow-sm">
              <div className="px-4 py-3 border-b bg-muted/20">
                <h3 className="font-semibold">Datos Personales</h3>
                <p className="text-xs text-muted-foreground">Modifica tu nombre público en la plataforma.</p>
              </div>
              <form onSubmit={handleUpdateName}>
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nombre completo</Label>
                    <Input
                      id="name"
                      placeholder="Tu nombre completo"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      disabled={isUpdatingName}
                    />
                  </div>
                </div>
                <div className="border-t px-4 py-3 flex justify-end bg-muted/10 rounded-b-xl">
                  <Button type="submit" disabled={isUpdatingName || name.trim() === appUser.name}>
                    {isUpdatingName && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar Nombre
                  </Button>
                </div>
              </form>
            </div>

            {/* Cambiar Contraseña */}
            <div className="rounded-xl border shadow-sm">
              <div className="px-4 py-3 border-b bg-muted/20">
                <h3 className="font-semibold">Seguridad</h3>
                <p className="text-xs text-muted-foreground">Actualiza tu contraseña de acceso.</p>
              </div>
              <form onSubmit={handleUpdatePassword}>
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">Nueva contraseña</Label>
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="Mínimo 6 caracteres"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      disabled={isUpdatingPassword}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirmar nueva contraseña</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Repite la nueva contraseña"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      disabled={isUpdatingPassword}
                    />
                  </div>
                </div>
                <div className="border-t px-4 py-3 flex justify-end bg-muted/10 rounded-b-xl">
                  <Button type="submit" disabled={isUpdatingPassword || !newPassword || !confirmPassword}>
                    {isUpdatingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Cambiar Contraseña
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
