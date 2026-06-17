'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Branch } from '@/lib/types';
import { BranchActions } from './branch-actions';

export const branchColumns: ColumnDef<Branch>[] = [
  {
    accessorKey: 'name',
    header: 'Nombre',
  },
  {
    accessorKey: 'location',
    header: 'Ubicación',
  },
  {
    id: 'actions',
    cell: ({ row }) => <BranchActions branch={row.original} />,
  },
];
