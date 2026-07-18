'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/context/auth-provider';
import { addDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon, Search } from 'lucide-react';
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

export default function SalesPage() {
  const { sales } = useSales();
  const { branches } = useBranches();
  const { appUser } = useAuth();

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

    return filtered;
  }, [sales, selectedBranch, userRole, userBranch, date, searchTerm]);

  return (
    <div>
      <PageHeader title="Historial de Ventas" />
      
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
      </div>


      <SalesDataTable columns={salesColumns} data={filteredSales} />
    </div>
  );
}
