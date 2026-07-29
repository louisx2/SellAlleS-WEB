import type { UnitCode } from './units';

export type Product = {
  id: string;
  code: string;
  categoryId?: string;
  name: string;
  description?: string;
  supplierId?: string;
  price: number;
  cost: number;
  itbis: boolean;
  image: string;
  stock: number;
  // Unidad de medida: decide si el producto se vende en cantidades
  // fraccionadas (libra, metro…) o solo enteras (unidad, caja…).
  unit: UnitCode;
  // false = no maneja existencias (plato preparado, servicio, tarifa): se
  // vende siempre, no descuenta stock y nunca aparece agotado.
  tracksStock: boolean;
  locationId?: string;
  entryDate?: string;
  modificationDate?: string;
  wholesalePrice?: number;
  wholesaleMinQuantity?: number;
};

export type ProductCategory = {
  id: string;
  name: string;
};

export type ProductLocation = {
  id: string;
  name: string;
};

// Tipo de comprobante que pide el cliente en sus compras. Mapea a la serie
// del NCF: B02 consumidor final, B01 crédito fiscal, B15 gubernamental,
// B14 regímenes especiales. Las secuencias viven en ncf_sequences por tipo.
export type NcfType = 'consumer' | 'fiscal' | 'gubernamental' | 'regimen_especial';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  rnc?: string;
  birthdate?: string;
  ncfType: NcfType;
  notes?: string;
  creditBalance: number;
  creditLimit?: number | null; // null/undefined = sin límite
  discountPercentage: number; // % de descuento aplicado automáticamente en el POS
  loyaltyPurchaseCount: number; // contador de fidelidad; solo lo escribe el servidor
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
};

export type CouponStatus = 'active' | 'redeemed' | 'expired';

export type Coupon = {
  id: string;
  customerId: string;
  code: string;
  rewardDescription: string;
  milestoneCount: number;
  status: CouponStatus;
  issuedAt: string;
  expiresAt: string;
  redeemedAt?: string;
  redeemedSaleId?: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'cashier' | 'manager';
  branch: string; // Nombre de la sucursal activa
  activeBranchId?: string; // ID de la sucursal activa
  branches?: { id: string; name: string; logoUrl?: string; ticketLogoUrl?: string }[]; // Lista de sucursales a las que pertenece
  companyId?: string;
  companyStatus?: 'trial' | 'active' | 'suspended';
  companyDemoExpiresAt?: string; // empresa de prueba pública ("Probar Plataforma"); se banea al vencer
  companyTrialEndsAt?: string; // fin de la prueba de 14 días (null en empresas sin límite)
  companyPaidUntil?: string; // suscripción pagada hasta esta fecha (null = sin vencimiento)
  isReadOnly?: boolean; // prueba/suscripción vencida: puede entrar y ver, pero no modificar
  impersonatedCompanyId?: string;
  impersonatedCompanyName?: string;
  isSuperAdmin?: boolean;
  baseRolePermissions?: RolePermissions; // Permisos del rol de sistema (Administrador/Cajero) que corresponde a `role`
  customRoles?: Role[]; // Roles adicionales asignados al usuario
  // role: rol del usuario EN esa empresa (profile_companies.role); `role` (arriba) es el de la empresa activa
  companies?: { id: string; name: string; status: 'trial' | 'active' | 'suspended'; isDemo: boolean; role: 'admin' | 'cashier' }[];
  emailConfirmedAt?: string | null;
  companyMaxUsers?: number | null;
  // Vista preferida del panel de Inventario del POS: lista compacta o con imágenes.
  inventoryView?: 'list' | 'grid';
};

export type Branch = {
  id: string;
  name: string;
  location: string;
  isActive: boolean;
  // Precios con ITBIS incluido: el precio del producto ya trae el impuesto y
  // el POS lo desglosa "hacia adentro" (base = precio / 1.18). false/ausente =
  // el precio es base y el ITBIS se suma encima (comportamiento clásico).
  itbisIncluded?: boolean;
  logoUrl?: string;
  ticketLogoUrl?: string;
  // Perfil del ticket propio de la sucursal. Cualquier campo vacío/ausente
  // hereda el dato del perfil de la empresa (companies) al imprimir.
  displayName?: string; // nombre comercial mostrado en el ticket
  phone?: string;
  rnc?: string;
  address?: string;
  receiptFooter?: string;
};

