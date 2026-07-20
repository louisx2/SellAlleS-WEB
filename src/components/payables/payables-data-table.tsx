'use client';

import { useState } from 'react';
import type {
  ColumnDef,
  SortingState,
  ColumnFiltersState,
} from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Empresas informales no ven NCF: se oculta también como filtro. */
  showNcfFilter?: boolean;
}

export function PayablesDataTable<TData, TValue>({
  columns,
  data,
  showNcfFilter = true,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [filterType, setFilterType] = useState<'supplier' | 'ncf'>('supplier');
  const [searchValue, setSearchValue] = useState('');

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
    },
  });

  const applyFilter = (type: 'supplier' | 'ncf', value: string) => {
    table.getColumn(type === 'supplier' ? 'ncf' : 'supplier')?.setFilterValue('');
    table.getColumn(type)?.setFilterValue(value);
  };

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    applyFilter(filterType, value);
  };

  const handleFilterTypeChange = (type: 'supplier' | 'ncf') => {
    setFilterType(type);
    applyFilter(type, searchValue);
  };

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-2 p-4 max-w-md">
        <Input
          placeholder={filterType === 'supplier' ? 'Buscar por suplidor...' : 'Buscar por NCF...'}
          value={searchValue}
          onChange={(event) => handleSearchChange(event.target.value)}
          className="flex-1"
        />
        {showNcfFilter && (
          <Select value={filterType} onValueChange={(v) => handleFilterTypeChange(v as 'supplier' | 'ncf')}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filtrar por" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="supplier">Suplidor</SelectItem>
              <SelectItem value="ncf">NCF</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No hay facturas para mostrar.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
       <div className="flex items-center justify-end space-x-2 p-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
