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
}

export function SupplierDataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [filterType, setFilterType] = useState<'name' | 'rnc'>('name');
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

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    if (filterType === 'name') {
      table.getColumn('rnc')?.setFilterValue('');
      table.getColumn('name')?.setFilterValue(value);
    } else {
      table.getColumn('name')?.setFilterValue('');
      table.getColumn('rnc')?.setFilterValue(value);
    }
  };

  const handleFilterTypeChange = (type: 'name' | 'rnc') => {
    setFilterType(type);
    if (type === 'name') {
      table.getColumn('rnc')?.setFilterValue('');
      table.getColumn('name')?.setFilterValue(searchValue);
    } else {
      table.getColumn('name')?.setFilterValue('');
      table.getColumn('rnc')?.setFilterValue(searchValue);
    }
  };

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-2 p-4 max-w-md">
        <Input
          placeholder={filterType === 'name' ? 'Buscar por nombre...' : 'Buscar por RNC...'}
          value={searchValue}
          onChange={(event) => handleSearchChange(event.target.value)}
          className="flex-1"
        />
        <Select value={filterType} onValueChange={(v) => handleFilterTypeChange(v as 'name' | 'rnc')}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Filtrar por" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Nombre</SelectItem>
            <SelectItem value="rnc">RNC</SelectItem>
          </SelectContent>
        </Select>
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
                No hay proveedores para mostrar.
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