export type Company = {
  id: string;
  name: string;
  rnc: string | null;
  is_formalized: boolean;
  ncf_enabled: boolean;
  phone: string | null;
  address: string | null;
  status: 'trial' | 'active' | 'suspended';
  trial_ends_at?: string | null;
  paid_until?: string | null;
  created_at: string;
  is_demo: boolean;
  business_type?: string | null;
  max_users?: number;
  branches?: { id: string; name: string; location: string | null; is_active: boolean }[];
};

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

// Un recurso por cada sección de la app gateada a admin (nav de authed-layout).
export type PermissionResource =
  | 'dashboard' | 'pos' | 'sales' | 'quotes' | 'services' | 'credit' | 'financing'
  | 'prestamos' | 'caja' | 'expenses' | 'payables' | 'reports' | 'products' | 'customers'
  | 'suppliers' | 'company-profile' | 'users' | 'branches' | 'roles' | 'suscripcion'
  | 'service-types';

// reports_visible: slugs de src/lib/permissions.ts#REPORT_ITEMS que este rol
// puede ver dentro de "Reportes"; ausente = todos visibles.
export type RolePermissions = Partial<Record<PermissionResource, PermissionAction[]>> & {
    reports_visible?: string[];
};

export type Role = {
    id: string;
    name: string;
    description: string;
    key?: string;
    isSystem?: boolean;
    permissions?: RolePermissions;
};

// Selección guardada del Panel Consolidado: qué empresas (donde el usuario es
// admin) y qué sucursales de cada una entran en los totales. Una empresa
// presente con array vacío = todas sus sucursales.
export type ConsolidatedDashboardConfig = {
    companyIds: string[];
    branchesByCompany: Record<string, string[]>;
};

export type CartItem = {
  cartItemId: string; // Unique identifier for the item in the cart
  product: Product;
  quantity: number;
  customPrice?: number;
};

export type Cart = {
  id: string;
  items: CartItem[];
  selectedCustomer: Customer;
  quoteId?: string; // si el carrito viene de una cotización cargada
  coupon?: Coupon; // cupón de fidelidad seleccionado para esta venta
};

export type FinancingDetails = {
  interestRate: number;
  installments: number;
  installmentAmount: number;
  totalWithInterest: number;
  downPayment?: number;
};

// Cuota de un plan de financiamiento. La genera y actualiza la base
// (trigger de la venta + RPC de abonos); el cliente solo la lee.
export type FinancingInstallment = {
  id: string;
  saleId: string;
  number: number;
  dueDate: string; // yyyy-mm-dd
  amount: number;
  paidAmount: number;
  lateFeePaid: number;
  status: 'pending' | 'partial' | 'paid';
  paidAt?: string;
};

export type Sale = {
  id: string;
  items: CartItem[];
  subtotal: number;
  itbisAmount: number;
  total: number;
  // Congelado al vender desde la config de la sucursal: true = los precios ya
  // traían el ITBIS (el recibo desglosa hacia adentro), false = se sumó encima.
  itbisIncluded?: boolean;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'credit' | 'financing';
  paymentStatus: 'paid' | 'credit' | 'in_financing';
  amountPaid: number;
  paymentReference?: string;
  // Método y referencia del abono inicial de una venta a crédito/financiada
  // (cómo entró ese dinero). Solo aplican cuando paymentStatus es credit/in_financing
  // y amountPaid > 0.
  downPaymentMethod?: PaymentMethod;
  downPaymentReference?: string;
  customer?: Customer;
  customerId?: string;
  createdAt: Date;
  branchId: string;
  financingDetails?: FinancingDetails;
  installments?: FinancingInstallment[];
  payments: CreditPayment[];
  notes?: string;
  userName?: string;
  userEmail?: string;
  ncf?: string;
  ncfType: NcfType;
  quoteId?: string; // cotización de origen (se marca convertida al cobrar)
  couponId?: string; // cupón de fidelidad canjeado en esta venta
  coupon?: Coupon; // objeto completo, solo para mostrarlo en el recibo (no se persiste aparte de couponId)
  // Venta anulada con nota de crédito (RPC annul_sale). La venta no se borra:
  // los reportes de ingresos la filtran y el 607 la reporta junto a su NC.
  cancelledAt?: Date;
};

