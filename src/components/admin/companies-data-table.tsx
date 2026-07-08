'use client';

import { useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Store, Pencil, Boxes, LogIn, ChevronDown, ChevronRight, Search, Filter } from 'lucide-react';
import type { Company } from '@/lib/types';

interface CompaniesDataTableProps {
  companies: Company[];
  loading: boolean;
  onEditCompany: (c: Company) => void;
  onModulesCompany: (c: Company) => void;
  onEnterCompany: (c: Company) => void;
  onEnterBranch: (companyId: string, companyName: string, branchId: string, branchName: string) => void;
  onEditBranch: (b: { id: string; name: string; location: string; companyId: string }) => void;
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
  getPlanName,
}: CompaniesDataTableProps) {
  const [expandedCompanies, setExpandedCompanies] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const toggleCompany = (id: string) => {
    setExpandedCompanies(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const filteredCompanies = companies.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || 
                          (c.rnc && c.rnc.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

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
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-muted-foreground hidden sm:block" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px] bg-muted/50 border-transparent focus:bg-background">
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
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-[300px]">Empresa / Sucursales</TableHead>
              <TableHead>RNC</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fiscal</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Acciones (Empresa)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Cargando empresas...</TableCell></TableRow>
            ) : filteredCompanies.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No se encontraron empresas.</TableCell></TableRow>
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
                      <span className="text-base">{c.name}</span>
                    </div>
                    
                    {expandedCompanies.includes(c.id) && (
                      <div className="pl-11 mt-3 flex flex-col gap-2 text-xs font-normal">
                        {c.branches && c.branches.length > 0 ? (
                          c.branches.map(b => (
                            <div key={b.id} className="flex items-center justify-between bg-muted/40 hover:bg-muted/60 transition-colors p-2 rounded-md pr-3 border border-border/50">
                              <div className="flex items-center gap-2">
                                <Store className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">{b.name === 'Principal' ? 'Sucursal Principal' : `Sucursal ${b.name}`}</span>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 px-2 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); onEditBranch({ id: b.id, name: b.name, location: b.location ?? '', companyId: c.id }); }}
                                >
                                  <Pencil className="mr-1 h-3 w-3" /> Editar
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 px-2 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); onModulesCompany(c); }}
                                >
                                  <Boxes className="mr-1 h-3 w-3" /> Módulos
                                </Button>
                                <Button 
                                  variant="secondary" 
                                  size="sm" 
                                  className="h-7 px-3 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); onEnterBranch(c.id, c.name, b.id, b.name); }}
                                >
                                  <LogIn className="mr-1 h-3 w-3" /> Entrar
                                </Button>
                              </div>
                            </div>
                          ))
                        ) : (
                           <div className="flex items-center justify-between bg-muted/40 hover:bg-muted/60 transition-colors p-2 rounded-md pr-3 border border-border/50">
                              <div className="flex items-center gap-2">
                                <Store className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">Sucursal Principal</span>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 px-2 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); onModulesCompany(c); }}
                                >
                                  <Boxes className="mr-1 h-3 w-3" /> Módulos
                                </Button>
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
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top py-4">
                    {c.rnc ? <span className="font-mono text-sm">{c.rnc}</span> : <span className="text-muted-foreground text-sm">—</span>}
                  </TableCell>
                  <TableCell className="align-top py-4">
                    <Badge variant={STATUS_VARIANT[c.status]} className="shadow-sm">{STATUS_LABEL[c.status]}</Badge>
                  </TableCell>
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
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onEditCompany(c)} title="Editar Empresa">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onModulesCompany(c)} title="Módulos">
                        <Boxes className="h-4 w-4" />
                      </Button>
                      <Button variant="default" size="sm" className="h-8" onClick={() => onEnterCompany(c)}>
                        <LogIn className="mr-2 h-4 w-4" /> Entrar
                      </Button>
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
