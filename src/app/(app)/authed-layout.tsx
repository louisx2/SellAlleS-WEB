'use client';

import React, { useEffect, useState, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar, SidebarTrigger, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, useSidebar, SidebarFooter } from '@/components/ui/sidebar';
import { Building, Building2, ChevronDown, CircleUserRound, CreditCard, History, Landmark, LayoutGrid, LineChart, LogOut, Package, PanelLeft, Settings, Shield, ShoppingCart, Store, Truck, Users, UsersRound, UserCog, Wallet, FileText, FolderOpen, MapPin, Wrench, PenTool, Briefcase, Sun, Moon, HandCoins, Coins, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/auth-provider';
import { useTheme } from 'next-themes';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModules } from '@/context/modules-provider';
import { moduleForRoute, type ModuleKey } from '@/lib/modules';
import { useCompanyProfile } from '@/context/company-profile-provider';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ProfileModal } from '@/components/profile/profile-modal';

interface NavItem {
  href: string;
  icon?: React.ComponentType;
  label: string;
  roles: string[];
  module?: ModuleKey; // si falta, el item es núcleo y siempre se muestra
}

const dashboardNavItem: NavItem = { href: '/dashboard', icon: LayoutGrid, label: 'Dashboard', roles: ['admin', 'cashier'] };

const coreNavItems: NavItem[] = [
  { href: '/sales', icon: History, label: 'Movimientos', roles: ['admin'], module: 'sales' },
];

const featuresNavItems: NavItem[] = [
  { href: '/pos', icon: ShoppingCart, label: 'Carrito', roles: ['admin', 'cashier'], module: 'pos' },
  { href: '/quotes', icon: FileText, label: 'Cotizaciones', roles: ['admin', 'cashier'], module: 'quotes' },
  { href: '/services', icon: Wrench, label: 'Servicios', roles: ['admin', 'cashier'], module: 'services' },
  { href: '/credit', icon: CreditCard, label: 'Cuentas por Cobrar', roles: ['admin'], module: 'credit' },
  { href: '/financing', icon: Landmark, label: 'Financiamientos', roles: ['admin'], module: 'financing' },
  { href: '/prestamos', icon: HandCoins, label: 'Préstamos', roles: ['admin'], module: 'prestamos' },
  { href: '/caja', icon: Coins, label: 'Caja', roles: ['admin', 'cashier'], module: 'caja' },
  { href: '/expenses', icon: Wallet, label: 'Gastos', roles: ['admin'], module: 'expenses' },
];

const reportsNavItems = [
    { href: '/reports/sales-summary', label: 'Resumen de Ventas', roles: ['admin']},
    { href: '/reports/user-sales', label: 'Ventas por Usuario', roles: ['admin']},
    { href: '/reports/top-products', label: 'Productos Más Vendidos', roles: ['admin']},
    { href: '/reports/date-range', label: 'Ingresos por Fechas', roles: ['admin']},
    { href: '/reports/receivables', label: 'Cuentas por Cobrar', roles: ['admin']},
    { href: '/reports/inventory', label: 'Valorización de Inventario', roles: ['admin']},
    { href: '/reports/taxes', label: 'Impuestos', roles: ['admin']},
];

const adminNavItems: NavItem[] = [
    { href: '/inventory', icon: Package, label: 'Inventario', roles: ['admin'] },
    { href: '/categories', icon: FolderOpen, label: 'Categorías', roles: ['admin'] },
    { href: '/locations', icon: MapPin, label: 'Ubicaciones', roles: ['admin'] },
    { href: '/customers', icon: UsersRound, label: 'Clientes', roles: ['admin'] },
    { href: '/suppliers', icon: Truck, label: 'Proveedores', roles: ['admin'], module: 'suppliers' },
    { href: '/company-profile', icon: Building, label: 'Perfil de Empresa', roles: ['admin']},
    { href: '/users', icon: Users, label: 'Usuarios', roles: ['admin']},
    { href: '/branches', icon: Store, label: 'Sucursales', roles: ['admin']},
    { href: '/roles', icon: Shield, label: 'Roles', roles: ['admin']},
    { href: '/service-types', icon: PenTool, label: 'Tipos de Servicio', roles: ['admin'], module: 'services' },
    { href: '/suscripcion', icon: Receipt, label: 'Mi Suscripción', roles: ['admin']},
];

