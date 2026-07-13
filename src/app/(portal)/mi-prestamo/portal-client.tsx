'use client';

import { useEffect, useState } from 'react';
import { Store, Loader2, ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { calculateLoanStatus } from '@/lib/loan-utils';
import { calculateFinancingStatus } from '@/lib/utils';
import type { Loan, Sale } from '@/lib/types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error ?? 'Ocurrió un error inesperado.');
  return data as T;
}

interface PortalBusiness {
  companyId: string;
  companyName: string;
  customerId: string;
  lateFeeRate: number;
  loanLateFeeRate: number;
  loans: Loan[];
  creditSales: Sale[];
}

type Step = 'cedula' | 'login' | 'setup' | 'dashboard' | 'forgot' | 'reset-via-token';

const onlyDigits = (s: string) => s.replace(/\D/g, '');

function PortalHeader() {
  return (
    <div className="flex items-center gap-2 mb-6">
      <Store className="h-6 w-6 text-primary" />
      <span className="text-xl font-bold tracking-tight">Mi Estado de Cuenta</span>
    </div>
  );
}

interface DisplayInstallment {
  id: string;
  number: number;
  dueDate: string;
  amount: number;
  paidAmount: number;
  status: 'pending' | 'partial' | 'paid';
}

function InstallmentsTable({ installments }: { installments: DisplayInstallment[] | undefined }) {
  if (!installments || installments.length === 0) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>No.</TableHead>
          <TableHead>Vence</TableHead>
          <TableHead className="text-right">Monto</TableHead>
          <TableHead className="text-right">Pagado</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {installments.map((i) => (
          <TableRow key={i.id}>
            <TableCell>{i.number}</TableCell>
            <TableCell>{new Date(i.dueDate + 'T00:00:00').toLocaleDateString('es-DO')}</TableCell>
            <TableCell className="text-right">{formatCurrency(i.amount)}</TableCell>
            <TableCell className="text-right">{formatCurrency(i.paidAmount)}</TableCell>
            <TableCell>
              <Badge variant={i.status === 'paid' ? 'outline' : 'secondary'}>
                {i.status === 'paid' ? 'Pagada' : i.status === 'partial' ? 'Parcial' : 'Pendiente'}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function LoanCard({ loan, lateFeeRate }: { loan: Loan; lateFeeRate: number }) {
  const status = calculateLoanStatus(loan, lateFeeRate);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Préstamo
          {status.pendingBalance <= 0 ? (
            <Badge className="bg-green-600">Pagado</Badge>
          ) : status.isOverdue ? (
            <Badge variant="destructive">Atrasado</Badge>
          ) : (
            <Badge variant="outline">Al día</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Desde el {new Date(loan.createdAt).toLocaleDateString('es-DO')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Monto prestado</p>
            <p className="font-semibold">{formatCurrency(loan.principal)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total a pagar</p>
            <p className="font-semibold">{formatCurrency(loan.totalWithInterest)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pagado</p>
            <p className="font-semibold text-green-600">{formatCurrency(loan.amountPaid)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Por pagar</p>
            <p className="font-semibold text-destructive">{formatCurrency(status.pendingBalance)}</p>
          </div>
          {status.lateFee > 0 && (
            <div>
              <p className="text-muted-foreground">Mora</p>
              <p className="font-semibold text-destructive">{formatCurrency(status.lateFee)}</p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground">Próximo vencimiento</p>
            <p className="font-semibold">{status.nextDueDate ? status.nextDueDate.toLocaleDateString('es-DO') : '—'}</p>
          </div>
        </div>
        <InstallmentsTable installments={loan.installments} />
      </CardContent>
    </Card>
  );
}

function CreditSaleCard({ sale, lateFeeRate }: { sale: Sale; lateFeeRate: number }) {
  const status = calculateFinancingStatus(sale, lateFeeRate);
  const isFinancing = sale.paymentStatus === 'in_financing';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {isFinancing ? 'Compra financiada' : 'Compra a crédito'}
          {status.pendingBalance <= 0 ? (
            <Badge className="bg-green-600">Pagado</Badge>
          ) : status.isOverdue ? (
            <Badge variant="destructive">Atrasado</Badge>
          ) : (
            <Badge variant="outline">Al día</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Compra del {new Date(sale.createdAt).toLocaleDateString('es-DO')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Total de la compra</p>
            <p className="font-semibold">{formatCurrency(sale.financingDetails?.totalWithInterest ?? sale.total)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pagado</p>
            <p className="font-semibold text-green-600">{formatCurrency(sale.amountPaid)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Por pagar</p>
            <p className="font-semibold text-destructive">{formatCurrency(status.pendingBalance)}</p>
          </div>
          {status.lateFee > 0 && (
            <div>
              <p className="text-muted-foreground">Mora</p>
              <p className="font-semibold text-destructive">{formatCurrency(status.lateFee)}</p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground">Próximo vencimiento</p>
            <p className="font-semibold">{status.nextDueDate ? status.nextDueDate.toLocaleDateString('es-DO') : '—'}</p>
          </div>
        </div>
        <InstallmentsTable installments={sale.installments} />
      </CardContent>
    </Card>
  );
}

function BusinessDashboard({ business }: { business: PortalBusiness }) {
  const hasDebt = business.loans.length > 0 || business.creditSales.length > 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Store className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-bold">{business.companyName}</h2>
      </div>
      {!hasDebt ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No tienes préstamos ni compras a crédito registradas con este negocio.
        </p>
      ) : (
        <>
          {business.loans.map((loan) => (
            <LoanCard key={loan.id} loan={loan} lateFeeRate={business.loanLateFeeRate} />
          ))}
          {business.creditSales.map((sale) => (
            <CreditSaleCard key={sale.id} sale={sale} lateFeeRate={business.lateFeeRate} />
          ))}
        </>
      )}
    </div>
  );
}

export default function PortalClient() {
  const [step, setStep] = useState<Step>('cedula');
  const [cedula, setCedula] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<PortalBusiness[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showChangePin, setShowChangePin] = useState(false);
  const [oldPinInput, setOldPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmNewPinInput, setConfirmNewPinInput] = useState('');
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [changePinLoading, setChangePinLoading] = useState(false);
  const [changePinSuccess, setChangePinSuccess] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetNewPin, setResetNewPin] = useState('');
  const [resetConfirmPin, setResetConfirmPin] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search).get('resetToken');
    if (token) {
      setResetToken(token);
      setStep('reset-via-token');
    }
  }, []);

  const handleCedulaSubmit = async () => {
    const digits = onlyDigits(cedula);
    if (digits.length !== 11) {
      setError('La cédula debe tener 11 dígitos.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await callFunction<{ needsSetup: boolean }>('portal-login', { cedula: digits });
      setCedula(digits);
      setStep(data.needsSetup ? 'setup' : 'login');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async () => {
    if (!pin) { setError('Ingresa tu PIN.'); return; }
    setError(null);
    setLoading(true);
    try {
      const data = await callFunction<{ sessionToken: string }>('portal-login', { cedula, pin });
      sessionStorage.setItem('portalSessionToken', data.sessionToken);
      setSessionToken(data.sessionToken);
      await loadDashboard(data.sessionToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetupSubmit = async () => {
    if (!phone.trim()) { setError('Ingresa el teléfono registrado con el negocio.'); return; }
    if (!/^\d{6,}$/.test(newPin)) { setError('El PIN debe tener al menos 6 dígitos.'); return; }
    if (newPin !== confirmPin) { setError('Los PIN no coinciden.'); return; }
    setError(null);
    setLoading(true);
    try {
      await callFunction('portal-setup-pin', { cedula, phone: phone.trim(), newPin });
      setPin(newPin);
      // Entra directo tras crear el PIN.
      const data = await callFunction<{ sessionToken: string }>('portal-login', { cedula, pin: newPin });
      sessionStorage.setItem('portalSessionToken', data.sessionToken);
      setSessionToken(data.sessionToken);
      await loadDashboard(data.sessionToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async (token: string) => {
    const data = await callFunction<{ businesses: PortalBusiness[] }>('portal-data', { sessionToken: token });
    setBusinesses(data.businesses ?? []);
    if ((data.businesses ?? []).length === 1) {
      setSelectedCompanyId(data.businesses[0].companyId);
    }
    setStep('dashboard');
  };

  const handleReset = () => {
    sessionStorage.removeItem('portalSessionToken');
    setStep('cedula');
    setCedula('');
    setPhone('');
    setPin('');
    setNewPin('');
    setConfirmPin('');
    setError(null);
    setSessionToken(null);
    setBusinesses([]);
    setSelectedCompanyId(null);
  };

  const handleChangePin = async () => {
    if (!oldPinInput) { setChangePinError('Ingresa tu PIN actual.'); return; }
    if (!/^\d{6,}$/.test(newPinInput)) { setChangePinError('El PIN nuevo debe tener al menos 6 dígitos.'); return; }
    if (newPinInput !== confirmNewPinInput) { setChangePinError('Los PIN nuevos no coinciden.'); return; }
    setChangePinError(null);
    setChangePinLoading(true);
    try {
      await callFunction('portal-change-pin', { sessionToken, oldPin: oldPinInput, newPin: newPinInput });
      setChangePinSuccess(true);
      setOldPinInput('');
      setNewPinInput('');
      setConfirmNewPinInput('');
    } catch (e) {
      setChangePinError((e as Error).message);
    } finally {
      setChangePinLoading(false);
    }
  };

  const handleForgotSubmit = async () => {
    const digits = onlyDigits(cedula);
    if (digits.length !== 11) { setForgotError('La cédula debe tener 11 dígitos.'); return; }
    setForgotError(null);
    setForgotLoading(true);
    try {
      await callFunction('portal-forgot-pin', { cedula: digits });
      setForgotSent(true);
    } catch (e) {
      setForgotError((e as Error).message);
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResetViaToken = async () => {
    if (!/^\d{6,}$/.test(resetNewPin)) { setResetError('El PIN debe tener al menos 6 dígitos.'); return; }
    if (resetNewPin !== resetConfirmPin) { setResetError('Los PIN no coinciden.'); return; }
    setResetError(null);
    setResetLoading(true);
    try {
      await callFunction('portal-reset-pin', { token: resetToken, newPin: resetNewPin });
      setResetDone(true);
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetLoading(false);
    }
  };

  const selectedBusiness = businesses.find((b) => b.companyId === selectedCompanyId);

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-lg">
        <PortalHeader />

        {step === 'cedula' && (
          <Card>
            <CardHeader>
              <CardTitle>Consulta tu estado de cuenta</CardTitle>
              <CardDescription>Ingresa tu cédula para continuar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="cedula">Cédula</Label>
                <Input
                  id="cedula"
                  inputMode="numeric"
                  placeholder="000-0000000-0"
                  value={cedula}
                  onChange={(e) => setCedula(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCedulaSubmit()}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={handleCedulaSubmit} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continuar
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'login' && (
          <Card>
            <CardHeader>
              <CardTitle>Ingresa tu PIN</CardTitle>
              <CardDescription>Cédula: {cedula}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="pin">PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLoginSubmit()}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={handleLoginSubmit} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleReset}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Cambiar cédula
              </Button>
              <button
                type="button"
                onClick={() => { setForgotSent(false); setForgotError(null); setStep('forgot'); }}
                className="w-full text-center text-sm text-muted-foreground underline underline-offset-2"
              >
                ¿Olvidaste tu PIN?
              </button>
            </CardContent>
          </Card>
        )}

        {step === 'forgot' && (
          <Card>
            <CardHeader>
              <CardTitle>Recuperar PIN</CardTitle>
              <CardDescription>
                Te enviaremos un enlace al correo que el negocio tiene registrado para que crees un PIN nuevo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {forgotSent ? (
                <p className="text-sm text-green-600">
                  Si tenemos un correo registrado para esta cédula, te enviamos las instrucciones. Revisa tu bandeja de entrada.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Cédula: {cedula}</p>
                  {forgotError && <p className="text-sm text-destructive">{forgotError}</p>}
                  <Button className="w-full" onClick={handleForgotSubmit} disabled={forgotLoading}>
                    {forgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Enviar enlace de recuperación
                  </Button>
                </>
              )}
              <Button variant="ghost" className="w-full" onClick={() => setStep('login')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'reset-via-token' && (
          <Card>
            <CardHeader>
              <CardTitle>Crea tu PIN nuevo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {resetDone ? (
                <>
                  <p className="text-sm text-green-600">Tu PIN se actualizó. Ya puedes iniciar sesión con él.</p>
                  <Button className="w-full" onClick={handleReset}>Ir a iniciar sesión</Button>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="resetNewPin">PIN nuevo (mínimo 6 dígitos)</Label>
                    <Input
                      id="resetNewPin"
                      type="password"
                      inputMode="numeric"
                      value={resetNewPin}
                      onChange={(e) => setResetNewPin(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="resetConfirmPin">Confirma el PIN</Label>
                    <Input
                      id="resetConfirmPin"
                      type="password"
                      inputMode="numeric"
                      value={resetConfirmPin}
                      onChange={(e) => setResetConfirmPin(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleResetViaToken()}
                    />
                  </div>
                  {resetError && <p className="text-sm text-destructive">{resetError}</p>}
                  <Button className="w-full" onClick={handleResetViaToken} disabled={resetLoading}>
                    {resetLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar PIN nuevo
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {step === 'setup' && (
          <Card>
            <CardHeader>
              <CardTitle>Crea tu PIN</CardTitle>
              <CardDescription>
                Es tu primera vez aquí. Verifica tu identidad con el teléfono que el
                negocio tiene registrado y crea un PIN de al menos 6 dígitos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="phone">Teléfono registrado</Label>
                <Input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <Separator />
              <div className="space-y-1">
                <Label htmlFor="newPin">Nuevo PIN (mínimo 6 dígitos)</Label>
                <Input
                  id="newPin"
                  type="password"
                  inputMode="numeric"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirmPin">Confirma tu PIN</Label>
                <Input
                  id="confirmPin"
                  type="password"
                  inputMode="numeric"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetupSubmit()}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={handleSetupSubmit} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Crear PIN y entrar
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleReset}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Cambiar cédula
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'dashboard' && !selectedCompanyId && businesses.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Selecciona un negocio</CardTitle>
              <CardDescription>Tienes cuentas con más de un negocio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {businesses.map((b) => (
                <button
                  key={b.companyId}
                  onClick={() => setSelectedCompanyId(b.companyId)}
                  className="w-full text-left p-3 border rounded-md hover:bg-accent flex items-center gap-3"
                >
                  <Store className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{b.companyName}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {step === 'dashboard' && businesses.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No encontramos préstamos ni compras a crédito asociadas a tu cédula.
            </CardContent>
          </Card>
        )}

        {step === 'dashboard' && selectedBusiness && (
          <div className="space-y-4">
            {businesses.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedCompanyId(null)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Otro negocio
              </Button>
            )}
            <BusinessDashboard business={selectedBusiness} />
          </div>
        )}

        {step === 'dashboard' && !showChangePin && (
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" className="flex-1" onClick={() => setShowChangePin(true)}>
              Cambiar PIN
            </Button>
            <Button variant="ghost" className="flex-1" onClick={handleReset}>
              Salir
            </Button>
          </div>
        )}

        {step === 'dashboard' && showChangePin && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Cambiar PIN</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {changePinSuccess ? (
                <>
                  <p className="text-sm text-green-600">Tu PIN se actualizó correctamente.</p>
                  <Button
                    className="w-full"
                    onClick={() => { setShowChangePin(false); setChangePinSuccess(false); }}
                  >
                    Volver
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="oldPinInput">PIN actual</Label>
                    <Input
                      id="oldPinInput"
                      type="password"
                      inputMode="numeric"
                      value={oldPinInput}
                      onChange={(e) => setOldPinInput(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="newPinInput">PIN nuevo (mínimo 6 dígitos)</Label>
                    <Input
                      id="newPinInput"
                      type="password"
                      inputMode="numeric"
                      value={newPinInput}
                      onChange={(e) => setNewPinInput(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="confirmNewPinInput">Confirma el PIN nuevo</Label>
                    <Input
                      id="confirmNewPinInput"
                      type="password"
                      inputMode="numeric"
                      value={confirmNewPinInput}
                      onChange={(e) => setConfirmNewPinInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleChangePin()}
                    />
                  </div>
                  {changePinError && <p className="text-sm text-destructive">{changePinError}</p>}
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setShowChangePin(false)} disabled={changePinLoading}>
                      Cancelar
                    </Button>
                    <Button className="flex-1" onClick={handleChangePin} disabled={changePinLoading}>
                      {changePinLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Guardar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center mt-8 flex items-center justify-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5" />
          Consulta de saldo únicamente. Tu sesión expira sola por seguridad.
        </p>
      </div>
    </div>
  );
}
