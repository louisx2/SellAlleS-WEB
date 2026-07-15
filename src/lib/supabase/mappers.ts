import type { Product, Customer, Branch, Supplier, Expense, Sale, CartItem, CompanyProfile, CreditPayment, FinancingInstallment, PaymentResult, Quote, ProductCategory, ProductLocation, Loan, LoanInstallment, LoanPayment, LoanPaymentResult, Coupon, CajaSession, CajaMovement, CajaCloseResult, SubscriptionPayment } from '@/lib/types';
import { isUuid } from '@/lib/utils';

// ---------- Product ----------
export const rowToProduct = (r: any): Product => ({
  id: r.id, 
  code: r.code ?? '',
  categoryId: r.category_id ?? undefined,
  name: r.name, 
  description: r.description ?? undefined,
  supplierId: r.supplier_id ?? undefined,
  price: Number(r.price), 
  cost: Number(r.cost),
  itbis: !!r.itbis, 
  image: r.image ?? '', 
  stock: Number(r.stock),
  locationId: r.location_id ?? undefined,
  entryDate: r.entry_date ?? undefined,
  modificationDate: r.modification_date ?? undefined,
  wholesalePrice: r.wholesale_price != null ? Number(r.wholesale_price) : undefined,
  wholesaleMinQuantity: r.wholesale_min_quantity != null ? Number(r.wholesale_min_quantity) : undefined,
});
export const productToRow = (p: Partial<Product>) => ({
  code: p.code ?? null, 
  category_id: p.categoryId ?? null,
  name: p.name, 
  description: p.description ?? null,
  supplier_id: p.supplierId ?? null,
  price: p.price, 
  cost: p.cost,
  itbis: p.itbis ?? false, 
  image: p.image ?? null, 
  stock: p.stock ?? 0,
  location_id: p.locationId ?? null,
  entry_date: p.entryDate ?? null,
  modification_date: p.modificationDate ?? null,
  wholesale_price: p.wholesalePrice ?? null,
  wholesale_min_quantity: p.wholesaleMinQuantity ?? null,
});

// ---------- Product Category ----------
export const rowToProductCategory = (r: any): ProductCategory => ({
  id: r.id,
  name: r.name,
});
export const productCategoryToRow = (c: Partial<ProductCategory>) => ({
  name: c.name,
});

// ---------- Product Location ----------
export const rowToProductLocation = (r: any): ProductLocation => ({
  id: r.id,
  name: r.name,
});
export const productLocationToRow = (l: Partial<ProductLocation>) => ({
  name: l.name,
});

// ---------- Customer ----------
export const rowToCustomer = (r: any): Customer => ({
  id: r.id, name: r.name, phone: r.phone ?? '', email: r.email ?? undefined,
  address: r.address ?? undefined, rnc: r.rnc ?? undefined, birthdate: r.birthdate ?? undefined,
  ncfType: r.ncf_type, notes: r.notes ?? undefined, creditBalance: Number(r.credit_balance ?? 0),
  creditLimit: r.credit_limit != null ? Number(r.credit_limit) : null,
  discountPercentage: Number(r.discount_percentage ?? 0),
  loyaltyPurchaseCount: Number(r.loyalty_purchase_count ?? 0),
  createdAt: r.created_at,
  createdBy: r.created_by,
  createdByName: r.profiles?.name || undefined,
});
// credit_balance NO se manda: solo lo escribe el servidor (triggers de venta y
// RPCs de abono); en el insert aplica el default 0 de la base.
export const customerToRow = (c: Partial<Customer>) => ({
  name: c.name, phone: c.phone ?? null, email: c.email ?? null, address: c.address ?? null,
  rnc: c.rnc ?? null, 
  birthdate: c.birthdate && c.birthdate.trim() !== '' ? c.birthdate : null, 
  ncf_type: c.ncfType ?? 'consumer',
  notes: c.notes ?? null, credit_limit: c.creditLimit ?? null,
  discount_percentage: c.discountPercentage ?? 0,
});

// ---------- Branch ----------
export const rowToBranch = (r: any): Branch => ({ id: r.id, name: r.name, location: r.location ?? '', isActive: r.is_active ?? true });
export const branchToRow = (b: Partial<Branch>) => ({ name: b.name, location: b.location ?? null });

