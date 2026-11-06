'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, RefreshCw } from 'lucide-react';
import {
  ECF_AMBIENTE_NOMBRE, ECF_ESTADO_CONFIG_NOMBRE,
  certificadoPorVencer, cupoPorAgotarse, diasParaVencer, fechaDMA, mayorUsoDeCupo, porcentajeDeUso,
  type AmbienteEcf, type EstadoEcfConfig,
} from '@/lib/ecf';
import { PLANES_MSELLER, type PlanMseller } from '@/lib/ecf-planes';
import { cn } from '@/lib/utils';

// Una fila de ecf_resumen_plataforma(): el uso es el del mes en curso en UTC,
// que es cuando MSeller reinicia el cupo.
interface FilaResumen {
  company_id: string;
  empresa: string;
  estado: EstadoEcfConfig;
  ambiente: AmbienteEcf;
  plan: PlanMseller;
  cupo_comprobantes: number;
  cupo_requests: number;
  comprobantes: number;
  requests: number;
  pendientes: number;
  problemas: number;
  certificado_vence: string | null;
}

const ESTADO_VARIANT: Record<EstadoEcfConfig, 'default' | 'secondary' | 'destructive'> = {
  preparacion: 'secondary',
  activa: 'default',
  suspendida: 'destructive',
};

const numero = (n: number) => n.toLocaleString('es-DO');

// Uso de un cupo: "usado / cupo (xx%)", con el porcentaje en rojo desde el 80 %.
// Se muestra hacia abajo: 79,6 % se ve 79 %, y no se pinta de rojo.
function CeldaUso({ usado, cupo }: { usado: number; cupo: number }) {
  const pct = porcentajeDeUso(usado, cupo);
  return (
    <span className="whitespace-nowrap">
      {numero(usado)} / {numero(cupo)}{' '}
      <span className={cn('text-xs', cupoPorAgotarse(pct) ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
        ({Math.floor(pct)}%)
      </span>
    </span>
  );
}

function CeldaCertificado({ vence, hoy }: { vence: string | null; hoy: string }) {
  if (!vence) return <span className="text-muted-foreground">—</span>;
  const dias = diasParaVencer(vence, hoy);
  const pronto = certificadoPorVencer(vence, hoy);
  return (
    <span className={cn('whitespace-nowrap', pronto && 'font-semibold text-destructive')}>
      {fechaDMA(vence)}
      {dias !== null && dias < 0 && ' (vencido)'}
      {dias !== null && dias >= 0 && pronto && ` (faltan ${dias} día${dias === 1 ? '' : 's'})`}
    </span>
  );
}

// Todas las empresas con facturación electrónica: su estado, el uso del mes
// contra su cupo, lo pendiente, lo que dio problemas y cuándo vence el
// certificado. La más apretada de cupo va arriba.
export default function FacturacionElectronicaPage() {
  const { appUser } = useAuth();
  const esSuperAdmin = !!appUser?.isSuperAdmin;
  // La base comprueba is_super_admin(), que es falso mientras el super admin
  // está dentro de una empresa: ahí el resumen no se puede pedir.
  const dentroDeEmpresa = !!appUser?.impersonatedCompanyId;

  const [filas, setFilas] = useState<FilaResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: err } = await supabase.rpc('ecf_resumen_plataforma');
    if (err) {
      setError(err.message);
      setFilas([]);
    } else {
      setError(null);
      setFilas((data ?? []) as FilaResumen[]);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    if (esSuperAdmin && !dentroDeEmpresa) cargar();
  }, [esSuperAdmin, dentroDeEmpresa, cargar]);

  // El mayor % de los dos cupos, de más lleno a menos. El orden es estable: a
  // igual uso queda el orden por nombre con que llega de la base.
  const ordenadas = useMemo(
    () =>
      filas
        .map((f) => ({ ...f, uso: mayorUsoDeCupo(f.comprobantes, f.cupo_comprobantes, f.requests, f.cupo_requests) }))
        .sort((a, b) => b.uso - a.uso),
    [filas],
  );

  if (!esSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Shield className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Solo para administradores de la plataforma</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Aquí se sigue la facturación electrónica de todas las empresas.
        </p>
      </div>
    );
  }

  if (dentroDeEmpresa) {
    return (
      <>
        <PageHeader title="Facturación electrónica" />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Estás dentro de una empresa. Sal de ella para ver el resumen de la plataforma.
          </CardContent>
        </Card>
      </>
    );
  }

  const hoy = new Date().toLocaleDateString('en-CA');

  return (
    <>
      <PageHeader title="Facturación electrónica">
        <Button variant="outline" size="icon" onClick={cargar} disabled={cargando} title="Actualizar">
          <RefreshCw className={cn('h-4 w-4', cargando && 'animate-spin')} />
        </Button>
      </PageHeader>

      <p className="mb-4 text-sm text-muted-foreground">
        Uso del mes en curso (UTC) contra el cupo de cada empresa, de la que más cupo lleva usado a la que
        menos. El porcentaje se pone en rojo desde el 80 % y el certificado cuando faltan 30 días o menos.
      </p>

      <Card>
        <CardContent className="p-0">
          {cargando ? (
            <p className="text-sm text-muted-foreground py-10 text-center">Cargando…</p>
          ) : error ? (
            <p className="text-sm text-destructive py-10 text-center">
              No se pudo cargar el resumen: {error}
            </p>
          ) : ordenadas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Ninguna empresa tiene todavía la facturación electrónica configurada. Se prepara desde
              Empresas, en la acción &quot;Facturación electrónica&quot; de cada fila.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Ambiente</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Comprobantes</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead className="text-right">Pendientes</TableHead>
                  <TableHead className="text-right">Con problemas</TableHead>
                  <TableHead>Certificado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenadas.map((f) => (
                  <TableRow key={f.company_id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/empresas?ecf=${f.company_id}`}
                        className="underline-offset-4 hover:underline"
                        title="Abrir la facturación electrónica de la empresa"
                      >
                        {f.empresa}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ESTADO_VARIANT[f.estado]}>{ECF_ESTADO_CONFIG_NOMBRE[f.estado]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{ECF_AMBIENTE_NOMBRE[f.ambiente]}</TableCell>
                    <TableCell className="text-sm">{PLANES_MSELLER[f.plan]?.nombre ?? f.plan}</TableCell>
                    <TableCell className="text-sm"><CeldaUso usado={f.comprobantes} cupo={f.cupo_comprobantes} /></TableCell>
                    <TableCell className="text-sm"><CeldaUso usado={f.requests} cupo={f.cupo_requests} /></TableCell>
                    <TableCell className="text-right text-sm">{f.pendientes}</TableCell>
                    <TableCell className={cn('text-right text-sm', f.problemas > 0 && 'font-semibold text-destructive')}>
                      {f.problemas}
                    </TableCell>
                    <TableCell className="text-sm"><CeldaCertificado vence={f.certificado_vence} hoy={hoy} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
