'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export interface BranchChecklistOption {
  id: string;
  name: string;
}

interface BranchChecklistProps {
  branches: BranchChecklistOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  idPrefix?: string;
}

// Checklist simple de sucursales: reemplaza el patrón anterior de "sucursal
// principal + sucursales adicionales" — el admin solo marca a cuáles tiene
// acceso este usuario, sin tener que pensar en cuál es "la principal".
export function BranchChecklist({ branches, selectedIds, onChange, idPrefix = 'branch' }: BranchChecklistProps) {
  const allChecked = branches.length > 0 && branches.every((b) => selectedIds.includes(b.id));

  const toggleAll = (checked: boolean) => {
    onChange(checked ? branches.map((b) => b.id) : []);
  };

  const toggleOne = (id: string, checked: boolean) => {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((x) => x !== id));
  };

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta empresa no tiene sucursales todavía.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {branches.length > 1 && (
        <div className="flex items-center space-x-2">
          <Checkbox id={`${idPrefix}-all`} checked={allChecked} onCheckedChange={(c) => toggleAll(!!c)} />
          <Label htmlFor={`${idPrefix}-all`} className="font-semibold cursor-pointer">Todas las sucursales</Label>
        </div>
      )}
      <div className="flex flex-col gap-2 pl-1">
        {branches.map((b) => (
          <div key={b.id} className="flex items-center space-x-2">
            <Checkbox
              id={`${idPrefix}-${b.id}`}
              checked={selectedIds.includes(b.id)}
              onCheckedChange={(c) => toggleOne(b.id, !!c)}
            />
            <Label htmlFor={`${idPrefix}-${b.id}`} className="font-normal cursor-pointer">{b.name}</Label>
          </div>
        ))}
      </div>
    </div>
  );
}