// ---------- Supplier ----------
export const rowToSupplier = (r: any): Supplier => ({
  id: r.id, name: r.name, contactPerson: r.contact_person ?? '', phone: r.phone ?? '',
  email: r.email ?? '', address: r.address ?? '', rnc: r.rnc ?? '',
});
export const supplierToRow = (s: Partial<Supplier>) => ({
  name: s.name,
  contact_person: s.contactPerson ?? null,
  phone: s.phone ?? null,
  email: s.email ?? null,
  address: s.address ?? null,
  rnc: s.rnc ?? null,
});

// ---------- Expense ----------
export const rowToExpense = (r: any): Expense => ({
  id: r.id, date: new Date(r.date), description: r.description, amount: Number(r.amount),
  category: r.category ?? '', branchId: r.branch_id ?? '',
});

// ---------- CompanyProfile ----------
export const rowToCompanyProfile = (r: any): CompanyProfile => ({
  name: r.name ?? '', phone: r.phone ?? '', rnc: r.rnc ?? '', address: r.address ?? '',
  socialMedia: { instagram: r.instagram ?? '', facebook: r.facebook ?? '' },
  logoUrl: r.logo_url ?? '', receiptFooter: r.receipt_footer ?? '',
  lateFeeRate: Number(r.late_fee_rate ?? 5),
  defaultInterestRate: Number(r.default_interest_rate ?? 3.5),
  loanLateFeeRate: Number(r.loan_late_fee_rate ?? 5),
  defaultLoanInterestRate: Number(r.default_loan_interest_rate ?? 5),
  loyaltyEnabled: !!r.loyalty_enabled,
  loyaltyPurchasesRequired: r.loyalty_purchases_required != null ? Number(r.loyalty_purchases_required) : null,
  loyaltyRewardDescription: r.loyalty_reward_description ?? '',
  loyaltyCouponValidDays: Number(r.loyalty_coupon_valid_days ?? 30),
});
// name se envía siempre; el trigger trg_lock_company_name ignora el cambio si
// quien actualiza no es super admin (solo él puede renombrar la empresa).
export const companyProfileToRow = (p: Partial<CompanyProfile>) => ({
  name: p.name, phone: p.phone ?? null, rnc: p.rnc ?? null, address: p.address ?? null,
  instagram: p.socialMedia?.instagram ?? null, facebook: p.socialMedia?.facebook ?? null,
  logo_url: p.logoUrl ?? null, receipt_footer: p.receiptFooter ?? null,
});

// ---------- Sale (con sale_items y customer embebidos) ----------
const rowToCartItem = (i: any): CartItem => ({
  cartItemId: i.id,
  quantity: Number(i.quantity),
  customPrice: i.custom_price != null ? Number(i.custom_price) : undefined,
  product: {
    id: i.product_id ?? '', name: i.product_name, price: Number(i.price), cost: 0,
    itbis: !!i.itbis, image: '', stock: 0, code: '',
  },
});

export const rowToFinancingInstallment = (r: any): FinancingInstallment => ({
  id: r.id,
  saleId: r.sale_id,
  number: Number(r.installment_number),
  dueDate: r.due_date,
  amount: Number(r.amount),
  paidAmount: Number(r.paid_amount),
  lateFeePaid: Number(r.late_fee_paid),
  status: r.status,
  paidAt: r.paid_at ?? undefined,
});

export const rowToCreditPayment = (r: any): CreditPayment => ({
  id: r.id,
  saleId: r.sale_id ?? undefined,
  customerId: r.customer_id ?? '',
  amount: Number(r.amount),
  lateFeePaid: Number(r.late_fee_paid ?? 0),
  method: r.method ?? 'cash',
  reference: r.reference ?? undefined,
  notes: r.notes ?? undefined,
  userName: r.user_name ?? undefined,
  date: new Date(r.date),
  branchId: r.branches?.name ?? '',
});

// jsonb devuelto por register_sale_payment / register_customer_payment.
export const rowToPaymentResult = (r: any): PaymentResult => ({
  paymentId: r.payment_id,
  amount: Number(r.amount),
  lateFeePaid: Number(r.late_fee_paid ?? 0),
  principalPaid: Number(r.principal_paid ?? 0),
  remainingBalance: Number(r.remaining_balance ?? 0),
  installmentsPaid: r.installments_paid != null ? Number(r.installments_paid) : null,
  installmentsTotal: r.installments_total != null ? Number(r.installments_total) : null,
  customerBalance: r.customer_balance != null ? Number(r.customer_balance) : null,
});

