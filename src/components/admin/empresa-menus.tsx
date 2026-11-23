'use client';

// Menús "⋯" de una empresa y de una de sus sucursales en el listado de
// empresas del super admin. Los usan la tabla (companies-data-table) y el panel
// por estado (empresas-panel), para que las dos vistas ofrezcan lo mismo.

import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Ban, Boxes, FileCheck, MoreHorizontal, Pencil, PlusCircle, Power, Receipt, Shield, Trash2, Users,
} from 'lucide-react';
import type { Company } from '@/lib/types';

type Sucursal = NonNullable<Company['branches']>[number];

/** Lo que se puede hacer con una empresa o sus sucursales desde el listado. */
export interface AccionesEmpresa {
  onEditCompany: (c: Company) => void;
  onModulesCompany: (c: Company) => void;
  onEcfCompany?: (c: Company) => void;
  onEnterCompany: (c: Company) => void;
  onEnterBranch: (companyId: string, companyName: string, branchId: string, branchName: string) => void;
  onEditBranch: (b: { id: string; name: string; location: string; companyId: string }) => void;
  onToggleStatus?: (c: Company) => void;
  onDeleteCompany?: (c: Company) => void;
  onDeleteBranch?: (b: { id: string; name: string; companyId: string }) => void;
  onAddBranch?: (c: Company) => void;
  onManageUsers?: (c: Company) => void;
  onManagePayments?: (c: Company) => void;
  onManageRoles?: (c: Company) => void;
  onToggleBranchStatus?: (b: { id: string; name: string; isActive: boolean }) => void;
}

export function MenuEmpresa({ company: c, acciones: a }: { company: Company; acciones: AccionesEmpresa }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label={`Más acciones de ${c.name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{c.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => a.onEditCompany(c)}>
          <Pencil className="mr-2 h-4 w-4" /> Editar empresa
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => a.onModulesCompany(c)}>
          <Boxes className="mr-2 h-4 w-4" /> Módulos
        </DropdownMenuItem>
        {a.onEcfCompany && (
          <DropdownMenuItem onClick={() => a.onEcfCompany!(c)}>
            <FileCheck className="mr-2 h-4 w-4" /> Facturación electrónica
          </DropdownMenuItem>
        )}
        {a.onAddBranch && (
          <DropdownMenuItem onClick={() => a.onAddBranch!(c)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Agregar sucursal
          </DropdownMenuItem>
        )}
        {a.onManageUsers && (
          <DropdownMenuItem onClick={() => a.onManageUsers!(c)}>
            <Users className="mr-2 h-4 w-4" /> Gestionar usuarios
          </DropdownMenuItem>
        )}
        {a.onManagePayments && (
          <DropdownMenuItem onClick={() => a.onManagePayments!(c)}>
            <Receipt className="mr-2 h-4 w-4" /> Pagos de suscripción
          </DropdownMenuItem>
        )}
        {a.onManageRoles && (
          <DropdownMenuItem onClick={() => a.onManageRoles!(c)}>
            <Shield className="mr-2 h-4 w-4" /> Gestionar roles
          </DropdownMenuItem>
        )}
        {a.onToggleStatus && (
          <>
            <DropdownMenuSeparator />
            {c.status === 'suspended' ? (
              <DropdownMenuItem onClick={() => a.onToggleStatus!(c)} className="text-emerald-600 focus:text-emerald-700">
                <Power className="mr-2 h-4 w-4" /> Reactivar empresa
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => a.onToggleStatus!(c)} className="text-destructive focus:text-destructive">
                <Ban className="mr-2 h-4 w-4" /> Suspender empresa
              </DropdownMenuItem>
            )}
          </>
        )}
        {a.onDeleteCompany && (
          <DropdownMenuItem onClick={() => a.onDeleteCompany!(c)} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Eliminar empresa
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MenuSucursal({ company: c, sucursal: b, acciones: a }: {
  company: Company;
  sucursal: Sucursal;
  acciones: AccionesEmpresa;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost" size="icon" className="h-7 w-7"
          aria-label={`Más acciones de ${b.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => a.onEditBranch({ id: b.id, name: b.name, location: b.location ?? '', companyId: c.id })}>
          <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
        </DropdownMenuItem>
        {a.onManageUsers && (
          <DropdownMenuItem onClick={() => a.onManageUsers!(c)}>
            <Users className="mr-2 h-3.5 w-3.5" /> Gestionar usuarios
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => a.onModulesCompany(c)}>
          <Boxes className="mr-2 h-3.5 w-3.5" /> Módulos
        </DropdownMenuItem>
        {a.onToggleBranchStatus && (
          <DropdownMenuItem onClick={() => a.onToggleBranchStatus!({ id: b.id, name: b.name, isActive: b.is_active })}>
            {b.is_active ? (
              <><Ban className="mr-2 h-3.5 w-3.5 text-destructive" /> Desactivar sucursal</>
            ) : (
              <><Power className="mr-2 h-3.5 w-3.5 text-emerald-600" /> Reactivar sucursal</>
            )}
          </DropdownMenuItem>
        )}
        {a.onDeleteBranch && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => a.onDeleteBranch!({ id: b.id, name: b.name, companyId: c.id })}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Eliminar sucursal
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
