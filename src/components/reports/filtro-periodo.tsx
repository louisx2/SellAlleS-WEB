'use client';

import * as React from 'react';
import { format, subDays, startOfMonth, startOfYear } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';

/** Atajos de rango: lo que más se pide sin abrir el calendario. */
const ATAJOS: { label: string; rango: () => DateRange }[] = [
  { label: 'Este mes', rango: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: '30 días', rango: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: '90 días', rango: () => ({ from: subDays(new Date(), 90), to: new Date() }) },
  { label: 'Este año', rango: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

export const rangoMesActual = (): DateRange => ({ from: startOfMonth(new Date()), to: new Date() });

/**
 * Rango de fechas y sucursal de los reportes. Quien no es admin queda en su
 * sucursal activa (la RLS ya se lo impone; esto evita que el selector prometa
 * algo que la base va a negar). `branchId` es el uuid o 'all'.
 */
export function useFiltroSucursal() {
  const { appUser } = useAuth();
  const esAdmin = appUser?.role === 'admin';
  const [branchId, setBranchId] = React.useState('all');
  React.useEffect(() => {
    if (!esAdmin && appUser?.activeBranchId) setBranchId(appUser.activeBranchId);
  }, [esAdmin, appUser?.activeBranchId]);
  return { branchId, setBranchId, esAdmin };
}

export function FiltroPeriodo({
  rango,
  onRango,
  branchId,
  onBranch,
  esAdmin,
}: {
  rango: DateRange | undefined;
  onRango: (r: DateRange | undefined) => void;
  branchId: string;
  onBranch: (id: string) => void;
  esAdmin: boolean;
}) {
  const { branches } = useBranches();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {esAdmin && (
        <Select value={branchId} onValueChange={onBranch}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Sucursal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sucursales</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn('w-[260px] justify-start text-left font-normal', !rango && 'text-muted-foreground')}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {rango?.from ? (
              rango.to ? (
                <>
                  {format(rango.from, 'd LLL y', { locale: es })} – {format(rango.to, 'd LLL y', { locale: es })}
                </>
              ) : (
                format(rango.from, 'd LLL y', { locale: es })
              )
            ) : (
              <span>Elige un rango</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <div className="flex flex-wrap gap-1 border-b p-2">
            {ATAJOS.map((a) => (
              <Button key={a.label} size="sm" variant="ghost" onClick={() => onRango(a.rango())}>
                {a.label}
              </Button>
            ))}
          </div>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={rango?.from}
            selected={rango}
            onSelect={onRango}
            numberOfMonths={2}
            locale={es}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