export const rowToSale = (r: any): Sale => ({
  id: r.id,
  items: (r.sale_items ?? []).map(rowToCartItem),
  subtotal: Number(r.subtotal), itbisAmount: Number(r.itbis_amount), total: Number(r.total),
  paymentMethod: r.payment_method, paymentStatus: r.payment_status, amountPaid: Number(r.amount_paid),
  paymentReference: r.payment_reference ?? undefined,
  customer: r.customers ? rowToCustomer(r.customers) : undefined,
  customerId: r.customer_id ?? undefined,
  createdAt: new Date(r.created_at),
  // La app usa el NOMBRE de la sucursal como identidad (filtros, recibos);
  // en la base es branch_id uuid — al leer se traduce con el join branches(name).
  branchId: r.branches?.name ?? '',
  financingDetails: r.financing_details ?? undefined,
  installments: (r.financing_installments ?? [])
    .map(rowToFinancingInstallment)
    .sort((a: FinancingInstallment, b: FinancingInstallment) => a.number - b.number),
  payments: [],
  notes: r.notes ?? undefined, userName: r.user_name ?? undefined, userEmail: r.user_email ?? undefined,
  ncf: r.ncf ?? undefined, ncfType: r.ncf_type,
  quoteId: r.quote_id ?? undefined,
  couponId: r.coupon_id ?? undefined,
});

// branchUuid ya resuelto por el provider (nombre → uuid).
// customer_id '0' = Cliente Genérico (solo existe en el cliente) → NULL.
export const saleToRow = (s: Omit<Sale, 'id'>, branchUuid: string | null) => ({
  branch_id: branchUuid,
  customer_id: isUuid(s.customerId) ? s.customerId : null,
  subtotal: s.subtotal, itbis_amount: s.itbisAmount, total: s.total,
  payment_method: s.paymentMethod, payment_status: s.paymentStatus, amount_paid: s.amountPaid,
  payment_reference: s.paymentReference ?? null, ncf: s.ncf ?? null, ncf_type: s.ncfType,
  down_payment_method: s.downPaymentMethod ?? null,
  down_payment_reference: s.downPaymentReference ?? null,
  notes: s.notes ?? null, financing_details: s.financingDetails ?? null,
  user_name: s.userName ?? null, user_email: s.userEmail ?? null,
  quote_id: isUuid(s.quoteId) ? s.quoteId : null,
  coupon_id: isUuid(s.couponId) ? s.couponId : null,
});

// ---------- Coupon (fidelidad) ----------
export const rowToCoupon = (r: any): Coupon => ({
  id: r.id,
  customerId: r.customer_id,
  code: r.code,
  rewardDescription: r.reward_description,
  milestoneCount: Number(r.milestone_count),
  status: r.status,
  issuedAt: r.issued_at,
  expiresAt: r.expires_at,
  redeemedAt: r.redeemed_at ?? undefined,
  redeemedSaleId: r.redeemed_sale_id ?? undefined,
});

// ---------- Quote (con quote_items y customer embebidos) ----------
const rowToQuoteItem = (i: any): CartItem => ({
  cartItemId: i.id,
  quantity: Number(i.quantity),
  customPrice: i.custom_price != null ? Number(i.custom_price) : undefined,
  product: {
    id: i.product_id ?? '', name: i.product_name, price: Number(i.price), cost: 0,
    itbis: !!i.itbis, image: '', stock: 0, code: '',
  },
});

export const rowToQuote = (r: any): Quote => ({
  id: r.id,
  items: (r.quote_items ?? []).map(rowToQuoteItem),
  customer: r.customers ? rowToCustomer(r.customers) : undefined,
  customerId: r.customer_id ?? undefined,
  status: r.status,
  validUntil: r.valid_until ?? undefined,
  subtotal: Number(r.subtotal), itbisAmount: Number(r.itbis_amount), total: Number(r.total),
  notes: r.notes ?? undefined,
  userName: r.user_name ?? undefined,
  branchId: r.branches?.name ?? '',
  createdAt: new Date(r.created_at),
});

