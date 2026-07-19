'use client';

import { useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Building2, Store, Pencil, Boxes, LogIn, ChevronDown, ChevronRight, Search, Filter,
  Ban, Power, Trash2, MoreHorizontal, Users, PlusCircle, Receipt, Shield,
} from 'lucide-react';
import type { Company } from '@/lib/types';
import { BUSINESS_TYPE_PRESETS, type BusinessType } from '@/lib/business-types';
import { useAuth } from '@/context/auth-provider';

const getSectorLabel = (type: string | null | undefined): string => {
  if (!type) return 'No especificado';
  const preset = BUSINESS_TYPE_PRESETS[type as BusinessType];
  return preset ? preset.label : type;
};

interface CompaniesDataTableProps {
  companies: Company[];
  loading: boolean;
  onEditCompany: (c: Company) => void;
  onModulesCompany: (c: Company) => void;
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
  getPlanName: (companyId: string) => string;
}

const STATUS_LABEL: Record<string, string> = { trial: 'Prueba', active: 'Activa', suspended: 'Suspendida' };
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  active: 'default', trial: 'secondary', suspended: 'destructive',
};

export function CompaniesDataTable({
  companies,
  loading,
  onEditCompany,
  onModulesCompany,
  onEnterCompany,
  onEnterBranch,
  onEditBranch,
  onToggleStatus,
  onDeleteCompany,
  onDeleteBranch,
  onAddBranch,
  onManageUsers,
  onManagePayments,
  onManageRoles,
  onToggleBranchStatus,
  getPlanName,
}: CompaniesDataTableProps) {
  const { appUser } = useAuth();
  const [expandedCompanies, setExpandedCompanies] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'real' | 'demo'>('all');

  const toggleCompany = (id: string) => {
    setExpandedCompanies(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const filteredCompanies = companies.filter(c => {
    const planName = getPlanName(c.id).toLowerCase();
    const sectorLabel = getSectorLabel(c.business_type).toLowerCase();
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
                          (c.rnc && c.rnc.toLowerCase().includes(search.toLowerCase())) ||
                          (c.phone && c.phone.toLowerCase().includes(search.toLowerCase())) ||
                          sectorLabel.includes(search.toLowerCase()) ||
                          planName.includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchesType = typeFilter === 'all' || 
                        (typeFilter === 'real' && !c.is_demo) || 
                        (typeFilter === 'demo' && c.is_demo);
    return matchesSearch && matchesStatus && matchesType;
  });

  const columnCount = appUser?.isSuperAdmin ? 6 : 5;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar empresa o RNC..."
            className="pl-9 bg-muted/50 border-transparent focus-visible:bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* Filtros de Tipo/Estado (real vs. demo, prueba/activa/suspendida) son
            metadata de administración de la plataforma SaaS — solo tienen
            sentido para el super admin gestionando muchos tenants, no para un
            dueño de negocio viendo sus propias empresas. */}
        {appUser?.isSuperAdmin && (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Filter className="h-4 w-4 text-muted-foreground hidden sm:block" />
            <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
              <SelectTrigger className="w-full sm:w-[150px] bg-muted/50 border-transparent focus:bg-background">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="real">Solo Reales</SelectItem>
                <SelectItem value="demo">Solo Demos</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px] bg-muted/50 border-transparent focus:bg-background">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="active">Activas</SelectItem>
                <SelectItem value="trial">En Prueba</SelectItem>
                <SelectItem value="suspended">Suspendidas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-[300px]">Empresa / Sucursales</TableHead>
              <TableHead>RNC</TableHead>
              {appUser?.isSuperAdmin && <TableHead>Estado</TableHead>}
              <TableHead>Fiscal</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={columnCount} className="text-center py-12 text-muted-foreground">Cargando empresas...</TableCell></TableRow>
            ) : filteredCompanies.length === 0 ? (
              <TableRow><TableCell colSpan={columnCount} className="text-center py-12 text-muted-foreground">No se encontraron empresas.</TableCell></TableRow>
            ) : (
              filteredCompanies.map((c) => (
                <TableRow key={c.id} className="group hover:bg-muted/10 transition-colors">
                  <TableCell className="font-medium align-top py-4">
                    <div
                      className="flex items-center gap-2 cursor-pointer hover:text-primary transition-colors select-none"
                      onClick={() => toggleCompany(c.id)}
                    >
                      {expandedCompanies.includes(c.id) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold">{c.name}</span>
                          {c.is_demo && appUser?.isSuperAdmin && (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] py-0 px-1.5 h-5 font-bold uppercase tracking-wider">
                              Demo
                            </Badge>
                          )}
                          {!appUser?.isSuperAdmin && appUser?.companies?.some((uc) => uc.id === c.id) && (
                            appUser.companies.find((uc) => uc.id === c.id)!.role === 'admin' ? (
                              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px] py-0 px-1.5 h-5 font-semibold">
                                Administrador
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px] py-0 px-1.5 h-5 font-semibold">
                                Cajero
                              </Badge>
                            )
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground font-normal">
                          Sector: {getSectorLabel(c.business_type)}
                        </span>
                      </div>
                    </div>

                    {expandedCompanies.includes(c.id) && (
                      <div className="pl-11 mt-3 flex flex-col gap-2 text-xs font-normal">
                        {c.branches && c.branches.length > 0 ? (
                          c.branches.map(b => (
                            <div key={b.id} className="flex items-center justify-between bg-muted/40 hover:bg-muted/60 transition-colors p-2 rounded-md pr-3 border border-border/50">
                              <div className="flex items-center gap-2">
                                <Store className="h-4 w-4 text-muted-foreground" />
                                <span className={`font-medium ${!b.is_active ? 'text-muted-foreground line-through' : ''}`}>
                                  {b.name === 'Principal' ? 'Sucursal Principal' : `Sucursal ${b.name}`}
                                </span>
                                {!b.is_active && (
                                  <Badge variant="destructive" className="text-[10px] h-4 px-1">Inactiva</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 px-3 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); onEnterBranch(c.id, c.name, b.id, b.name); }}
                                >
                                  <LogIn className="mr-1 h-3 w-3" /> Entrar
                                </Button>
                                {appUser?.isSuperAdmin && (
                                  <DropdownMenu modal={false}>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                      <DropdownMenuItem onClick={() => onEditBranch({ id: b.id, name: b.name, location: b.location ?? '', companyId: c.id })}>
                                        <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                                      </DropdownMenuItem>
                                      {onManageUsers && (
                                        <DropdownMenuItem onClick={() => onManageUsers(c)}>
                                          <Users className="mr-2 h-3.5 w-3.5" /> Gestionar usuarios
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem onClick={() => onModulesCompany(c)}>
                                        <Boxes className="mr-2 h-3.5 w-3.5" /> Módulos
                                      </DropdownMenuItem>
                                      {onToggleBranchStatus && (
                                        <DropdownMenuItem onClick={() => onToggleBranchStatus({ id: b.id, name: b.name, isActive: b.is_active })}>
                                          {b.is_active ? (
                                            <><Ban className="mr-2 h-3.5 w-3.5 text-destructive" /> Desactivar sucursal</>
                                          ) : (
                                            <><Power className="mr-2 h-3.5 w-3.5 text-emerald-600" /> Reactivar sucursal</>
                                          )}
                                        </DropdownMenuItem>
                                      )}
                                      {onDeleteBranch && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            className="text-destructive focus:text-destructive"
                                            onClick={() => onDeleteBranch({ id: b.id, name: b.name, companyId: c.id })}
                                          >
                                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Eliminar sucursal
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                           <div className="flex items-center justify-between bg-muted/40 hover:bg-muted/60 transition-colors p-2 rounded-md pr-3 border border-border/50">
                              <div className="flex items-center gap-2">
                                <Store className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">Sin sucursales</span>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 px-3 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); onEnterCompany(c); }}
                                >
                                  <LogIn className="mr-1 h-3 w-3" /> Entrar
                                </Button>
                              </div>
                            </div>
                        )}
                        {onAddBranch && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] w-fit text-muted-foreground hover:text-foreground"
                            onClick={(e) => { e.stopPropagation(); onAddBranch(c); }}
                          >
                            <PlusCircle className="mr-1 h-3 w-3" /> Agregar sucursal
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top py-4">
                    {c.rnc ? <span className="font-mono text-sm">{c.rnc}</span> : <span className="text-muted-foreground text-sm">—</span>}
                  </TableCell>
                  {appUser?.isSuperAdmin && (
                    <TableCell className="align-top py-4">
                      <Badge variant={STATUS_VARIANT[c.status]} className="shadow-sm">{STATUS_LABEL[c.status]}</Badge>
                    </TableCell>
                  )}
                  <TableCell className="align-top py-4">
                    <div className="flex flex-col gap-1 text-xs">
                       <span className={c.is_formalized ? "text-emerald-600 font-medium" : "text-muted-foreground"}>
                         {c.is_formalized ? 'Formalizada' : 'Informal'}
                       </span>
                       {c.ncf_enabled && (
                         <Badge variant="outline" className="w-fit text-[10px] h-4 px-1 border-primary/30 text-primary bg-primary/5">e-CF Activo</Badge>
                       )}
                    </div>
                  </TableCell>
                  <TableCell className="align-top py-4 text-sm">{getPlanName(c.id)}</TableCell>
                  <TableCell className="text-right align-top py-4">
                    <div className="flex justify-end gap-2">
                      <Button variant="default" size="sm" className="h-8" onClick={() => onEnterCompany(c)}>
                        <LogIn className="mr-2 h-4 w-4" /> Entrar
                      </Button>
                      {appUser?.isSuperAdmin && (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{c.name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onEditCompany(c)}>
                              <Pencil className="mr-2 h-4 w-4" /> Editar empresa
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onModulesCompany(c)}>
                              <Boxes className="mr-2 h-4 w-4" /> Módulos
                            </DropdownMenuItem>
                            {onAddBranch && (
                              <DropdownMenuItem onClick={() => onAddBranch(c)}>
                                <PlusCircle className="mr-2 h-4 w-4" /> Agregar sucursal
                              </DropdownMenuItem>
                            )}
                            {onManageUsers && (
                              <DropdownMenuItem onClick={() => onManageUsers(c)}>
                                <Users className="mr-2 h-4 w-4" /> Gestionar usuarios
                              </DropdownMenuItem>
                            )}
                            {onManagePayments && (
                              <DropdownMenuItem onClick={() => onManagePayments(c)}>
                                <Receipt className="mr-2 h-4 w-4" /> Pagos de suscripción
                              </DropdownMenuItem>
                            )}
                            {onManageRoles && (
                              <DropdownMenuItem onClick={() => onManageRoles(c)}>
                                <Shield className="mr-2 h-4 w-4" /> Gestionar roles
                              </DropdownMenuItem>
                            )}
                            {onToggleStatus && (
                              <>
                                <DropdownMenuSeparator />
                                {c.status === 'suspended' ? (
                                  <DropdownMenuItem onClick={() => onToggleStatus(c)} className="text-emerald-600 focus:text-emerald-700">
                                    <Power className="mr-2 h-4 w-4" /> Reactivar empresa
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => onToggleStatus(c)} className="text-destructive focus:text-destructive">
                                    <Ban className="mr-2 h-4 w-4" /> Desactivar empresa
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}
                            {onDeleteCompany && (
                              <DropdownMenuItem onClick={() => onDeleteCompany(c)} className="text-destructive focus:text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" /> Eliminar empresa
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