export default function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { appUser, signOut, setImpersonatedCompany, setActiveBranch } = useAuth();
  const { isModuleEnabled, loading: modulesLoading } = useModules();
  const { profile } = useCompanyProfile();
  const isMobile = useIsMobile();
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  
  const { state, setOpen, isMobile: sidebarIsMobile, setOpenMobile } = useSidebar();
  const collapseTimer = useRef<NodeJS.Timeout | null>(null);

  // En móvil el sidebar es un Sheet que tapa la pantalla: al navegar a otra
  // ruta se cierra solo (cubre links y router.push por igual).
  useEffect(() => {
    if (sidebarIsMobile) setOpenMobile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleCollapsibleToggle = (name: string) => {
    setOpenCollapsible(prev => (prev === name ? null : name));
    if (state === 'collapsed') {
      setOpen(true);
    }
  };
  
  useEffect(() => {
    if (pathname.startsWith('/reports')) {
      setOpenCollapsible('reports');
    } else if (featuresNavItems.some(item => pathname.startsWith(item.href))) {
      setOpenCollapsible('features');
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
    if (state === 'collapsed' && !isMobile) {
      setOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (state === 'expanded' && !isMobile) {
      collapseTimer.current = setTimeout(() => {
        setOpen(false);
        setOpenCollapsible(null);
      }, 500);
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
  const hasMultipleCompanies = !!(appUser.companies && appUser.companies.length > 1);
  const isImpersonating = !!appUser.impersonatedCompanyId;
  const isDemoCompany = !!appUser.companyDemoExpiresAt;
  const isReadOnly = !!appUser.isReadOnly;
  const hasTopBanner = isImpersonating || isDemoCompany || isReadOnly;
  const showOperationalMenus = (!isSuperAdmin && !hasMultipleCompanies) || isImpersonating;
  const isManager = appUser?.customRoles?.some(r => r.name.toLowerCase().includes('gerente'));
  const isAdminOrManager = !isSuperAdmin && (userRole === 'admin' || isManager);

  const moduleOk = (item: NavItem) => !item.module || isModuleEnabled(item.module);
  const visibleDashboard = showOperationalMenus && userRole && dashboardNavItem.roles.includes(userRole);
  const visibleCoreNavItems = coreNavItems.filter(item => showOperationalMenus && userRole && item.roles.includes(userRole) && moduleOk(item));
  const visibleFeaturesNavItems = featuresNavItems.filter(item => showOperationalMenus && userRole && item.roles.includes(userRole) && moduleOk(item));
  const visibleAdminNavItems = adminNavItems.filter(item => showOperationalMenus && moduleOk(item));
  const canViewAdmin = userRole === 'admin' && showOperationalMenus;
  const canViewReports = userRole === 'admin' && showOperationalMenus && isModuleEnabled('reports');

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

  const logoLink = isSuperAdmin && !isImpersonating 
    ? '/admin/companies' 
    : (hasMultipleCompanies && !isImpersonating ? '/admin/empresas' : '/dashboard');
  const logoName = isSuperAdmin && !isImpersonating 
    ? 'Plataforma SellAlleS' 
    : (hasMultipleCompanies && !isImpersonating ? 'Mis Empresas' : (profile?.name || 'SellAlleS'));
  const logoImgUrl = (isSuperAdmin && !isImpersonating) || (hasMultipleCompanies && !isImpersonating) ? null : profile?.logoUrl;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {isImpersonating && (
        <div className="fixed top-0 z-50 w-full bg-indigo-600 text-white px-4 py-1.5 text-xs flex items-center justify-center gap-4 font-medium shadow-md">
          <span>
            {isSuperAdmin ? (
              <>⚠️ Modo Soporte: Estás operando como Super Administrador en <strong>{appUser.impersonatedCompanyName}</strong></>
            ) : (
              <>Estás operando en la empresa <strong>{appUser.impersonatedCompanyName}</strong></>
            )}
          </span>
          <button
            onClick={() => setImpersonatedCompany(null, null)}
            className="bg-white text-indigo-600 px-3 py-0.5 rounded-full hover:bg-indigo-50 transition-colors font-bold"
          >
            {isSuperAdmin ? 'Volver a Plataforma' : 'Cambiar Empresa'}
          </button>
        </div>
      )}
      {!isImpersonating && isDemoCompany && (
        <div className="fixed top-0 z-50 w-full bg-amber-500 text-amber-950 px-4 py-1.5 text-xs flex items-center justify-center gap-2 font-medium shadow-md">
          <span>
            🧪 Modo Demostración: esta empresa de prueba se borra automáticamente a las{' '}
            <strong>{new Date(appUser.companyDemoExpiresAt!).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}</strong>
          </span>
        </div>
      )}
      {!isImpersonating && !isDemoCompany && isReadOnly && (
        <div className="fixed top-0 z-50 w-full bg-red-600 text-white px-4 py-1.5 text-xs flex items-center justify-center gap-3 font-medium shadow-md">
          <span>
            {appUser.companyStatus === 'trial'
              ? '⚠️ Tu prueba gratis de 14 días terminó. Puedes ver tus datos, pero no modificarlos hasta activar tu cuenta.'
              : '⚠️ Tu suscripción venció. Puedes ver tus datos, pero no modificarlos hasta renovar tu pago.'}
          </span>
          <a
            href="https://wa.me/18299333226?text=Hola,%20quiero%20activar%20mi%20cuenta%20de%20SellAlleS"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white text-red-600 px-3 py-0.5 rounded-full hover:bg-red-50 transition-colors whitespace-nowrap"
          >
            Activar por WhatsApp
          </a>
        </div>
      )}
      <header className={cn(
        "fixed z-40 flex items-center justify-between h-14 md:h-16 w-full px-4 border-b bg-card transition-all",
        hasTopBanner ? "top-7" : "top-0"
      )}>
        <div className="flex items-center gap-4">
          <SidebarTrigger className="md:hidden" />
          <Link href={logoLink} className="flex items-center gap-2">
            {logoImgUrl ? (
              <img src={logoImgUrl} alt="Logo" className="h-6 w-auto object-contain max-w-[120px]" />
            ) : (
              <Store className="h-6 w-6 text-primary" />
            )}
            <span className="font-bold text-lg hidden sm:inline-block truncate max-w-[200px]">
              {logoName}
            </span>
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
               <p className="text-sm text-muted-foreground capitalize">
                 {isSuperAdmin ? 'Super Administrador' : `${formatRole(userRole)} en ${userBranch}`}
               </p>
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
                  <DropdownMenuItem onSelect={() => setShowProfileModal(true)} className="cursor-pointer">
                    <CircleUserRound className="mr-2 h-4 w-4" />
                    <span>Mi Perfil</span>
                  </DropdownMenuItem>
                  {mounted && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="cursor-pointer">
                        {theme === 'light' ? (
                          <Sun className="mr-2 h-4 w-4 text-orange-500" />
                        ) : theme === 'dark' ? (
                          <Moon className="mr-2 h-4 w-4 text-yellow-300" />
                        ) : (
                          <Settings className="mr-2 h-4 w-4" />
                        )}
                        <span>Tema: {theme === 'light' ? 'Claro' : theme === 'dark' ? 'Oscuro' : 'Sistema'}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onSelect={() => setTheme('light')}>
                          <Sun className="mr-2 h-4 w-4 text-orange-500" />
                          <span>Claro</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setTheme('dark')}>
                          <Moon className="mr-2 h-4 w-4 text-yellow-300" />
                          <span>Oscuro</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setTheme('system')}>
                          <Settings className="mr-2 h-4 w-4" />
                          <span>Sistema</span>
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled>
                    <span>{isSuperAdmin ? 'Super Administrador' : formatRole(userRole)}</span>
                  </DropdownMenuItem>
                  {!isSuperAdmin && appUser.branches && appUser.branches.length > 1 && isAdminOrManager ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="cursor-pointer">
                        <Store className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>Sucursal: {userBranch}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-48">
                        {appUser.branches.map((b) => (
                          <DropdownMenuItem
                            key={b.id}
                            className={cn(
                              "cursor-pointer flex items-center justify-between",
                              b.id === appUser.activeBranchId && "bg-accent font-medium"
                            )}
                            onSelect={() => {
                              if (b.id !== appUser.activeBranchId) {
                                setActiveBranch(b.id, b.name);
                                setTimeout(() => window.location.reload(), 100);
                              }
                            }}
                          >
                            <span className="truncate">{b.name}</span>
                            {b.id === appUser.activeBranchId && (
                              <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                                Activa
                              </span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : (
                    !isSuperAdmin && (
                      <DropdownMenuItem disabled>
                        <span>Sucursal {userBranch}</span>
                      </DropdownMenuItem>
                    )
                  )}
                </DropdownMenuGroup>
                {((isSuperAdmin && isImpersonating) || (!isSuperAdmin && hasMultipleCompanies && isImpersonating)) && (
                  <DropdownMenuItem onSelect={() => setImpersonatedCompany(null, null)} className="cursor-pointer">
                    <Building2 className="mr-2 h-4 w-4 text-indigo-500" />
                    <span>Cambiar Empresa</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setTimeout(() => setShowLogoutConfirm(true), 55)} className="cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Cerrar Sesión</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <Sidebar
        collapsible="icon"
        className={cn(
          "transition-all h-[calc(100vh-3.5rem)] md:h-[calc(100vh-4rem)]",
          hasTopBanner ? "top-[4.25rem] md:top-[4.75rem]" : "top-14 md:top-16"
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <SidebarContent>
          <SidebarMenu>
            {isSuperAdmin && (
              <SidebarMenuItem>
                <Link href="/admin/companies" passHref>
                  <SidebarMenuButton isActive={pathname === '/admin/companies'} tooltip="Plataforma">
                    <Building />
                    <span className="group-data-[collapsible=icon]:hidden">Plataforma</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            )}
             {(isSuperAdmin || hasMultipleCompanies) && (
              <SidebarMenuItem>
                <Link href="/admin/empresas" passHref>
                  <SidebarMenuButton isActive={pathname.startsWith('/admin/empresas')} tooltip={isSuperAdmin ? "Empresas" : "Mis Empresas"}>
                    <Building2 />
                    <span className="group-data-[collapsible=icon]:hidden">
                      {isSuperAdmin ? "Empresas" : "Mis Empresas"}
                    </span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            )}
            {isSuperAdmin && (
              <SidebarMenuItem>
                <Link href="/admin/users" passHref>
                  <SidebarMenuButton isActive={pathname.startsWith('/admin/users')} tooltip="Usuarios de la Plataforma">
                    <UserCog />
                    <span className="group-data-[collapsible=icon]:hidden">Usuarios (Plataforma)</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            )}
            {visibleDashboard && (
              <SidebarMenuItem>
                <Link href={dashboardNavItem.href} passHref>
                  <SidebarMenuButton isActive={pathname === dashboardNavItem.href} tooltip={dashboardNavItem.label}>
                    {dashboardNavItem.icon && <dashboardNavItem.icon />}
                    <span className="group-data-[collapsible=icon]:hidden">{dashboardNavItem.label}</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            )}

            {visibleCoreNavItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <Link href={item.href} passHref>
                  <SidebarMenuButton isActive={pathname === item.href} tooltip={item.label}>
                    {item.icon && <item.icon />}
                    <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            ))}

            {visibleFeaturesNavItems.length > 0 && (
              <Collapsible open={openCollapsible === 'features'} onOpenChange={() => handleCollapsibleToggle('features')}>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip="Funciones">
                    <Briefcase />
                    <div className="flex w-full items-center justify-between group-data-[collapsible=icon]:hidden">
                      <span className="flex-1 text-left">Funciones</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', openCollapsible === 'features' && 'rotate-180')} />
                    </div>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="group-data-[collapsible=icon]:hidden collapsible-content-animation">
                  <SidebarMenu className="pl-6">
                    {visibleFeaturesNavItems.map(item => (
                      <SidebarMenuItem key={item.href}>
                        <Link href={item.href} passHref>
                          <SidebarMenuButton size="sm" className="h-8" isActive={pathname.startsWith(item.href)} tooltip={item.label}>
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

            {canViewReports && (
              <Collapsible open={openCollapsible === 'reports'} onOpenChange={() => handleCollapsibleToggle('reports')}>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton>
                    <LineChart />
                    <div className="flex w-full items-center justify-between group-data-[collapsible=icon]:hidden">
                      <span className="flex-1 text-left">Reportes</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', openCollapsible === 'reports' && 'rotate-180')} />
                    </div>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="group-data-[collapsible=icon]:hidden collapsible-content-animation">
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
                  <SidebarMenuButton>
                    <Settings />
                    <div className="flex w-full items-center justify-between group-data-[collapsible=icon]:hidden">
                      <span className="flex-1 text-left">Administrar</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', openCollapsible === 'admin' && 'rotate-180')} />
                    </div>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="group-data-[collapsible=icon]:hidden collapsible-content-animation">
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
          <div className={cn(
            "text-[10px] text-muted-foreground text-center mt-auto pt-2 pb-1 -mb-4 transition-opacity duration-200",
            state === 'expanded' ? 'opacity-100 delay-150' : 'opacity-0 pointer-events-none'
          )}>
            SellAlleS Web <span className="opacity-70">by SmatCore</span>
          </div>
        </SidebarContent>
        <Separator />
        <SidebarFooter className="p-4 flex flex-col gap-2">
          <SidebarMenuButton onClick={() => setShowLogoutConfirm(true)} tooltip="Cerrar Sesión">
            <LogOut />
            <span className="group-data-[collapsible=icon]:hidden">Cerrar Sesión</span>
          </SidebarMenuButton>
        </SidebarFooter>
      </Sidebar>

      <div className={cn('transition-all duration-300 ease-in-out',
        hasTopBanner ? 'pt-[4.25rem] md:pt-[4.75rem]' : 'pt-14 md:pt-16',
        state === 'expanded' ? 'md:ml-[var(--sidebar-width)]' : 'md:ml-[var(--sidebar-width-icon)]'
      )}>
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

      <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar Sesión?</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas salir de tu cuenta? Tendrás que volver a ingresar tus credenciales para acceder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <ProfileModal open={showProfileModal} onOpenChange={setShowProfileModal} />
    </div>
  );
}