export const quoteToRow = (q: Omit<Quote, 'id' | 'items' | 'createdAt'>, branchUuid: string | null) => ({
  branch_id: branchUuid,
  customer_id: isUuid(q.customerId) ? q.customerId : null,
  status: q.status,
  valid_until: q.validUntil ?? null,
  subtotal: q.subtotal, itbis_amount: q.itbisAmount, total: q.total,
  notes: q.notes ?? null,
  user_name: q.userName ?? null,
});

export const quoteItemToRow = (item: CartItem, quoteId: string) => ({
  quote_id: quoteId, product_id: item.product.id || null, product_name: item.product.name,
  quantity: item.quantity, price: item.product.price,
  custom_price: item.customPrice ?? null, itbis: item.product.itbis,
});

export const saleItemToRow = (item: CartItem, saleId: string) => ({
  sale_id: saleId, product_id: item.product.id || null, product_name: item.product.name,
  quantity: item.quantity, price: item.product.price,
  custom_price: item.customPrice ?? null, itbis: item.product.itbis,
});

// ---------- Services ----------
export const rowToServiceType = (r: any): import('@/lib/types').ServiceType => ({
  id: r.id,
  name: r.name,
  description: r.description ?? undefined,
  basePrice: Number(r.base_price ?? 0),
});

export const serviceTypeToRow = (s: Partial<import('@/lib/types').ServiceType>) => ({
  name: s.name,
  description: s.description ?? null,
  base_price: s.basePrice ?? 0,
});

export const rowToServiceItem = (r: any): import('@/lib/types').ServiceItem => ({
  id: r.id,
  serviceId: r.service_id,
  product: r.products ? rowToProduct(r.products) : {} as any,
  quantity: Number(r.quantity),
  price: Number(r.price),
  cost: Number(r.cost),
});

export const serviceItemToRow = (item: Omit<import('@/lib/types').ServiceItem, 'id' | 'product'>) => ({
  service_id: item.serviceId,
  product_id: (item as any).productId || null, // When sending to DB we just need product_id
  quantity: item.quantity,
  price: item.price,
  cost: item.cost,
});

export const rowToService = (r: any): import('@/lib/types').Service => ({
  id: r.id,
  branchId: r.branches?.name ?? '',
  customerId: r.customer_id ?? undefined,
  customer: r.customers ? rowToCustomer(r.customers) : undefined,
  serviceTypeId: r.service_type_id,
  serviceType: r.service_types ? rowToServiceType(r.service_types) : undefined,
  assignedTo: r.assigned_to ?? undefined,
  assignedUser: r.profiles ? {
    id: r.profiles.id,
    name: r.profiles.name,
    email: r.profiles.email,
    role: r.profiles.role,
    branch: ''
  } : undefined,
  description: r.description,
  status: r.status,
  laborPrice: Number(r.labor_price),
  partsTotal: Number(r.parts_total),
  total: Number(r.total),
  paymentStatus: r.payment_status,
  amountPaid: Number(r.amount_paid),
  createdAt: new Date(r.created_at),
  completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
  items: r.service_items ? r.service_items.map(rowToServiceItem) : undefined,
});

export const serviceToRow = (s: Partial<import('@/lib/types').Service>, branchUuid?: string) => {
  const row: any = {
    customer_id: isUuid(s.customerId) ? s.customerId : null,
    service_type_id: s.serviceTypeId,
    assigned_to: isUuid(s.assignedTo) ? s.assignedTo : null,
    description: s.description,
    status: s.status,
    labor_price: s.laborPrice,
    payment_status: s.paymentStatus,
    amount_paid: s.amountPaid,
  };
  if (branchUuid) row.branch_id = branchUuid;
  if (s.completedAt) row.completed_at = s.completedAt.toISOString();
  return row;
};

// ---------- Préstamos (dominio independiente de ventas/financiamiento) ----------
export const rowToLoanInstallment = (r: any): LoanInstallment => ({
  id: r.id,
  loanId: r.loan_id,
  number: Number(r.installment_number),
  dueDate: r.due_date,
  amount: Number(r.amount),
  paidAmount: Number(r.paid_amount),
  lateFeePaid: Number(r.late_fee_paid),
  status: r.status,
  paidAt: r.paid_at ?? undefined,
});

