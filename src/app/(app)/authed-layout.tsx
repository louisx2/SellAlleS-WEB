'use client';

import React, { useEffect, useState, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar, SidebarTrigger, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, useSidebar, SidebarFooter, SidebarSeparator } from '@/components/ui/sidebar';
import { Building, Building2, ChevronDown, CircleUserRound, CreditCard, History, Landmark, LayoutGrid, LineChart, LogOut, Package, PanelLeft, Settings, Shield, ShoppingCart, Store, Truck, Users, UsersRound, UserCog, Wallet, FileText, FolderOpen, MapPin, Wrench, PenTool, Briefcase, Sun, Moon, HandCoins, Coins, Receipt, ReceiptText } from 'lucide-react';
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
import { hasPermission, isReportVisible, unionPermissions } from '@/lib/permissions';
import type { PermissionResource } from '@/lib/types';
import { useCompanyProfile } from '@/context/company-profile-provider';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/supabase/client';
import { ProfileModal } from '@/components/profile/profile-modal';

interface NavItem {
  href: string;
  icon?: React.ComponentType;
  label: string;
  module?: ModuleKey; // si falta, el item es núcleo y siempre se muestra
  permission: PermissionResource; // visibilidad real: rol base (Administrador/Cajero) + roles personalizados adicionales
}

const dashboardNavItem: NavItem = { href: '/dashboard', icon: LayoutGrid, label: 'Dashboard', permission: 'dashboard' };

const coreNavItems: NavItem[] = [
  { href: '/sales', icon: History, label: 'Movimientos', module: 'sales', permission: 'sales' },
];

const featuresNavItems: NavItem[] = [
  { href: '/pos', icon: ShoppingCart, label: 'Carrito', module: 'pos', permission: 'pos' },
  { href: '/quotes', icon: FileText, label: 'Cotizaciones', module: 'quotes', permission: 'quotes' },
  { href: '/services', icon: Wrench, label: 'Servicios', module: 'services', permission: 'services' },
  { href: '/credit', icon: CreditCard, label: 'Cuentas por Cobrar', module: 'credit', permission: 'credit' },
  { href: '/payables', icon: ReceiptText, label: 'Cuentas por Pagar', module: 'payables', permission: 'payables' },
  { href: '/financing', icon: Landmark, label: 'Financiamientos', module: 'financing', permission: 'financing' },
  { href: '/prestamos', icon: HandCoins, label: 'Préstamos', module: 'prestamos', permission: 'prestamos' },
  { href: '/caja', icon: Coins, label: 'Caja', module: 'caja', permission: 'caja' },
  { href: '/expenses', icon: Wallet, label: 'Gastos', module: 'expenses', permission: 'expenses' },
];

const reportsNavItems = [
    { href: '/reports/sales-summary', label: 'Resumen de Ventas' },
    { href: '/reports/user-sales', label: 'Ventas por Usuario' },
    { href: '/reports/top-products', label: 'Productos Más Vendidos' },
    { href: '/reports/date-range', label: 'Ingresos por Fechas' },
    { href: '/reports/receivables', label: 'Cuentas por Cobrar' },
    { href: '/reports/inventory', label: 'Valorización de Inventario' },
    { href: '/reports/taxes', label: 'Impuestos' },
    { href: '/reports/ganancias', label: 'Reporte de Ganancias' },
    { href: '/reports/compras-606', label: 'Compras (Formato 606)' },
];

