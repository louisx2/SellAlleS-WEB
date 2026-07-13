import { ColumnDef } from '@tanstack/react-table';
import { ServiceType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, Pencil, Trash } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ServiceTypeDialog } from './service-type-dialog';

export const ServiceTypeActions = ({ serviceType, onUpdate, onDelete }: { serviceType: ServiceType, onUpdate: () => void, onDelete: (id: string) => void }) => {
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
                <ServiceTypeDialog serviceType={serviceType} onSuccess={onUpdate}>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                        <Pencil className="mr-2 h-4 w-4" /> Editar
                    </DropdownMenuItem>
                </ServiceTypeDialog>
                <DropdownMenuItem onClick={() => onDelete(serviceType.id)} className="text-destructive focus:text-destructive">
                    <Trash className="mr-2 h-4 w-4" /> Eliminar
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export const createServiceTypeColumns = (onUpdate: () => void, onDelete: (id: string) => void): ColumnDef<ServiceType>[] => [
  {
    accessorKey: 'name',
    header: 'Nombre',
  },
  {
    accessorKey: 'description',
    header: 'Descripción',
  },
  {
    accessorKey: 'basePrice',
    header: 'Precio Base',
    cell: ({ row }) => {
        const amount = parseFloat(row.getValue('basePrice'));
        const formatted = new Intl.NumberFormat('es-DO', {
          style: 'currency',
          currency: 'DOP',
        }).format(amount);
        return <div className="font-medium">{formatted}</div>;
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => <ServiceTypeActions serviceType={row.original} onUpdate={onUpdate} onDelete={onDelete} />,
  },
];
