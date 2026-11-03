'use client';

import { Suspense, useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/auth-provider';
import { addDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { AlertTriangle, Calendar as CalendarIcon, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { useBranches } from '@/context/branch-provider';
import { SalesDataTable } from '@/components/sales/sales-data-table';
import { salesColumns } from '@/components/sales/sales-columns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ecfConProblema } from '@/lib/ecf';

// La página se exporta estática y useSearchParams necesita su Suspense.
export default function SalesPage() {
  return (
    <Suspense>
      <SalesContent />
    </Suspense>
  );
}

function SalesContent() {
  const { sales } = useSales();
  const { branches } = useBranches();
  const { appUser } = useAuth();
  const router = useRouter();

  // El filtro vive en la URL (?filtro=ecf-problemas) para que el aviso de
  // comprobantes con problemas pueda llevar directo a la lista filtrada, aun
  // estando ya en Movimientos.
  const soloProblemasEcf = useSearchParams().get('filtro') === 'ecf-problemas';
  const alternarProblemasEcf = () => router.replace(soloProblemasEcf ? '/sales' : '/sales?filtro=ecf-problemas');
  // El botón sale solo si hay e-CF en la lista (o ya está puesto el filtro,
  // para poder quitarlo): una empresa sin e-CF no ve nada nuevo.
  const hayEcf = useMemo(() => sales.some((sale) => !!sale.ecf), [sales]);

  // Rol y sucursal desde el contexto (rol de la empresa activa), no de
  // localStorage: al cambiar de empresa el rol puede ser distinto.
  const userRole = appUser?.role ?? null;
  const userBranch = appUser?.branch ?? null;

  const [selectedBranch, setSelectedBranch] = useState('all');
  const [date, setDate] = useState<DateRange | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (userRole !== 'admin' && userBranch) {
      setSelectedBranch(userBranch);
    }
  }, [userRole, userBranch]);

  const filteredSales = useMemo(() => {
    let filtered = sales;

    // Filter by branch
    if (selectedBranch === 'all') {
      if (userRole !== 'admin') {
        filtered = filtered.filter(sale => sale.branchId === userBranch);
      }
    } else {
      filtered = filtered.filter(sale => sale.branchId === selectedBranch);
    }

    // Filter by date range
    if (date?.from && date.to) {
      const fromDate = new Date(date.from);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = new Date(date.to);
      toDate.setHours(23, 59, 59, 999);

      filtered = filtered.filter(sale => {
        const saleDate = new Date(sale.createdAt);
        return saleDate >= fromDate && saleDate <= toDate;
      });
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(sale =>
        sale.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Solo los e-CF que una persona tiene que resolver (rechazado, con error, sin cupo)
    if (soloProblemasEcf) {
      filtered = filtered.filter(sale => ecfConProblema(sale.ecf?.estado));
    }

    return filtered;
  }, [sales, selectedBranch, userRole, userBranch, date, searchTerm, soloProblemasEcf]);

  return (
    <div>
      {/* "Movimientos" y no "Historial de Ventas": la tabla lista tambien las
          anuladas, las de credito y las financiadas, no solo ventas cobradas.
          Es ademas el texto que ya llevaba el boton del menu lateral. */}
      <PageHeader title="Movimientos" />
      
      <div className="flex flex-col sm:flex-row gap-4 mb-6 items-center">
        <div className="relative w-full sm:w-auto sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por ID de venta..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value.replace(/'/g, '-'))}
            className="pl-9 w-full"
          />
        </div>
        {userRole === 'admin' && (
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-full sm:w-auto sm:min-w-[240px]">
                  <SelectValue placeholder="Filtrar por sucursal" />
              </SelectTrigger>
              <SelectContent>
                  <SelectItem value="all">Todas las sucursales</SelectItem>
                  {branches.map(branch => (
                      <SelectItem key={branch.id} value={branch.name}>{branch.name}</SelectItem>
                  ))}
              </SelectContent>
          </Select>
        )}
        <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant={'outline'}
                className={cn(
                  'w-full sm:w-auto sm:min-w-[300px] justify-start text-left font-normal',
                  !date && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, 'LLL dd, y', { locale: es })} -{' '}
                      {format(date.to, 'LLL dd, y', { locale: es })}
                    </>
                  ) : (
                    format(date.from, 'LLL dd, y', { locale: es })
                  )
                ) : (
                  <span>Selecciona un rango</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={setDate}
                numberOfMonths={2}
                locale={es}
              />
            </PopoverContent>
          </Popover>
          {date && (
            <Button variant="ghost" onClick={() => setDate(undefined)}>Limpiar</Button>
          )}
          {(hayEcf || soloProblemasEcf) && (
            <Button
              variant={soloProblemasEcf ? 'default' : 'outline'}
              aria-pressed={soloProblemasEcf}
              onClick={alternarProblemasEcf}
              className="w-full sm:w-auto"
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Con problemas e-CF
            </Button>
          )}
      </div>


      <SalesDataTable columns={salesColumns} data={filteredSales} />
    </div>
  );
}