const adminNavItems: NavItem[] = [
    { href: '/inventory', icon: Package, label: 'Inventario', permission: 'products' },
    { href: '/categories', icon: FolderOpen, label: 'Categorías', permission: 'products' },
    { href: '/locations', icon: MapPin, label: 'Ubicaciones', permission: 'products' },
    { href: '/customers', icon: UsersRound, label: 'Clientes', permission: 'customers' },
    { href: '/suppliers', icon: Truck, label: 'Proveedores', module: 'suppliers', permission: 'suppliers' },
    { href: '/company-profile', icon: Building, label: 'Perfil de Sucursal', permission: 'company-profile' },
    { href: '/users', icon: Users, label: 'Usuarios', permission: 'users' },
    { href: '/branches', icon: Store, label: 'Sucursales', permission: 'branches' },
    { href: '/roles', icon: Shield, label: 'Roles', permission: 'roles' },
    { href: '/service-types', icon: PenTool, label: 'Tipos de Servicio', module: 'services', permission: 'service-types' },
    { href: '/suscripcion', icon: Receipt, label: 'Mi Suscripción', permission: 'suscripcion' },
    { href: '/settings', icon: Settings, label: 'Ajustes', permission: 'company-profile' },
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
  const [branchLogo, setBranchLogo] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser?.activeBranchId) {
      setBranchLogo(null);
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from('branches')
          .select('logo_url')
          .eq('id', appUser.activeBranchId)
          .limit(1)
          .maybeSingle();
        if (data?.logo_url) {
          setBranchLogo(data.logo_url);
        } else {
          setBranchLogo(null);
        }
      } catch (err) {
        console.warn("Error loading branch logo in layout:", err);
        setBranchLogo(null);
      }
    })();
  }, [appUser?.activeBranchId]);

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
  // El banner de "operando en otra empresa" solo se muestra a super admin.
  const hasTopBanner = (isImpersonating && isSuperAdmin) || isDemoCompany || isReadOnly;
  const showOperationalMenus = (!isSuperAdmin && !hasMultipleCompanies) || isImpersonating;
  const isManager = appUser?.customRoles?.some(r => r.name.toLowerCase().includes('gerente'));
  const isAdminOrManager = !isSuperAdmin && (userRole === 'admin' || isManager);

  // Permisos reales: el rol base de sistema (Administrador/Cajero) da la
  // visibilidad de partida, y los roles personalizados adicionales (ej.
  // "Gerente") solo SUMAN sobre eso, nunca restan.
  const effectivePermissions = unionPermissions([
    { permissions: appUser.baseRolePermissions },
    ...(appUser.customRoles ?? []),
  ]);
  // El super admin ve todo (impersonando o no) — antes lo cubría el atajo
  // userRole === 'admin' (su role siempre se fuerza a 'admin'), que se quitó
  // al pasar a permisos reales; sin este bypass se quedaba sin nav alguno.
  const hasExtra = (resource?: PermissionResource) => !!resource && (isSuperAdmin || hasPermission(effectivePermissions, resource, 'view'));

  const moduleOk = (item: NavItem) => !item.module || isModuleEnabled(item.module);
  const visibleDashboard = showOperationalMenus && userRole && hasExtra(dashboardNavItem.permission);
  const visibleCoreNavItems = coreNavItems.filter(item => showOperationalMenus && userRole && moduleOk(item) && hasExtra(item.permission));
  const visibleFeaturesNavItems = featuresNavItems.filter(item => showOperationalMenus && userRole && moduleOk(item) && hasExtra(item.permission));
  const visibleAdminNavItems = adminNavItems.filter(item => showOperationalMenus && moduleOk(item) && hasExtra(item.permission));
  const canViewAdmin = showOperationalMenus && visibleAdminNavItems.length > 0;
  const canViewReports = showOperationalMenus && isModuleEnabled('reports') && hasExtra('reports');
  const visibleReportsNavItems = reportsNavItems.filter((item) => {
    const slug = item.href.split('/').pop()!;
    // El 606 es un reporte fiscal DGII: aplica solo a empresas formalizadas y
    // depende de las facturas del módulo de Cuentas por Pagar.
    if (slug === 'compras-606' && (!profile.isFormalized || !isModuleEnabled('payables'))) return false;
    return isReportVisible(effectivePermissions, slug);
  });

  // Guard de rutas: si la URL pertenece a un módulo apagado para esta
  // empresa, no se renderiza el contenido (aunque escriban la URL a mano).
  const routeModule = moduleForRoute(pathname);
  const routeBlocked = routeModule !== null && !modulesLoading && !isModuleEnabled(routeModule);

  // Guard de permisos: mismo criterio que gatea el ítem en el menú, aplicado
  // también al contenido de la página (si alguien escribe la URL a mano sin
  // tener el permiso, no ve el contenido igual que no ve el enlace).
  const allNavItems = [...coreNavItems, ...featuresNavItems, ...adminNavItems];
  const matchedNavItem = allNavItems.find(item => pathname === item.href || pathname.startsWith(item.href + '/'));
  const permissionBlocked = !isSuperAdmin && !!matchedNavItem && !!userRole && !hasExtra(matchedNavItem.permission);

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
  const logoImgUrl = (isSuperAdmin && !isImpersonating) || (hasMultipleCompanies && !isImpersonating) 
    ? null 
    : (branchLogo || profile?.logoUrl);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Solo super admin: aviso de seguridad de que está operando como otra
          empresa. Para usuarios normales multi-empresa no se muestra —
          "Cambiar Empresa" sigue disponible en el menú de usuario. */}
      {isImpersonating && isSuperAdmin && (
        <div className="fixed top-0 z-50 w-full bg-indigo-600 text-white px-4 py-1.5 text-xs flex items-center justify-center gap-4 font-medium shadow-md">
          <span>
            ⚠️ Modo Soporte: Estás operando como Super Administrador en <strong>{appUser.impersonatedCompanyName}</strong>
          </span>
          <button
            onClick={() => setImpersonatedCompany(null, null)}
            className="bg-white text-indigo-600 px-3 py-0.5 rounded-full hover:bg-indigo-50 transition-colors font-bold"
          >
            Volver a Plataforma
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
            {hasMultipleCompanies && !isSuperAdmin && (
              <SidebarMenuItem>
                <Link href="/admin/consolidado" passHref>
                  <SidebarMenuButton isActive={pathname.startsWith('/admin/consolidado')} tooltip="Panel Consolidado">
                    <LineChart />
                    <span className="group-data-[collapsible=icon]:hidden">Panel Consolidado</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            )}
            {(isSuperAdmin || hasMultipleCompanies) && <SidebarSeparator />}
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
                    {visibleReportsNavItems.map(item => (
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
            SellAlleS Web <span className="opacity-70">by SmartCore</span>
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
          ) : permissionBlocked ? (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
              <Shield className="h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-semibold">No tienes permiso para ver esta sección</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Si necesitas acceso, pídele al administrador de tu empresa que te lo asigne desde Roles.
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
