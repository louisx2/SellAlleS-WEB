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

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  rnc?: string;
  birthdate?: string;
  ncfType: 'consumer' | 'fiscal';
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
  role: 'admin' | 'cashier';
  branch: string; // Nombre de la sucursal activa
  activeBranchId?: string; // ID de la sucursal activa
  branches?: { id: string; name: string }[]; // Lista de sucursales a las que pertenece
  companyId?: string;
  companyStatus?: 'trial' | 'active' | 'suspended';
  companyDemoExpiresAt?: string; // empresa de prueba pública ("Probar Plataforma"); se banea al vencer
  companyTrialEndsAt?: string; // fin de la prueba de 14 días (null en empresas sin límite)
  companyPaidUntil?: string; // suscripción pagada hasta esta fecha (null = sin vencimiento)
  isReadOnly?: boolean; // prueba/suscripción vencida: puede entrar y ver, pero no modificar
  impersonatedCompanyId?: string;
  impersonatedCompanyName?: string;
  isSuperAdmin?: boolean;
  customRoles?: Role[]; // Roles adicionales asignados al usuario
  companies?: { id: string; name: string; status: 'trial' | 'active' | 'suspended'; isDemo: boolean }[];
  emailConfirmedAt?: string | null;
  companyMaxUsers?: number | null;
};

export type Branch = {
  id: string;
  name: string;
  location: string;
  isActive: boolean;
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
  | 'prestamos' | 'caja' | 'expenses' | 'reports' | 'products' | 'customers'
  | 'suppliers' | 'company-profile' | 'users' | 'branches' | 'roles' | 'suscripcion'
  | 'service-types';

export type Role = {
    id: string;
    name: string;
    description: string;
    key?: string;
    isSystem?: boolean;
    permissions?: Partial<Record<PermissionResource, PermissionAction[]>>;
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
  ncfType: 'consumer' | 'fiscal';
  quoteId?: string; // cotización de origen (se marca convertida al cobrar)
  couponId?: string; // cupón de fidelidad canjeado en esta venta
  coupon?: Coupon; // objeto completo, solo para mostrarlo en el recibo (no se persiste aparte de couponId)
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

export type CompanyProfile = {
  name: string;
  phone: string;
  rnc: string;
  address: string;
  socialMedia: {
    instagram: string;
    facebook: string;
  };
  logoUrl: string;
  ticketLogoUrl: string;
  receiptFooter: string;
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

export type Expense = {
    id: string;
    date: Date;
    description: string;
    amount: number;
    category: string;
    branchId: string;
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