// NCF anulado sin efecto (Formato 608): comprobante quemado por deterioro,
// error de impresión/digitación, etc. Registro manual de la empresa; las
// ventas anuladas con NC B04 NO van aquí (se reportan en el 607).
export type VoidedNcf = {
  id: string;
  ncf: string;
  voidedDate: string;   // yyyy-mm-dd
  reasonCode: string;   // '01'..'09' (catálogo en src/lib/dgii-608.ts)
  notes?: string;
  userName?: string;
  createdAt: Date;
};

// Nota de crédito (B04) emitida al anular una venta. Solo la escribe la RPC
// annul_sale; el cliente la lee para el historial y el Formato 607.
export type CreditNote = {
  id: string;
  saleId: string;
  customerId?: string;
  customerName?: string;
  customerRnc?: string;
  ncf?: string;         // B04; ausente en empresas sin NCF
  ncfModified?: string; // NCF de la venta original
  subtotal: number;
  itbisAmount: number;
  total: number;
  refundMethod?: PaymentMethod;
  reason?: string;
  userName?: string;
  createdAt: Date;
};

export type QuoteStatus = 'pending' | 'sent' | 'accepted' | 'rejected' | 'converted';

export type Quote = {
  id: string;
  items: CartItem[];
  customer?: Customer;
  customerId?: string;
  status: QuoteStatus;
  validUntil?: string;      // fecha (yyyy-mm-dd)
  subtotal: number;
  itbisAmount: number;
  total: number;
  notes?: string;
  userName?: string;
  branchId: string;         // nombre de sucursal (igual que Sale)
  createdAt: Date;
};

export type TicketNameDisplay = 'company' | 'branch' | 'both';

export type CompanyProfile = {
  name: string;
  phone: string;
  rnc: string;
  address: string;
  // Flags fiscales de la empresa (solo lectura: los administra el super admin
  // y la tarjeta de NCF). Gatean la sección fiscal DGII de Cuentas por Pagar
  // y el reporte Formato 606.
  isFormalized: boolean;
  ncfEnabled: boolean;
  socialMedia: {
    instagram: string;
    facebook: string;
  };
  logoUrl: string;
  ticketLogoUrl: string;
  receiptFooter: string;
  // Qué nombre encabeza el ticket: el de la empresa, el de la sucursal (o su
  // nombre comercial si lo tiene), o ambos.
  ticketNameDisplay: TicketNameDisplay;
  // Cómo se ve el negocio en el enlace del comprobante que va por WhatsApp:
  // sellalles.com/<linkSlug>/c/7Kq2Wp. Vacío = se deriva del nombre.
  linkSlug: string;
  lateFeeRate: number;         // % de mora sobre la cuota vencida
  defaultInterestRate: number; // % de interés mensual sugerido en el POS
  loanLateFeeRate: number;         // % de mora de préstamos (independiente de lateFeeRate)
  defaultLoanInterestRate: number; // % de interés mensual sugerido para préstamos
  loyaltyEnabled: boolean;
  loyaltyPurchasesRequired: number | null; // null = sin configurar
  loyaltyRewardDescription: string;
  loyaltyCouponValidDays: number;
};

export type PaymentMethod = 'cash' | 'card' | 'transfer';

