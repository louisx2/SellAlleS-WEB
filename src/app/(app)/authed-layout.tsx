'use client';

import React, { useEffect, useState, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar, SidebarTrigger, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, useSidebar, SidebarFooter } from '@/components/ui/sidebar';
import { Building, ChevronDown, CircleUserRound, CreditCard, History, Landmark, LayoutGrid, LineChart, LogOut, Package, PanelLeft, Settings, Shield, ShoppingCart, Store, Truck, Users, UsersRound, Wallet, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/auth-provider';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModules } from '@/context/modules-provider';
import { moduleForRoute, type ModuleKey } from '@/lib/modules';

interface NavItem {
  href: string;
  icon?: React.ComponentType;
  label: string;
  roles: string[];
  module?: ModuleKey; // si falta, el item es núcleo y siempre se muestra
}

const navItems: NavItem[] = [
  { href: '/dashboard', icon: LayoutGrid, label: 'Dashboard', roles: ['admin', 'cashier'] },
  { href: '/pos', icon: ShoppingCart, label: 'Punto de Venta', roles: ['admin', 'cashier'], module: 'pos' },
  { href: '/quotes', icon: FileText, label: 'Cotizaciones', roles: ['admin', 'cashier'], module: 'quotes' },
  { href: '/sales', icon: History, label: 'Ventas', roles: ['admin'], module: 'sales' },
];

const reportsNavItems = [
    { href: '/reports/sales-summary', label: 'Resumen de Ventas', roles: ['admin']},
    { href: '/reports/user-sales', label: 'Ventas por Usuario', roles: ['admin']},
    { href: '/reports/top-products', label: 'Productos Más Vendidos', roles: ['admin']},
    { href: '/reports/date-range', label: 'Ingresos por Fechas', roles: ['admin']},
    { href: '/reports/taxes', label: 'Impuestos', roles: ['admin']},
]

const adminNavItems: NavItem[] = [
    { href: '/products', icon: Package, label: 'Productos', roles: ['admin'] },
    { href: '/customers', icon: UsersRound, label: 'Clientes', roles: ['admin'] },
    { href: '/credit', icon: CreditCard, label: 'Cuentas por Cobrar', roles: ['admin'], module: 'credit' },
    { href: '/financing', icon: Landmark, label: 'Financiamiento', roles: ['admin'], module: 'financing' },
    { href: '/suppliers', icon: Truck, label: 'Proveedores', roles: ['admin'], module: 'suppliers' },
    { href: '/expenses', icon: Wallet, label: 'Gastos', roles: ['admin'], module: 'expenses' },
    { href: '/company-profile', icon: Building, label: 'Perfil de Empresa', roles: ['admin']},
    { href: '/users', icon: Users, label: 'Usuarios', roles: ['admin']},
    { href: '/branches', icon: Store, label: 'Sucursales', roles: ['admin']},
    { href: '/roles', icon: Shield, label: 'Roles', roles: ['admin']},
];

export default function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { appUser, signOut } = useAuth();
  const { isModuleEnabled, loading: modulesLoading } = useModules();
  const isMobile = useIsMobile();
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);
  
  const { state, setOpen } = useSidebar();
  const collapseTimer = useRef<NodeJS.Timeout | null>(null);

  const handleCollapsibleToggle = (name: string) => {
    setOpenCollapsible(prev => (prev === name ? null : name));
  };
  
  useEffect(() => {
    if (pathname.startsWith('/reports')) {
      setOpenCollapsible('reports');
    } else if (adminNavItems.some(item => pathname.startsWith(item.href))) {
        setOpenCollapsible('admin');
    } else {
      setOpenCollapsible(null);
    }
  }, [pathname]);

  const handleLogout = async () => {
    await signOut();
    router.push('/login');
  };

  const handleMouseEnter = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };

  const handleMouseLeave = () => {
    if (state === 'expanded' && !isMobile) {
      collapseTimer.current = setTimeout(() => {
        setOpen(false);
        setOpenCollapsible(null);
      }, 2000);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
  };
  
  if (!appUser) {
    return null;
  }
  const { role: userRole, name: userName, branch: userBranch } = appUser;
  const isSuperAdmin = appUser.isSuperAdmin;

  const moduleOk = (item: NavItem) => !item.module || isModuleEnabled(item.module);
  const visibleNavItems = navItems.filter(item => userRole && item.roles.includes(userRole) && moduleOk(item));
  const visibleAdminNavItems = adminNavItems.filter(moduleOk);
  const canViewAdmin = userRole === 'admin';
  const canViewReports = userRole === 'admin' && isModuleEnabled('reports');

  // Guard de rutas: si la URL pertenece a un módulo apagado para esta
  // empresa, no se renderiza el contenido (aunque escriban la URL a mano).
  const routeModule = moduleForRoute(pathname);
  const routeBlocked = routeModule !== null && !modulesLoading && !isModuleEnabled(routeModule);

  const formatRole = (role: string | null) => {
    if (role === 'admin') return 'Administrador';
    if (role === 'cashier') return 'Cajero';
    return '';
  };
  
  const isPosPage = pathname === '/pos';

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 z-40 flex items-center justify-between h-14 md:h-16 w-full px-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <SidebarTrigger className="md:hidden" />
          <Link href="/dashboard" className="flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg hidden sm:inline-block">SellAlleS</span>
          </Link>
        </div>
        
        {userName && (
          <div className="flex items-center gap-3">
             <div className="text-right hidden sm:block">
              {pathname === '/dashboard' ? (
                <p className="text-lg font-semibold text-gray-800">{getGreeting()}, {userName}</p>
              ) : (
                <p className="text-sm font-semibold leading-none">{userName}</p>
              )}
               <p className="text-sm text-muted-foreground capitalize">{formatRole(userRole)} en {userBranch}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                    <Avatar className="h-9 w-9">
                        <AvatarFallback>{userName.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex items-center gap-2">
                     <CircleUserRound className="h-5 w-5 text-muted-foreground"/>
                     <p className="text-sm font-medium leading-none">{userName}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled>
                    <span>{formatRole(userRole)}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <span>Sucursal {userBranch}</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Cerrar Sesión</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <Sidebar
        className="top-14 md:top-16 h-[calc(100vh-3.5rem)] md:h-[calc(100vh-4rem)]"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <SidebarHeader>
           <SidebarTrigger asChild>
              <SidebarMenuButton tooltip="Ocultar Menú" className="w-full">
                <PanelLeft />
                <span className="group-data-[collapsible=icon]:hidden">Ocultar Menú</span>
              </SidebarMenuButton>
            </SidebarTrigger>
        </SidebarHeader>
        <Separator />
        <SidebarContent>
          <SidebarMenu>
            {isSuperAdmin && (
              <SidebarMenuItem>
                <Link href="/admin/companies" passHref>
                  <SidebarMenuButton isActive={pathname.startsWith('/admin')} tooltip="Plataforma">
                    <Building />
                    <span className="group-data-[collapsible=icon]:hidden">Plataforma</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            )}
            {visibleNavItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <Link href={item.href} passHref>
                  <SidebarMenuButton isActive={pathname === item.href} tooltip={item.label}>
                    {item.icon && <item.icon />}
                    <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            ))}

            {canViewReports && (
              <Collapsible open={openCollapsible === 'reports'} onOpenChange={() => handleCollapsibleToggle('reports')}>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip="Reportes">
                    <LineChart />
                    <div className="flex w-full items-center justify-between group-data-[collapsible=icon]:hidden">
                      <span className="flex-1 text-left">Reportes</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', openCollapsible === 'reports' && 'rotate-180')} />
                    </div>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="group-data-[collapsible=icon]:hidden">
                  <SidebarMenu className="pl-6">
                    {reportsNavItems.map(item => (
                      <SidebarMenuItem key={item.href}>
                        <Link href={item.href} passHref>
                          <SidebarMenuButton size="sm" className="h-8" isActive={pathname.startsWith(item.href)}>
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </Link>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            )}

            {canViewAdmin && (
              <Collapsible open={openCollapsible === 'admin'} onOpenChange={() => handleCollapsibleToggle('admin')}>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip="Administrar">
                    <Settings />
                    <div className="flex w-full items-center justify-between group-data-[collapsible=icon]:hidden">
                      <span className="flex-1 text-left">Administrar</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', openCollapsible === 'admin' && 'rotate-180')} />
                    </div>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="group-data-[collapsible=icon]:hidden">
                  <SidebarMenu className="pl-6">
                    {visibleAdminNavItems.map(item => (
                      <SidebarMenuItem key={item.href}>
                        <Link href={item.href} passHref>
                          <SidebarMenuButton size="sm" className="h-8" isActive={pathname.startsWith(item.href)}>
                            {item.icon && <item.icon />}
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </Link>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            )}
          </SidebarMenu>
        </SidebarContent>
        <Separator />
        <SidebarFooter className="p-4">
          <SidebarMenuButton onClick={handleLogout} tooltip="Cerrar Sesión">
            <LogOut />
            <span className="group-data-[collapsible=icon]:hidden">Cerrar Sesión</span>
          </SidebarMenuButton>
        </SidebarFooter>
      </Sidebar>

      <div className={cn('transition-all duration-300 ease-in-out pt-14 md:pt-16', state === 'expanded' ? 'md:ml-[var(--sidebar-width)]' : 'md:ml-[var(--sidebar-width-icon)]')}>
        <main className={cn(!isPosPage && "p-4 sm:p-6 lg:p-8")}>
          {routeBlocked ? (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
              <Shield className="h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Módulo no disponible</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Este módulo no está habilitado para tu empresa. Si lo necesitas,
                contacta al administrador de la plataforma.
              </p>
              <Button variant="outline" onClick={() => router.push('/dashboard')}>Volver al Dashboard</Button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
