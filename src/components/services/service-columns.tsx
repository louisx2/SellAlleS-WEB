import { ColumnDef } from '@tanstack/react-table';
import { Service } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending: { label: 'Pendiente', variant: 'outline' },
    in_progress: { label: 'En Proceso', variant: 'default' },
    completed: { label: 'Completado', variant: 'secondary' },
    cancelled: { label: 'Cancelado', variant: 'destructive' },
};

export const createServiceColumns = (onViewDetails: (service: Service) => void): ColumnDef<Service>[] => [
  {
    accessorKey: 'id',
    header: 'ID',
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.id.split('-')[0]}</span>,
  },
  {
    accessorKey: 'customer',
    header: 'Cliente',
    cell: ({ row }) => row.original.customer?.name || 'Cliente Genérico',
  },
  {
    accessorKey: 'serviceType',
    header: 'Tipo',
    cell: ({ row }) => row.original.serviceType?.name || '-',
  },
  {
    accessorKey: 'assignedUser',
    header: 'Asignado a',
    cell: ({ row }) => row.original.assignedUser?.name || 'Sin Asignar',
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    cell: ({ row }) => {
        const s = statusMap[row.original.status] || { label: row.original.status, variant: 'default' };
        return <Badge variant={s.variant as any}>{s.label}</Badge>;
    }
  },
  {
    accessorKey: 'total',
    header: 'Total',
    cell: ({ row }) => {
        const amount = parseFloat(row.getValue('total') || '0');
        const formatted = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(amount);
        return <div className="font-medium">{formatted}</div>;
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const service = row.original;
      return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <span className="sr-only">Abrir menú</span>
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onViewDetails(service)}>
                    <FileText className="mr-2 h-4 w-4" /> Ver Detalles
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
