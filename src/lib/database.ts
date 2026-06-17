import type { Product, Customer, Sale, User, Branch, Role, CompanyProfile, CreditPayment, Supplier, Expense } from './types';

// Datos semilla en memoria para arrancar la app sin backend externo.
// SIGUIENTE PASO (Supabase): estos arreglos se reemplazan por consultas a las
// tablas correspondientes, filtradas por empresa_id (multi-empresa) vía RLS.

export const branches: Branch[] = [
    { id: '1', name: 'Principal', location: 'San José de Ocoa' },
    { id: '2', name: 'Rancho Arriba', location: 'Rancho Arriba, Ocoa' },
];

export const users: User[] = [
    { id: 'louis-admin', name: 'Louis Encarnacion', email: 'loui-s@hotmail.com', role: 'admin', branch: 'Principal' },
    { id: '2', name: 'Laura Martinez', email: 'laura.martinez@sellalles.com', role: 'cashier', branch: 'Rancho Arriba' },
];

export const roles: Role[] = [
    { id: 'admin', name: 'Administrador', description: 'Tiene acceso a todas las funciones del sistema.' },
    { id: 'cashier', name: 'Cajero', description: 'Tiene acceso al punto de venta y funciones básicas.' },
];

export const companyProfile: CompanyProfile = {
    name: 'SellAlleS',
    phone: '809-555-1234',
    rnc: '1-31-12345-6',
    address: 'Calle Principal #123, San José de Ocoa',
    socialMedia: {
        instagram: '@sellalles.rd',
        facebook: 'fb.com/sellalles.rd'
    },
    logoUrl: 'https://picsum.photos/seed/logo/200/200',
    receiptFooter: '¡Gracias por su compra! Vuelva pronto.'
}

// Cliente genérico por defecto (no proviene de la base de datos).
export const getGenericCustomer = (): Customer => {
    return { id: '0', name: 'Cliente Genérico', phone: '', rnc: '', ncfType: 'consumer', creditBalance: 0 };
};

export const products: Product[] = [
  { id: '1', name: 'iPhone 15 Pro', price: 75000, cost: 60000, itbis: true, image: 'iphone_15_pro', stock: 15, code: '111111' },
  { id: '2', name: 'Samsung Galaxy S24 Ultra', price: 72000, cost: 58000, itbis: true, image: 'galaxy_s24_ultra', stock: 12, code: '222222' },
  { id: '3', name: 'Google Pixel 8 Pro', price: 65000, cost: 52000, itbis: true, image: 'pixel_8_pro', stock: 10, code: '333333' },
  { id: '4', name: 'AirPods Pro 2da Gen', price: 15000, cost: 11000, itbis: true, image: 'airpods_pro_2', stock: 30, code: '444444' },
  { id: '5', name: 'Galaxy Buds FE', price: 5500, cost: 4000, itbis: true, image: 'galaxy_buds_fe', stock: 25, code: '555555' },
  { id: '6', name: 'Cargador USB-C 30W', price: 1500, cost: 800, itbis: false, image: 'usb_c_charger_30w', stock: 50, code: '666666' },
  { id: '7', name: 'Forro Transparente iPhone', price: 800, cost: 300, itbis: false, image: 'iphone_case_clear', stock: 100, code: '777777' },
  { id: '8', name: 'Protector de Pantalla Vidrio', price: 600, cost: 200, itbis: false, image: 'screen_protector', stock: 150, code: '888888' },
  { id: '9', name: 'Power Bank Anker', price: 2500, cost: 1800, itbis: true, image: 'power_bank_anker', stock: 40, code: '999999' },
  { id: '10', name: 'Cargador Inalámbrico', price: 1800, cost: 1200, itbis: true, image: 'wireless_charger', stock: 35, code: '101010' },
];

export let customers: Customer[] = [getGenericCustomer()];
export let sales: Sale[] = [];
export let creditPayments: CreditPayment[] = [];
export const suppliers: Supplier[] = [];
export const expenses: Expense[] = [];
