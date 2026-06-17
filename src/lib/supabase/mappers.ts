// Conversión entre filas de Supabase (snake_case) y los tipos de la app (camelCase).
import type { Product, Customer, Branch, Supplier, Expense, Sale, CartItem, CompanyProfile } from '@/lib/types';

// ---------- Product ----------
export const rowToProduct = (r: any): Product => ({
  id: r.id, name: r.name, price: Number(r.price), cost: Number(r.cost),
  itbis: !!r.itbis, image: r.image ?? '', stock: Number(r.stock), code: r.code ?? '',
});
export const productToRow = (p: Partial<Product>) => ({
  name: p.name, code: p.code ?? null, price: p.price, cost: p.cost,
  itbis: p.itbis ?? false, image: p.image ?? null, stock: p.stock ?? 0,
});

// ---------- Customer ----------
export const rowToCustomer = (r: any): Customer => ({
  id: r.id, name: r.name, phone: r.phone ?? '', email: r.email ?? undefined,
  address: r.address ?? undefined, rnc: r.rnc ?? undefined, birthdate: r.birthdate ?? undefined,
  ncfType: r.ncf_type, notes: r.notes ?? undefined, creditBalance: Number(r.credit_balance ?? 0),
});
export const customerToRow = (c: Partial<Customer>) => ({
  name: c.name, phone: c.phone ?? null, email: c.email ?? null, address: c.address ?? null,
  rnc: c.rnc ?? null, birthdate: c.birthdate ?? null, ncf_type: c.ncfType ?? 'consumer',
  notes: c.notes ?? null, credit_balance: c.creditBalance ?? 0,
});

// ---------- Branch ----------
export const rowToBranch = (r: any): Branch => ({ id: r.id, name: r.name, location: r.location ?? '' });
export const branchToRow = (b: Partial<Branch>) => ({ name: b.name, location: b.location ?? null });

// ---------- Supplier ----------
export const rowToSupplier = (r: any): Supplier => ({
  id: r.id, name: r.name, contactPerson: r.contact_person ?? '', phone: r.phone ?? '',
  email: r.email ?? '', address: r.address ?? '',
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
});
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

export const rowToSale = (r: any): Sale => ({
  id: r.id,
  items: (r.sale_items ?? []).map(rowToCartItem),
  subtotal: Number(r.subtotal), itbisAmount: Number(r.itbis_amount), total: Number(r.total),
  paymentMethod: r.payment_method, paymentStatus: r.payment_status, amountPaid: Number(r.amount_paid),
  paymentReference: r.payment_reference ?? undefined,
  customer: r.customers ? rowToCustomer(r.customers) : undefined,
  customerId: r.customer_id ?? undefined,
  createdAt: new Date(r.created_at), branchId: r.branch_id ?? '',
  financingDetails: r.financing_details ?? undefined,
  payments: [],
  notes: r.notes ?? undefined, userName: r.user_name ?? undefined, userEmail: r.user_email ?? undefined,
  ncf: r.ncf ?? undefined, ncfType: r.ncf_type,
});

export const saleToRow = (s: Omit<Sale, 'id'>) => ({
  branch_id: s.branchId || null, customer_id: s.customerId || null,
  subtotal: s.subtotal, itbis_amount: s.itbisAmount, total: s.total,
  payment_method: s.paymentMethod, payment_status: s.paymentStatus, amount_paid: s.amountPaid,
  payment_reference: s.paymentReference ?? null, ncf: s.ncf ?? null, ncf_type: s.ncfType,
  notes: s.notes ?? null, financing_details: s.financingDetails ?? null,
  user_name: s.userName ?? null, user_email: s.userEmail ?? null,
});

export const saleItemToRow = (item: CartItem, saleId: string) => ({
  sale_id: saleId, product_id: item.product.id || null, product_name: item.product.name,
  quantity: item.quantity, price: item.product.price,
  custom_price: item.customPrice ?? null, itbis: item.product.itbis,
});