export type CreditPayment = {
  id: string;
  saleId?: string;      // abonos generales a deuda no van ligados a una venta
  customerId: string;
  amount: number;
  lateFeePaid: number;  // parte del abono que fue mora
  method: PaymentMethod;
  reference?: string;   // identificador de transferencia/tarjeta
  notes?: string;
  userName?: string;
  date: Date;
  branchId: string;     // nombre de sucursal a nivel de app; se resuelve a UUID al guardar
};

// Resultado de las RPCs register_sale_payment / register_customer_payment.
export type PaymentResult = {
  paymentId: string;
  amount: number;
  lateFeePaid: number;
  principalPaid: number;
  remainingBalance: number;
  installmentsPaid: number | null;
  installmentsTotal: number | null;
  customerBalance: number | null;
};

// ---------- Préstamos (dominio independiente de ventas/financiamiento) ----------
export type LoanInstallment = {
  id: string;
  loanId: string;
  number: number;
  dueDate: string; // yyyy-mm-dd
  amount: number;
  paidAmount: number;
  lateFeePaid: number;
  status: 'pending' | 'partial' | 'paid';
  paidAt?: string;
};

export type LoanPayment = {
  id: string;
  loanId: string;
  customerId: string;
  amount: number;
  lateFeePaid: number;
  method: PaymentMethod;
  reference?: string;   // identificador de transferencia/tarjeta
  notes?: string;
  userName?: string;
  date: Date;
  branchId?: string;
};

export type LoanFrequency = 'weekly' | 'biweekly' | 'monthly';

export type Loan = {
  id: string;
  companyId?: string;
  branchId: string;
  customerId: string;
  customer?: Customer;
  principal: number;
  interestRate: number;
  installmentsCount: number;
  paymentFrequency: LoanFrequency;
  totalWithInterest: number;
  amountPaid: number;
  status: 'active' | 'paid' | 'cancelled';
  notes?: string;
  userName?: string;
  createdAt: Date;
  installments?: LoanInstallment[];
  payments?: LoanPayment[];
};

// Resultado de la RPC register_loan_payment.
export type LoanPaymentResult = {
  paymentId: string;
  amount: number;
  lateFeePaid: number;
  principalPaid: number;
  remainingBalance: number;
  installmentsPaid: number;
  installmentsTotal: number;
};

// ---------- Caja (control de efectivo por sucursal) ----------
export type CajaMovement = {
  id: string;
  sessionId: string;
  type: 'in' | 'out';
  amount: number;
  reason?: string;
  createdByName?: string;
  createdAt: Date;
};

// Desglose del efectivo del turno, snapshot guardado al cerrar la caja.
export type CajaBreakdown = {
  opening: number;
  cashSales: number;
  creditCashPayments: number;
  loanCashPayments: number;
  movementsIn: number;
  movementsOut: number;
  expected: number;
  declared: number;
  difference: number;
};

export type CajaSession = {
  id: string;
  branchId: string;      // uuid de la sucursal
  branchName?: string;   // nombre, cuando viene del join branches(name)
  status: 'open' | 'closed';
  openingAmount: number;
  openedByName?: string;
  openedAt: Date;
  closedByName?: string;
  closedAt?: Date;
  closingAmountDeclared?: number;
  closingAmountExpected?: number;
  difference?: number;
  notes?: string;
  breakdown?: CajaBreakdown;
  movements?: CajaMovement[];
};

// Resultado de la RPC close_caja_session.
export type CajaCloseResult = {
  sessionId: string;
  openingAmount: number;
  expected: number;
  declared: number;
  difference: number;
};

// ---------- Suscripción del SaaS (pagos por transferencia) ----------
export type SubscriptionPayment = {
  id: string;
  companyId: string;
  amount: number;
  paidAt: string;   // yyyy-mm-dd
  method: 'transfer' | 'cash' | 'card' | 'other';
  reference?: string;
  periodStart?: string;
  periodEnd?: string;
  planName?: string;
  notes?: string;
  recordedByName?: string;
  createdAt: Date;
};

export type Supplier = {
    id: string;
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    address: string;
    rnc?: string;
};

