'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCustomers } from '@/context/customer-provider';
import { useSales } from '@/context/sales-provider';
import { useModules } from '@/context/modules-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToService, rowToCoupon } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils';
import type { Service, Coupon } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Crédito', financing: 'Financiamiento',
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: 'Pagada', credit: 'A crédito', in_financing: 'En financiamiento',
};

const SERVICE_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente', in_progress: 'En progreso', completed: 'Completado', cancelled: 'Cancelado',
};

const COUPON_STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active: { label: 'Activo', variant: 'default' },
  redeemed: { label: 'Canjeado', variant: 'secondary' },
  expired: { label: 'Expirado', variant: 'outline' },
};

export default function CustomerHistoryClient() {
  const searchParams = useSearchParams();
  const customerId = searchParams.get('id') ?? '';
  const { customers } = useCustomers();
  const { sales } = useSales();
  const { isModuleEnabled } = useModules();
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [portalStatus, setPortalStatus] = useState<{ cedulaValid: boolean; hasPortalAccess: boolean } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [working, setWorking] = useState(false);

  const customer = customers.find((c) => c.id === customerId);
  const servicesEnabled = isModuleEnabled('services');
  const loyaltyEnabled = isModuleEnabled('loyalty');
  const portalEnabled = isModuleEnabled('customer-portal');

  useEffect(() => {
    if (!customerId || !servicesEnabled) return;
    (async () => {
      const { data } = await supabase
        .from('services')
        .select('*, customers(id,name,phone), service_types(id,name,base_price)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });
      if (data) setServices(data.map(rowToService));
    })();
  }, [customerId, servicesEnabled]);

  useEffect(() => {
    if (!customerId || !loyaltyEnabled) return;
    (async () => {
      const { data } = await supabase
        .from('coupons')
        .select('*')
        .eq('customer_id', customerId)
        .order('issued_at', { ascending: false });
      if (data) setCoupons(data.map(rowToCoupon));
    })();
  }, [customerId, loyaltyEnabled]);

  useEffect(() => {
    if (!customerId || !portalEnabled) return;
    (async () => {
      const { data, error } = await supabase.functions.invoke('admin-portal-actions', {
        body: { action: 'status', customerId },
      });
      if (!error && data && !(data as any).error) {
        setPortalStatus(data as { cedulaValid: boolean; hasPortalAccess: boolean });
      }
    })();
  }, [customerId, portalEnabled]);

  const handleResetPin = async () => {
    if (!/^\d{6,}$/.test(newPin)) {
      toast({ title: 'PIN inválido', description: 'Debe tener al menos 6 dígitos.', variant: 'destructive' });
      return;
    }
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-portal-actions', {
        body: { action: 'reset_pin', customerId, newPin },
      });
      if (error) throw new Error((data as any)?.error ?? error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: 'PIN actualizado', description: `Se fijó un nuevo PIN para ${customer?.name}.` });
      setPortalStatus((prev) => (prev ? { ...prev, hasPortalAccess: true } : prev));
      setResetOpen(false);
      setNewPin('');
    } catch (err: any) {
      toast({ title: 'No se pudo cambiar', description: err?.message ?? 'Error.', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-10">
        <h1 className="text-2xl font-bold mb-4">Cliente no encontrado</h1>
        <p className="text-muted-foreground mb-6">No encontramos el cliente con ID: {customerId}</p>
        <Button asChild>
          <Link href="/customers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Clientes
          </Link>
        </Button>
      </div>
    );
  }

  const customerSales = sales
    .filter((s) => s.customerId === customer.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="space-y-6">
      <Button asChild variant="outline">
        <Link href="/customers">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{customer.name}</CardTitle>
          <CardDescription>
            {customer.phone && <>Tel: {customer.phone}</>}
            {customer.rnc && <> · RNC: {customer.rnc}</>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground">Descuento automático</p>
              <p className="text-xl font-bold">{customer.discountPercentage > 0 ? `${customer.discountPercentage}%` : 'Sin descuento'}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground">Total de compras/servicios</p>
              <p className="text-xl font-bold">{customer.loyaltyPurchaseCount}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground">Ventas registradas</p>
              <p className="text-xl font-bold">{customerSales.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {portalEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Portal de Clientes ("Mi Estado de Cuenta")</CardTitle>
            <CardDescription>
              Consulta de préstamos/crédito en línea con cédula y PIN.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            {!portalStatus ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : !portalStatus.cedulaValid ? (
              <p className="text-sm text-muted-foreground">
                Este cliente no tiene una cédula válida (11 dígitos) en el campo "RNC/Cédula" —
                no puede usar el portal todavía.
              </p>
            ) : (
              <>
                <Badge variant={portalStatus.hasPortalAccess ? 'outline' : 'secondary'}>
                  {portalStatus.hasPortalAccess ? 'PIN activado' : 'Aún no ha creado su PIN'}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Restablecer PIN
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {loyaltyEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Cupones de Fidelidad</CardTitle>
          </CardHeader>
          <CardContent>
            {coupons.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Este cliente aún no tiene cupones.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Premio</TableHead>
                    <TableHead>Emitido</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coupons.map((coupon) => (
                    <TableRow key={coupon.id}>
                      <TableCell className="font-mono">{coupon.code}</TableCell>
                      <TableCell>{coupon.rewardDescription}</TableCell>
                      <TableCell>{new Date(coupon.issuedAt).toLocaleDateString('es-DO')}</TableCell>
                      <TableCell>{new Date(coupon.expiresAt).toLocaleDateString('es-DO')}</TableCell>
                      <TableCell>
                        <Badge variant={COUPON_STATUS_BADGE[coupon.status].variant}>
                          {COUPON_STATUS_BADGE[coupon.status].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historial de Ventas</CardTitle>
        </CardHeader>
        <CardContent>
          {customerSales.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Este cliente no tiene ventas registradas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerSales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell>
                      <Link href={`/sales/detail?id=${sale.id}`} className="underline underline-offset-2">
                        {sale.createdAt.toLocaleDateString('es-DO')}
                      </Link>
                    </TableCell>
                    <TableCell>{PAYMENT_METHOD_LABEL[sale.paymentMethod] ?? sale.paymentMethod}</TableCell>
                    <TableCell className="text-right">{formatCurrency(sale.total)}</TableCell>
                    <TableCell>
                      <Badge variant={sale.paymentStatus === 'paid' ? 'outline' : 'destructive'}>
                        {PAYMENT_STATUS_LABEL[sale.paymentStatus] ?? sale.paymentStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {servicesEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Historial de Servicios</CardTitle>
          </CardHeader>
          <CardContent>
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Este cliente no tiene servicios registrados.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell>{service.createdAt.toLocaleDateString('es-DO')}</TableCell>
                      <TableCell>{service.description}</TableCell>
                      <TableCell className="text-right">{formatCurrency(service.total)}</TableCell>
                      <TableCell>
                        <Badge variant={service.status === 'completed' ? 'outline' : 'secondary'}>
                          {SERVICE_STATUS_LABEL[service.status] ?? service.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={resetOpen} onOpenChange={(o) => { setResetOpen(o); if (!o) setNewPin(''); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restablecer PIN</DialogTitle>
            <DialogDescription>
              Escribe el nuevo PIN para {customer.name}. Podrá entrar a "Mi Estado de Cuenta" con él de inmediato.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="newPin">Nuevo PIN</Label>
            <Input
              id="newPin"
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder="Mínimo 6 dígitos"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={working}>Cancelar</Button>
            <Button onClick={handleResetPin} disabled={working}>{working ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
