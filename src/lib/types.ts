
export type Product = {
  id: string;
  name: string;
  price: number;
  cost: number;
  itbis: boolean;
  image: string;
  stock: number;
  code: string;
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
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'cashier';
  branch: string;
  isSuperAdmin?: boolean;
};

export type Branch = {
  id: string;
  name: string;
  location: string;
};

export type Role = {
    id: string;
    name: string;
    description: string;
}

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
}

export type FinancingDetails = {
  interestRate: number;
  installments: number;
  installmentAmount: number;
  totalWithInterest: number;
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
  customer?: Customer;
  customerId?: string;
  createdAt: Date;
  branchId: string;
  financingDetails?: FinancingDetails;
  payments: CreditPayment[];
  notes?: string;
  userName?: string;
  userEmail?: string;
  ncf?: string;
  ncfType: 'consumer' | 'fiscal';
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
  receiptFooter: string;
};

export type CreditPayment = {
  id: string;
  saleId: string;
  customerId: string;
  amount: number;
  date: Date;
  branchId: string;
};

export type Supplier = {
    id: string;
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    address: string;
};

export type Expense = {
    id: string;
    date: Date;
    description: string;
    amount: number;
    category: string;
    branchId: string;
}
