'use client';

import { useMemo, useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Store, Pencil, Search, Filter, UserCog } from 'lucide-react';
import type { Company } from '@/lib/types';
import type { PlatformBranch, PlatformUser } from '@/app/(app)/admin/users/page';

interface PlatformUsersTableProps {
  users: PlatformUser[];
  companies: Company[];
  branches: PlatformBranch[];
  loading: boolean;
  onEditUser: (u: PlatformUser) => void;
}

const ALL = 'all';

export function PlatformUsersTable({ users, companies, branches, loading, onEditUser }: PlatformUsersTableProps) {
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>(ALL);
  const [branchFilter, setBranchFilter] = useState<string>(ALL);

  const companyName = useMemo(() => {
    const map: Record<string, string> = {};
    companies.forEach((c) => { map[c.id] = c.name; });
    return map;
  }, [companies]);

  const branchesForFilter = useMemo(
    () => (companyFilter === ALL ? branches : branches.filter((b) => b.companyId === companyFilter)),
    [branches, companyFilter]
  );

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchesCompany = companyFilter === ALL || u.companyId === companyFilter;
    const matchesBranch = branchFilter === ALL || u.branchId === branchFilter;
    return matchesSearch && matchesCompany && matchesBranch;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o email..."
            className="pl-9 bg-muted/50 border-transparent focus-visible:bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-muted-foreground hidden sm:block" />
          <Select
            value={companyFilter}
            onValueChange={(v) => { setCompanyFilter(v); setBranchFilter(ALL); }}
          >
            <SelectTrigger className="w-full sm:w-[200px] bg-muted/50 border-transparent focus:bg-background">
              <SelectValue placeholder="Empresa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las empresas</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-full sm:w-[180px] bg-muted/50 border-transparent focus:bg-background">
              <SelectValue placeholder="Sucursal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las sucursales</SelectItem>
              {branchesForFilter.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-[260px]">Usuario</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Sucursal</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Roles adicionales</TableHead>
              <TableHead>Verificación</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Cargando usuarios...</TableCell></TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No se encontraron usuarios.</TableCell></TableRow>
            ) : (
              filteredUsers.map((u) => (
                <TableRow key={u.id} className="group hover:bg-muted/10 transition-colors">
                  <TableCell className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                        <UserCog className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium leading-none">{u.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{u.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-1.5 text-sm">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {u.companyId ? (companyName[u.companyId] ?? '—') : '—'}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-1.5 text-sm">
                      <Store className="h-3.5 w-3.5 text-muted-foreground" />
                      {u.branchName || '—'}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                      {u.role === 'admin' ? 'Administrador' : (u.customRoles[0]?.name ?? 'Cajero')}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {u.customRoles.length > 0 ? (
                        u.customRoles.map((r) => (
                          <Badge key={r.id} variant="outline" className="text-[10px]">{r.name}</Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge
                      variant={u.emailConfirmedAt ? 'outline' : 'destructive'}
                      className={u.emailConfirmedAt ? 'bg-green-500/10 text-green-500 border-green-500/20' : ''}
                    >
                      {u.emailConfirmedAt ? 'Verificado' : 'Pendiente'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => onEditUser(u)}
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                    </Button>
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