// Gasto del negocio. Los campos fiscales son opcionales: un gasto con NCF y
// RNC del suplidor entra al Formato 606 junto a las facturas de CxP.
export type Expense = {
    id: string;
    date: Date;
    description: string;
    amount: number;         // total pagado (con ITBIS incluido, si aplica)
    category: string;
    branchId: string;       // nombre de sucursal (misma convención que Sale)
    rnc?: string;           // RNC/cédula del suplidor del gasto
    ncf?: string;           // NCF del comprobante recibido
    expenseType?: string;   // tipo bienes/servicios 606 ('01'..'11')
    itbisAmount: number;    // parte de amount que es ITBIS
    isGoods: boolean;       // true = bienes, false = servicios (casillas 8/9 del 606)
    paymentForm?: string;   // forma de pago 606 ('01'..'07')
    userName?: string;
};

// ---------- Cuentas por Pagar (facturas de suplidores, Formato 606 DGII) ----------
export type SupplierInvoiceStatus = 'pending' | 'partial' | 'paid';

export type SupplierInvoiceItem = {
  id: string;
  invoiceId: string;
  productId?: string;   // ausente = línea libre (no toca inventario)
  description: string;
  quantity: number;
  unitCost: number;
  itbisAmount: number;
};

export type SupplierPayment = {
  id: string;
  invoiceId: string;
  supplierId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  userName?: string;
  date: Date;
  branchId: string;     // nombre de sucursal a nivel de app (join branches(name))
};

// Los códigos de los campos fiscales ('01'..'11', etc.) y sus etiquetas viven
// en src/lib/dgii-606.ts. Todos los montos fiscales son 0/undefined para
// empresas informales.
export type SupplierInvoice = {
  id: string;
  supplierId: string;
  supplier?: Supplier;
  branchId: string;         // nombre de sucursal (misma convención que Sale)
  invoiceNumber?: string;
  issueDate: string;        // yyyy-mm-dd (fecha comprobante 606)
  dueDate?: string;
  paymentDate?: string;     // última fecha de pago (606)
  status: SupplierInvoiceStatus;
  subtotalGoods: number;    // monto facturado bienes (606)
  subtotalServices: number; // monto facturado servicios (606)
  total: number;
  amountPaid: number;
  // total - retenciones - abonado: las retenciones se remiten a DGII, no al
  // suplidor, así que la factura queda saldada al cubrir este balance.
  balance: number;
  ncf?: string;
  ncfModified?: string;
  expenseType?: string;         // tipo bienes/servicios '01'..'11'
  itbisFacturado: number;
  itbisRetenido: number;
  itbisProporcionalidad: number;
  itbisLlevadoCosto: number;
  isrRetentionType?: string;    // '01'..'08'
  isrRetentionAmount: number;
  impuestoSelectivo: number;
  otrosImpuestos: number;
  propinaLegal: number;
  paymentForm?: string;         // forma de pago 606 '01'..'07'
  notes?: string;
  userName?: string;
  createdAt: Date;
  items: SupplierInvoiceItem[];
  payments: SupplierPayment[];
};

// Resultado de la RPC register_supplier_payment.
export type SupplierPaymentResult = {
  paymentId: string;
  amount: number;
  remainingBalance: number;
  status: SupplierInvoiceStatus;
};

export type ServiceType = {
    id: string;
    name: string;
    description?: string;
    basePrice: number;
};

export type ServiceStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid';

export type ServiceItem = {
    id: string;
    serviceId: string;
    product: Product;
    quantity: number;
    price: number;
    cost: number;
};

export type Service = {
    id: string;
    branchId: string;
    customerId?: string;
    customer?: Customer;
    serviceTypeId: string;
    serviceType?: ServiceType;
    assignedTo?: string;
    assignedUser?: User;
    description: string;
    status: ServiceStatus;
    laborPrice: number;
    partsTotal: number;
    total: number;
    paymentStatus: PaymentStatus;
    amountPaid: number;
    createdAt: Date;
    completedAt?: Date;
    items?: ServiceItem[];
};