export const rowToLoanPayment = (r: any): LoanPayment => ({
  id: r.id,
  loanId: r.loan_id,
  customerId: r.customer_id,
  amount: Number(r.amount),
  lateFeePaid: Number(r.late_fee_paid ?? 0),
  method: r.method,
  reference: r.reference ?? undefined,
  notes: r.notes ?? undefined,
  userName: r.user_name ?? undefined,
  date: new Date(r.date),
  branchId: r.branch_id ?? undefined,
});

export const rowToLoan = (r: any): Loan => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  customerId: r.customer_id,
  customer: r.customers ? rowToCustomer(r.customers) : undefined,
  principal: Number(r.principal),
  interestRate: Number(r.interest_rate),
  installmentsCount: Number(r.installments_count),
  paymentFrequency: r.payment_frequency ?? 'monthly',
  totalWithInterest: Number(r.total_with_interest),
  amountPaid: Number(r.amount_paid),
  status: r.status,
  notes: r.notes ?? undefined,
  userName: r.user_name ?? undefined,
  createdAt: new Date(r.created_at),
  installments: (r.loan_installments ?? [])
    .map(rowToLoanInstallment)
    .sort((a: LoanInstallment, b: LoanInstallment) => a.number - b.number),
});

export const loanToRow = (l: {
  branchId: string; customerId: string; principal: number; interestRate: number;
  installmentsCount: number; paymentFrequency: string; notes?: string; userName?: string;
}) => ({
  branch_id: l.branchId,
  customer_id: l.customerId,
  principal: l.principal,
  interest_rate: l.interestRate,
  installments_count: l.installmentsCount,
  payment_frequency: l.paymentFrequency,
  notes: l.notes ?? null,
  user_name: l.userName ?? null,
});

export const rowToLoanPaymentResult = (r: any): LoanPaymentResult => ({
  paymentId: r.payment_id,
  amount: Number(r.amount),
  lateFeePaid: Number(r.late_fee_paid ?? 0),
  principalPaid: Number(r.principal_paid ?? 0),
  remainingBalance: Number(r.remaining_balance ?? 0),
  installmentsPaid: Number(r.installments_paid ?? 0),
  installmentsTotal: Number(r.installments_total ?? 0),
});

// ---------- Caja ----------
export const rowToCajaMovement = (r: any): CajaMovement => ({
  id: r.id,
  sessionId: r.session_id,
  type: r.type,
  amount: Number(r.amount),
  reason: r.reason ?? undefined,
  createdByName: r.created_by_name ?? undefined,
  createdAt: new Date(r.created_at),
});

export const rowToCajaSession = (r: any): CajaSession => ({
  id: r.id,
  branchId: r.branch_id,
  branchName: r.branches?.name ?? undefined,
  status: r.status,
  openingAmount: Number(r.opening_amount),
  openedByName: r.opened_by_name ?? undefined,
  openedAt: new Date(r.opened_at),
  closedByName: r.closed_by_name ?? undefined,
  closedAt: r.closed_at ? new Date(r.closed_at) : undefined,
  closingAmountDeclared: r.closing_amount_declared != null ? Number(r.closing_amount_declared) : undefined,
  closingAmountExpected: r.closing_amount_expected != null ? Number(r.closing_amount_expected) : undefined,
  difference: r.difference != null ? Number(r.difference) : undefined,
  notes: r.notes ?? undefined,
  breakdown: r.breakdown ?? undefined,
  movements: (r.caja_movements ?? []).map(rowToCajaMovement),
});

export const rowToCajaCloseResult = (r: any): CajaCloseResult => ({
  sessionId: r.session_id,
  openingAmount: Number(r.opening_amount ?? 0),
  expected: Number(r.expected ?? 0),
  declared: Number(r.declared ?? 0),
  difference: Number(r.difference ?? 0),
});

// ---------- Suscripción ----------
export const rowToSubscriptionPayment = (r: any): SubscriptionPayment => ({
  id: r.id,
  companyId: r.company_id,
  amount: Number(r.amount),
  paidAt: r.paid_at,
  method: r.method,
  reference: r.reference ?? undefined,
  periodStart: r.period_start ?? undefined,
  periodEnd: r.period_end ?? undefined,
  planName: r.plan_name ?? undefined,
  notes: r.notes ?? undefined,
  recordedByName: r.recorded_by_name ?? undefined,
  createdAt: new Date(r.created_at),
});

