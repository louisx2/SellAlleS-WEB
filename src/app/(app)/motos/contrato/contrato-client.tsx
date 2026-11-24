'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Printer } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useMotosAjustes } from '@/hooks/use-motos-ajustes';
import { CONTRATO_BASE, garantesComoTexto, llenarContrato, montoRD, type TipoContrato } from '@/lib/contrato';
import { ContratoDocumento, type CuotaDelPlan } from '@/components/motos/contrato-documento';

// Cómo se leen las frecuencias dentro del texto ("52 cuotas semanales").
const FRECUENCIA: Record<string, string> = {
  daily: 'diarias (de lunes a sábado)', daily_all: 'diarias', weekly: 'semanales', biweekly: 'quincenales', monthly: 'mensuales',
};

/** yyyy-mm-dd → dd/mm/yyyy, sin pasar por la zona horaria. */
const dia = (s?: string | null) => {
  const [y, m, d] = (s ?? '').slice(0, 10).split('-');
  return y && m && d ? `${Number(d)}/${Number(m)}/${y}` : '';
};

type Datos = { valores: Record<string, string | undefined>; plan: CuotaDelPlan[] };

// El contrato de una venta condicional (?tipo=venta&id=<venta>) o de un préstamo
// con garantía (?tipo=prestamo&id=<préstamo>), listo para imprimir en carta.
export default function ContratoClient() {
  const { profile } = useCompanyProfile();
  const { ajustes, loading: cargandoAjustes } = useMotosAjustes();
  const [tipo, setTipo] = useState<TipoContrato>('venta');
  const [id, setId] = useState('');
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const imprimir = useReactToPrint({
    content: () => printRef.current,
    pageStyle: '@page { size: letter; margin: 2cm } body { color: #000; }',
  });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setTipo(q.get('tipo') === 'prestamo' ? 'prestamo' : 'venta');
    setId(q.get('id') ?? '');
  }, []);

  useEffect(() => {
    if (!id) return;
    let vigente = true;
    (async () => {
      setError(null);
      const esVenta = tipo === 'venta';
      const [cuenta, motos] = await Promise.all([
        esVenta
          ? supabase.from('sales').select('*, customers(*), financing_installments(*)').eq('id', id).maybeSingle()
          : supabase.from('loans').select('*, customers(*), loan_installments(*)').eq('id', id).maybeSingle(),
        supabase.from('vehicles').select('*').eq(esVenta ? 'sale_id' : 'loan_id', id).limit(1),
      ]);
      if (!vigente) return;
      const c: any = cuenta.data;
      const v: any = motos.data?.[0];
      if (cuenta.error || !c) { setError('No se encontró la cuenta.'); return; }
      if (!v) { setError('Esta cuenta no tiene una moto enlazada: el contrato es para ventas y préstamos con moto.'); return; }
      const cliente = c.customers ?? {};
      const { data: garantes } = await supabase.from('customer_guarantors').select('name, id_doc, phone').eq('customer_id', c.customer_id).order('created_at');
      if (!vigente) return;

      const fd = c.financing_details ?? {};
      const cuotas: any[] = (esVenta ? c.financing_installments : c.loan_installments) ?? [];
      const primeraDelPlan = esVenta ? Number(fd.firstInstallment ?? 1) : 1;
      const plan: CuotaDelPlan[] = cuotas
        .filter((x) => x.installment_number >= primeraDelPlan)
        .sort((a, b) => a.installment_number - b.installment_number)
        .map((x) => ({ numero: x.installment_number, fecha: dia(x.due_date), monto: Number(x.amount) }));
      const frecuencia = esVenta ? (fd.frequency ?? 'monthly') : c.payment_frequency;
      const tasa = esVenta ? fd.interestRate : c.interest_rate;

      setDatos({
        plan,
        valores: {
          'cliente.nombre': cliente.name, 'cliente.cedula': cliente.rnc, 'cliente.direccion': cliente.collection_address || cliente.address,
          'cliente.telefono': cliente.phone,
          'vehiculo.marca': v.brand, 'vehiculo.modelo': v.model, 'vehiculo.año': v.year ? String(v.year) : undefined,
          'vehiculo.color': v.color, 'vehiculo.chasis': v.chassis, 'vehiculo.motor': v.engine_number, 'vehiculo.placa': v.plate,
          'vehiculo.matricula': v.registration_number,
          monto: montoRD(esVenta ? Number(c.total) : Number(c.principal)),
          inicial: esVenta ? montoRD(fd.downPayment != null ? Number(fd.downPayment) : undefined) : undefined,
          cuotas: plan.length ? String(plan.length) : (esVenta ? fd.installments : c.installments_count)?.toString(),
          frecuencia: FRECUENCIA[frecuencia] ?? '',
          cuota: montoRD(plan[0]?.monto ?? (esVenta ? fd.installmentAmount : undefined)),
          tasa: tasa != null ? `${Number(tasa)}%` : undefined,
          total: montoRD(esVenta ? Number(fd.totalWithInterest ?? c.total) : Number(c.total_with_interest)),
          primera_cuota: plan[0]?.fecha,
          garantes: garantesComoTexto((garantes ?? []).map((g: any) => ({ name: g.name, idDoc: g.id_doc ?? undefined, phone: g.phone ?? undefined }))),
        },
      });
    })();
    return () => { vigente = false; };
  }, [id, tipo]);

  const segmentos = useMemo(() => {
    if (!datos || cargandoAjustes) return null;
    const plantilla = (tipo === 'venta' ? ajustes.contractSale : ajustes.contractLoan) ?? CONTRATO_BASE[tipo];
    return llenarContrato(plantilla, {
      ...datos.valores,
      'empresa.nombre': profile.name, 'empresa.rnc': profile.rnc, 'empresa.direccion': profile.address,
      'empresa.telefono': profile.phone,
      fecha: new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' }),
    });
  }, [datos, cargandoAjustes, tipo, ajustes.contractSale, ajustes.contractLoan, profile.name, profile.rnc, profile.address, profile.phone]);

  return (
    <div>
      <PageHeader title={tipo === 'venta' ? 'Contrato de venta condicional' : 'Contrato de préstamo con garantía'}>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.history.back()}><ArrowLeft className="mr-2 h-4 w-4" /> Volver</Button>
          <Button onClick={imprimir} disabled={!segmentos}><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>
        </div>
      </PageHeader>
      {error ? (
        <p className="text-muted-foreground">{error}</p>
      ) : !segmentos ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : (
        <Card className="mx-auto max-w-[8.5in]">
          <CardContent className="bg-white p-0 text-black">
            <ContratoDocumento ref={printRef} segmentos={segmentos} plan={datos?.plan ?? []} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
