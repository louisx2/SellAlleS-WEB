import type { RegistrationStatus, VehicleCondition, VehicleOrigin, VehicleStatus } from '@/lib/motos';
import type { ResultadoVisita } from '@/lib/cobranza';
import type { EstadoDeRecuperacion } from '@/lib/motos-recuperacion';
import type { UnitCode } from './units';
import type { InterestMode, PaymentFrequency } from './frequency';
import type { LateFeeMode } from './late-fee';
import type { MotivoBloqueo } from './bloqueo';
import type { CampoCliente } from './datos-cliente';

export type { InterestMode, PaymentFrequency } from './frequency';
export type { LateFeeMode } from './late-fee';

// Una forma de vender el producto por varias unidades base (paquete, caja, saco).
// El stock siempre se cuenta en unidades base: una presentación solo dice cuántas
// unidades trae (`units`) y a qué precio se vende. Mapea a `product_presentations`.
export type ProductPresentation = {
  id: string;
  name: string;
  units: number;  // unidades base que trae; > 1 (entero salvo en unidades medibles)
  price: number;  // precio de la presentación completa
  code?: string;  // código de barras propio; único en la sucursal
};

// Copia de la presentación que lleva una línea (carrito, venta, cotización, compra).
// Es una foto: `id` falta cuando la presentación se borró después de vender o cotizar,
// y `name`/`units` se conservan para que el documento viejo se reimprima igual.
export type LinePresentation = {
  id?: string;
  name: string;
  units: number;
};

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
  unit: UnitCode;
  tracksStock: boolean;
  // Servicio (no mercancía): el e-CF lo marca con el indicador de servicio y no
  // de bien. undefined = bien; solo se pregunta con el módulo de e-CF encendido.
  esServicio?: boolean;
  locationId?: string;
  entryDate?: string;
  modificationDate?: string;
  wholesalePrice?: number;
  wholesaleMinQuantity?: number;
  branchId?: string;
  // Se vende suelto (por unidad base). undefined = sí; así los productos y los
  // carritos anteriores a las presentaciones no cambian.
  soldLoose?: boolean;
  presentations?: ProductPresentation[];
  // Motopréstamos: cada unidad es un vehículo con su chasis y el stock lo
  // calcula la base con las unidades disponibles.
  isVehicle?: boolean;
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
  /** UUID de la sucursal dueña. Vacío = de la empresa, visible desde todas. */
  branchId?: string;
  // Datos de cobranza (módulo Motopréstamos).
  nickname?: string;
  workplace?: string;
  zone?: string;
  collectionAddress?: string;
  collectionReference?: string;
};

/** Garante o fiador del cliente (Motopréstamos). */
export type CustomerGuarantor = {
  id: string;
  customerId: string;
  name: string;
  idDoc?: string;
  phone?: string;
  address?: string;
  relationship?: string;
};

/** Ajustes del módulo Motopréstamos (una fila por empresa; sin fila = por defecto). */
export type MotosSettings = {
  custodyFinancedSale: boolean;
  custodyCashSale: boolean;
  custodyLoan: boolean;
  requireGuarantor: boolean;
  /** Vacío = el texto base de src/lib/contrato.ts. */
  contractSale?: string;
  contractLoan?: string;
  /** Mensajes de WhatsApp de la cobranza. Vacío = el texto base de src/lib/cobranza-mensajes.ts. */
  whatsappReminder?: string;
  whatsappReceipt?: string;
};

/** Foto de una moto o de la cédula de un cliente (bucket privado `motos`). */
export type MotosPhoto = { id: string; path: string; createdAt: Date; url?: string };

/** Referencia personal o comercial del cliente (Motopréstamos). */
export type CustomerReference = {
  id: string;
  customerId: string;
  name: string;
  phone?: string;
  relationship?: string;
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
  // Rol que tiene EN cada sucursal (branchId -> roleId). Puede ser distinto en
  // cada una: Gerente en una, Técnico en otra.
  branchRoles?: Record<string, string>;
  companyId?: string;
  companyStatus?: 'trial' | 'active' | 'suspended';
  // Nombre de la empresa activa y, si está suspendida, por qué y desde cuándo
  // (lib/suspension.ts).
  companyName?: string;
  companySuspensionReason?: string | null;
  companySuspendedAt?: string | null;
  companyDemoExpiresAt?: string; // empresa de prueba pública ("Probar Plataforma"); se banea al vencer
  companyTrialEndsAt?: string; // fin de la prueba de 14 días (null en empresas sin límite)
  companyPaidUntil?: string; // suscripción pagada hasta esta fecha (null = sin vencimiento)
  // Modo solo facturación (lib/bloqueo.ts): la prueba venció, o el super admin
  // la pasó a "solo ventas" por atraso. Solo ve el Carrito, Movimientos, la
  // Caja y Mi Suscripción. null = opera normal.
  bloqueo?: MotivoBloqueo | null;
  // Admin de la empresa activa (o super admin dentro de ella): el que ve el
  // aviso de cuotas y reporta los pagos.
  isCompanyAdmin?: boolean;
  // Dueño del negocio (profile_companies.es_dueno): ve el aviso de cuotas.
  isCompanyOwner?: boolean;
  impersonatedCompanyId?: string;
  impersonatedCompanyName?: string;
  isSuperAdmin?: boolean;
  // Permisos EFECTIVOS en la sucursal activa: los del rol que el usuario tiene en
  // esa sucursal, más los de gestión si es Administrador de la empresa.
  baseRolePermissions?: RolePermissions;
  // Permisos por sucursal (branchId -> permisos del rol que tiene allí). Se calcula
  // una vez al cargar el perfil, así cambiar de sucursal no cuesta otra consulta.
  branchPermissions?: Record<string, RolePermissions>;
  // Rol del usuario EN la sucursal activa, para poder mostrarlo.
  branchRoleName?: string;
  customRoles?: Role[]; // Roles adicionales asignados al usuario
  // role: rol del usuario EN esa empresa (profile_companies.role); `role` (arriba) es el de la empresa activa
  companies?: { id: string; name: string; status: 'trial' | 'active' | 'suspended'; isDemo: boolean; role: 'admin' | 'cashier' }[];
  emailConfirmedAt?: string | null;
  // Cupo de la empresa ACTIVA (la impersonada si la hay), no la del propio perfil:
  // un super admin dentro de otra empresa veía el cupo de la suya.
  companyMaxUsers?: number | null;
  // Cupo de la sucursal activa, y el de todas las accesibles para poder cambiar de
  // sucursal sin volver a consultar. null = sin límite.
  branchMaxUsers?: number | null;
  branchMaxUsersById?: Record<string, number | null>;
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
  // hereda el dato del perfil de la empresa (companies) al imprimir, salvo que
  // `inheritsCompanyProfile` sea false: ahí lo vacío se imprime vacío.
  //
  // false = "los datos de esta sucursal son suyos". Se pregunta al crearla,
  // porque heredar en silencio hacía que una sucursal nueva imprimiera las
  // redes y la dirección de otra. Ausente = true (las que ya existían heredan,
  // como siempre).
  inheritsCompanyProfile?: boolean;
  displayName?: string; // nombre comercial mostrado en el ticket
  phone?: string;
  rnc?: string;
  address?: string;
  receiptFooter?: string;
  instagram?: string;
  facebook?: string;
  email?: string;
  // Si esta sucursal exige caja abierta para cobrar en efectivo. Requiere además
  // que el módulo 'caja' esté encendido en la empresa: el módulo dice si la
  // empresa VE la caja, esto dice cuáles de sus sucursales la USAN. Ausente =
  // false, que es como cobraban todas antes de que existiera el interruptor.
  cajaEnabled?: boolean;
  // Mismo "dos interruptores" que la caja, al revés: ausente = true, porque
  // hasta ahora financiaban todas las sucursales.
  financingEnabled?: boolean;
  // Ajustes de financiamiento propios de la sucursal. Ausente/vacío = hereda
  // el de la empresa, igual que el perfil del ticket. Son los valores con los
  // que abre el diálogo del POS; el cajero puede cambiarlos en cada venta.
  defaultInterestRate?: number;
  lateFeeRate?: number;
  lateFeeMode?: LateFeeMode;
  lateFeeGraceDays?: number;
  lateFeeMaxRate?: number;
  financingInterestMode?: InterestMode;
  financingDefaultFrequency?: PaymentFrequency;
  financingDefaultInstallments?: number;
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
  // Puesta a mano por el super admin (Cobros) por atraso: la empresa queda en
  // modo solo facturación (lib/bloqueo.ts).
  solo_ventas?: boolean;
  solo_ventas_desde?: string | null;
  // Suspendida: por qué (lib/suspension.ts) y desde cuándo. Null si no lo está.
  suspension_reason?: string | null;
  suspended_at?: string | null;
  business_type?: string | null;
  max_users?: number;
  // max_users por sucursal: null = sin límite (el tope de la empresa sigue aplicando aparte).
  // cuota_mensual: precio acordado de la sucursal (null = la tarifa del plan),
  // que vale para las cuotas hasta cuota_mensual_hasta (null = sin fin).
  branches?: { id: string; name: string; location: string | null; is_active: boolean; max_users?: number | null; created_at?: string; cuota_mensual?: number | string | null; cuota_mensual_hasta?: string | null }[];
};

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

// Un recurso por cada sección de la app gateada a admin (nav de authed-layout).
export type PermissionResource =
  | 'dashboard' | 'pos' | 'sales' | 'quotes' | 'services' | 'credit' | 'financing'
  | 'prestamos' | 'caja' | 'expenses' | 'payables' | 'reports' | 'products' | 'customers'
  | 'suppliers' | 'company-profile' | 'users' | 'branches' | 'roles' | 'suscripcion'
  | 'service-types' | 'quick-sales' | 'services-all' | 'motos' | 'motos-config'
  | 'cobranza' | 'cobranza-all' | 'cobranza-cuadre';

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
  // Costo unitario congelado al momento de vender. Solo viene en líneas ya
  // vendidas; undefined = la línea no lo guardó y hay que caer al costo actual
  // del producto. Es lo que permite que el margen histórico no cambie cuando
  // se le edita el costo al producto.
  cost?: number;
  // Línea de venta rápida: artículo fuera de inventario, con producto sintético (id vacío).
  isQuick?: boolean;
  // Presentación en la que se vende la línea; undefined = suelta (1 unidad base).
  // `quantity` cuenta presentaciones. Con presentación, `product.price` es el
  // precio de la presentación, es decir, el precio de lista de la línea.
  presentation?: LinePresentation;
  // Línea de un caso del taller (service_items.id). Su cantidad viene del caso y
  // no cambia en el POS; si es pieza, ya salió del inventario al agregarla al caso.
  serviceItemId?: string;
  // Línea de un vehículo (vehicles.id): cantidad 1, no se fusiona con otras.
  vehicleId?: string;
};

export type Cart = {
  id: string;
  items: CartItem[];
  selectedCustomer: Customer;
  quoteId?: string; // si el carrito viene de una cotización cargada
  coupon?: Coupon; // cupón de fidelidad seleccionado para esta venta
  // Caso del taller que se está cobrando (y su número, para mostrarlo).
  serviceId?: string;
  serviceNumber?: number;
};

// Plan de financiamiento tal como queda grabado en la venta. Lo arma el
// servidor (`before_sale_credit_checks`); lo que manda el POS es solo una vista
// previa. Los campos opcionales no existen en los planes creados antes de que
// hubiera frecuencia: ausente significa el comportamiento de entonces —
// mensual, tasa prorrateada, y la mora vigente de la empresa.
export type FinancingDetails = {
  interestRate: number;
  interestMode?: InterestMode;
  frequency?: PaymentFrequency;
  installments: number;
  installmentAmount: number;
  totalWithInterest: number;
  downPayment?: number;
  // Primer pago elegido al vender (yyyy-mm-dd); las demás cuotas se cuentan
  // desde él. Ausente = el de siempre, un período después de la venta.
  firstDueDate?: string;
  // Congeladas al crear el plan: cambiar la mora de la sucursal no debe
  // repreciar una deuda que ya está corriendo. La ausencia de `lateFeeMode`
  // marca un plan anterior a la mora configurable — se cobra como siempre se
  // le cobró (multa fija). Ver src/lib/late-fee.ts.
  lateFeeRate?: number;
  lateFeeMode?: LateFeeMode;
  lateFeeGraceDays?: number;
  lateFeeMaxRate?: number;
  // Solo en un plan refinanciado (los escribe `refinance_financing`): el
  // capital del plan vigente, el número de su primera cuota (las anteriores
  // son del plan viejo, cerradas con lo pagado) y cuándo se refinanció. Los
  // demás campos describen el plan vigente; totalWithInterest sigue siendo el
  // de toda la vida de la venta.
  principal?: number;
  firstInstallment?: number;
  refinancedAt?: string;
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

// Corrección al plan de un financiamiento ya vendido. La escribe solo
// `amend_sale_financing`; el cliente la lee para mostrar qué cambió, quién y
// por qué — un plan repreciado sin rastro no hay forma de explicárselo al
// cliente cuando pregunta por qué su cuota no es la del recibo.
export type FinancingAmendment = {
  id: string;
  saleId: string;
  reason: string;
  before: FinancingDetails;
  after: FinancingDetails;
  changedByName?: string;
  createdAt: Date;
};

// ---------- Refinanciación (préstamos y financiamientos) ----------
// Sobre qué monto se arma el plan nuevo: solo el capital pendiente (el interés
// que aún no se ganó se cancela) o el saldo completo.
export type RefinanceBaseMode = 'capital' | 'balance';
// Qué se hace con la mora pendiente: sumarla al capital nuevo o perdonarla.
export type RefinanceLateFeeAction = 'capitalize' | 'forgive';

// Lo que devuelve `refinance_quote`: lo que se debe hoy, partido como lo
// cobra la base, y los términos vigentes para precargar el formulario.
export type RefinanceQuote = {
  kind: 'loan' | 'financing';
  id: string;
  customerId: string;
  pendingBalance: number;
  pendingCapital: number;
  unearnedInterest: number;
  lateFeeDue: number;
  planPrincipal: number;
  planDebt: number;
  firstInstallment: number | null;
  today: string; // yyyy-mm-dd, en la zona de la empresa
  terms: {
    interestRate: number;
    installments: number;
    frequency: PaymentFrequency;
    interestMode: InterestMode;
  };
  // La mora que tendrá el plan nuevo (los ajustes vigentes).
  newLateFee: { rate: number; mode: LateFeeMode; graceDays: number; maxRate: number };
};

// Una refinanciación ya hecha (tabla `refinancings`), para la bitácora.
export type Refinancing = {
  id: string;
  kind: 'loan' | 'financing';
  loanId?: string;
  newLoanId?: string;
  saleId?: string;
  baseMode: RefinanceBaseMode;
  pendingBalance: number;
  pendingCapital: number;
  unearnedInterest: number;
  lateFeeAmount: number;
  lateFeeAction?: RefinanceLateFeeAction;
  additionalAmount: number;
  newPrincipal: number;
  reason: string;
  createdByName?: string;
  createdAt: Date;
};

// Dónde va el e-CF en la DGII. Los reintenta el servidor solo, salvo
// `rechazado`, `error_datos` y `sin_cupo`, que los resuelve una persona.
export type EcfEstado =
  | 'por_enviar'
  | 'enviando'
  | 'recibido'
  | 'aceptado'
  | 'aceptado_condicional'
  | 'rechazado'
  | 'error_datos'
  | 'sin_cupo';

// Observación que devuelve la DGII junto al estado (código y texto tal cual).
export type EcfMensajeDgii = { codigo: number; valor: string };

// Un comprobante electrónico (tabla `ecf_documentos`). Solo lo escribe el
// servidor (Edge Function `ecf-emitir`); la app lo lee junto a la venta.
export type EcfDocumento = {
  id: string;
  tipoEcf: number;            // 31, 32, 34, 44, 45 (nombres en src/lib/ecf.ts)
  encf: string;               // E + tipo (2) + secuencia (10)
  estado: EcfEstado;
  securityCode?: string;
  qrUrl?: string;
  // Fecha de firma tal como la entrega MSeller (dd-mm-aaaa hh:mm:ss): se
  // imprime igual en el ticket, así que no se convierte a Date.
  signedAt?: string;
  mensajesDgii: EcfMensajeDgii[];
  // El documento nuevo, si este se rechazó y se volvió a emitir.
  reemplazadoPor?: string;
  createdAt: Date;
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
  // Quién vendió (por defecto quien cobró) y su % de comisión congelado al
  // vender. commissionRate undefined = la venta no comisiona.
  sellerId?: string;
  sellerName?: string;
  commissionRate?: number;
  ncf?: string;
  ncfType: NcfType;
  // El cliente pidió comprobante fiscal: solo entonces la base quema un número
  // de ncf_sequences. Sin esto toda venta gastaría un NCF autorizado por DGII.
  ncfRequested?: boolean;
  quoteId?: string; // cotización de origen (se marca convertida al cobrar)
  serviceId?: string; // caso del taller que se cobra (la base lo marca cobrado)
  couponId?: string; // cupón de fidelidad canjeado en esta venta
  coupon?: Coupon; // objeto completo, solo para mostrarlo en el recibo (no se persiste aparte de couponId)
  // Venta anulada con nota de crédito (RPC annul_sale). La venta no se borra:
  // los reportes de ingresos la filtran y el 607 la reporta junto a su NC.
  cancelledAt?: Date;
  // Venta de una moto recuperada (Motopréstamos 4A): queda en 'paid' y el
  // saldo que no se cobró se dio de baja. La pantalla la muestra «Recuperada».
  recoveredAt?: Date;
  writtenOffAmount?: number;
  // El e-CF vigente de la venta (el más reciente que nadie ha reemplazado).
  // undefined = la venta no lleva comprobante electrónico.
  ecf?: EcfDocumento;
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
  refundMethod?: RefundMethod;
  reason?: string;
  userName?: string;
  createdAt: Date;
  // 'recuperacion': la nota parcial de una venta recuperada (Motopréstamos 4B), por lo
  // no cobrado; no anula la venta. Las de antes son todas 'anulacion'.
  kind: 'anulacion' | 'recuperacion';
  // Fecha de la venta que modifica, cuando se lee con ella (reporte de impuestos).
  saleCreatedAt?: Date;
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
  // La empresa emite e-CF de verdad (RPC ecf_activa: formalizada, con el módulo
  // encendido y su configuración activa). Solo lectura: la calcula el servidor.
  ecfActiva: boolean;
  socialMedia: {
    instagram: string;
    facebook: string;
  };
  email: string;
  logoUrl: string;
  ticketLogoUrl: string;
  receiptFooter: string;
  // Qué nombre encabeza el ticket: el de la empresa, el de la sucursal (o su
  // nombre comercial si lo tiene), o ambos.
  ticketNameDisplay: TicketNameDisplay;
  headerNameDisplay: TicketNameDisplay;
  // Lo mismo para las redes sociales y el correo que van al pie del ticket.
  ticketSocialDisplay: TicketNameDisplay;
  // Cómo se ve el negocio en el enlace del comprobante que va por WhatsApp:
  // sellalles.com/<linkSlug>/c/7Kq2Wp. Vacío = se deriva del nombre.
  linkSlug: string;
  // Datos del cliente en la factura (caso del chofer que entrega). Encendido, el
  // pago ofrece una casilla para incluirlos; los campos dicen cuáles salen.
  receiptCustomerInfoEnabled: boolean;
  receiptCustomerFields: CampoCliente[];
  lateFeeRate: number;         // % de mora sobre la cuota vencida
  lateFeeMode: LateFeeMode;    // cómo corre esa mora (ver src/lib/late-fee.ts)
  lateFeeGraceDays: number;    // días después del vencimiento antes de cobrarla
  lateFeeMaxRate: number;      // tope de mora como % de la base; 0 = sin tope
  defaultInterestRate: number; // % de interés mensual sugerido en el POS
  // Valores por defecto del financiamiento para toda la empresa. Cada sucursal
  // puede sobrescribirlos; ver Branch.
  financingInterestMode: InterestMode;
  financingDefaultFrequency: PaymentFrequency;
  financingDefaultInstallments: number;
  // Los de préstamos son independientes de los de financiamiento, tasa, modo,
  // gracia y tope incluidos.
  loanLateFeeRate: number;
  loanLateFeeMode: LateFeeMode;
  loanLateFeeGraceDays: number;
  loanLateFeeMaxRate: number;
  defaultLoanInterestRate: number; // % de interés mensual sugerido para préstamos
  loyaltyEnabled: boolean;
  loyaltyPurchasesRequired: number | null; // null = sin configurar
  loyaltyRewardDescription: string;
  loyaltyCouponValidDays: number;
};

export type PaymentMethod = 'cash' | 'card' | 'transfer';

// Cómo vuelve el dinero al anular una venta. 'none' es para la venta que se
// facturó por error y nunca se cobró: se anula y se repone el inventario, pero
// no hubo dinero que devolver.
export type RefundMethod = PaymentMethod | 'none';

/**
 * De dónde salió el abono:
 * - `down_payment`: el inicial de la venta. Es parte de la venta, no se anula suelto.
 * - `sale`: abono a una venta concreta desde Financiamientos.
 * - `customer`: abono a la deuda general, repartido entre las ventas abiertas.
 */
export type CreditPaymentKind = 'down_payment' | 'sale' | 'customer';

export type CreditPayment = {
  id: string;
  saleId?: string;      // abonos generales a deuda no van ligados a una venta
  customerId: string;
  customerName?: string;
  kind: CreditPaymentKind;
  amount: number;
  lateFeePaid: number;  // parte del abono que fue mora
  method: PaymentMethod;
  reference?: string;   // identificador de transferencia/tarjeta
  notes?: string;
  userName?: string;
  date: Date;
  branchId: string;     // nombre de sucursal a nivel de app; se resuelve a UUID al guardar
  // Un abono no se borra: se anula por reverso (RPC void_credit_payment) y
  // queda con su motivo. Todo lo que sume dinero descarta los anulados.
  voidedAt?: Date;
  voidedByName?: string;
  voidReason?: string;
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
  /** Solo en el abono general: entre cuántas ventas se repartió. */
  salesTouched?: number;
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

// 'dacion': el negocio se quedó la moto en garantía como pago (Motopréstamos 4A).
// No entra dinero: no cuenta en la caja ni en los cobros.
export type LoanPaymentMethod = PaymentMethod | 'dacion';

export type LoanPayment = {
  id: string;
  loanId: string;
  customerId: string;
  amount: number;
  lateFeePaid: number;
  method: LoanPaymentMethod;
  reference?: string;   // identificador de transferencia/tarjeta
  notes?: string;
  userName?: string;
  date: Date;
  branchId?: string;
  // Igual que en crédito: no se borra, se anula por reverso (RPC
  // void_loan_payment). Todo lo que sume dinero descarta los anulados.
  voidedAt?: Date;
  voidedByName?: string;
  voidReason?: string;
};

// Alias histórico: los préstamos ya usaban este nombre. El calendario y las
// etiquetas viven en lib/frequency.ts, compartidos con Financiamiento.
export type LoanFrequency = PaymentFrequency;

// Cómo se entregó el dinero de un préstamo. En efectivo sale de la caja.
export type DisbursementMethod = 'cash' | 'transfer';

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
  // 'refinanced': cerrado por una refinanciación; su saldo pasó al préstamo
  // que lo tiene en `refinancedFromId` (y total = pagado, así que debe 0).
  status: 'active' | 'paid' | 'cancelled' | 'refinanced';
  // En un préstamo que refinancia a otro: cuál, y cuánto del capital viene de
  // él (saldo + mora sumada). principal − carriedOverAmount = dinero entregado.
  refinancedFromId?: string;
  carriedOverAmount: number;
  // Primera cuota elegida (yyyy-mm-dd); ausente = un período tras el desembolso.
  firstDueDate?: string;
  // Ausente en los préstamos anteriores a 2026-11-24 (sin registro).
  disbursementMethod?: DisbursementMethod;
  disbursementReference?: string;
  // Saldo dado de baja al liquidar la garantía (el préstamo queda 'cancelled').
  writtenOffAmount?: number;
  notes?: string;
  userName?: string;
  createdAt: Date;
  // Política de mora congelada al desembolsar, igual que en financiamiento:
  // subir la mora de la empresa no reprecia un préstamo que ya está corriendo.
  // Ausente = préstamo anterior a la mora configurable (multa fija con los
  // ajustes de la empresa, que es como se le ha venido cobrando).
  lateFeeRate?: number;
  lateFeeMode?: LateFeeMode;
  lateFeeGraceDays?: number;
  lateFeeMaxRate?: number;
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

// Resultado de la RPC void_loan_payment.
export type VoidLoanPaymentResult = {
  paymentId: string;
  amount: number;
  cashReturned: boolean;
  remainingBalance: number;
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
  /** Número de la factura del pago. Lo asigna la base al registrarlo. */
  invoiceNumber?: number;
  /** Datos de SellAlleS y de la empresa tal como estaban al emitir la factura. */
  invoiceIssuer?: SubscriptionInvoiceIssuer;
  invoiceCustomer?: SubscriptionInvoiceCustomer;
  /** ITBIS incluido en `amount`; 0 si la factura no lo desglosa. */
  invoiceItbis: number;
};

export type SubscriptionInvoiceIssuer = {
  legalName: string;
  rnc?: string;
  address?: string;
  phone?: string;
  email?: string;
  notes?: string;
};

export type SubscriptionInvoiceCustomer = {
  name: string;
  rnc?: string;
  address?: string;
  phone?: string;
  email?: string;
};

export type Supplier = {
    id: string;
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    address: string;
    rnc?: string;
    /** Nombre comercial (la DGII lo trae con el RNC). */
    tradeName?: string;
    /** Plazo que da el proveedor: 0 = contado, null = sin plazo. */
    creditDays?: number | null;
    /** Tipo de gasto del 606 (01-11) que trae su factura en Cuentas por Pagar. */
    expenseType606?: string;
    bankName?: string;
    bankAccountType?: 'ahorro' | 'corriente' | null;
    bankAccountNumber?: string;
    notes?: string;
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
  // Presentación comprada; ausente = suelta. `quantity` y `unitCost` son por presentación.
  presentation?: LinePresentation;
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
  // Se anula por reverso (RPC void_supplier_payment): el monto vuelve al
  // balance de la factura y el pago queda en el historial con su motivo.
  voidedAt?: Date;
  voidedByName?: string;
  voidReason?: string;
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

// Resultado de la RPC void_supplier_payment.
export type VoidSupplierPaymentResult = SupplierPaymentResult & {
  cashReturned: boolean;
};

// ---------- Taller (módulo de servicios) ----------
// Servicio del catálogo del taller. Cada uno tiene su artículo de servicio en la
// sucursal (`productId`): de ahí salen precio e ITBIS, y así se cobra en el POS.
export type ServiceType = {
    id: string;
    name: string;
    description?: string;
    basePrice: number;
    branchId?: string;
    productId?: string;
    equipmentTypeId?: string;
    partCategoryId?: string;
    warrantyDays?: number;
    durationMin?: number;
    /** Porcentaje de comisión propio del servicio (pisa el de la persona). */
    commissionRate?: number;
    /** Monto fijo de comisión (pisa el porcentaje). */
    commissionAmount?: number;
    repeatEveryDays?: number;
    atCustomerDefault: boolean;
    isActive: boolean;
    position: number;
    /** Precio e ITBIS vigentes, del artículo de servicio. */
    price: number;
    itbis: boolean;
};

export type ServiceStatus =
  | 'received' | 'diagnosing' | 'awaiting_approval' | 'awaiting_parts' | 'in_repair'
  | 'ready' | 'not_repaired' | 'delivered' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid';

export type EquipmentExtraField = { key: string; label: string; type: 'text' | 'number' };

export type EquipmentType = {
    id: string;
    name: string;
    brandLabel: string | null;
    modelLabel: string | null;
    serialLabel: string | null;
    asksPassword: boolean;
    staysInShop: boolean;
    isRepair: boolean;
    extraFields: EquipmentExtraField[];
    position: number;
    isActive: boolean;
};

export type ChecklistItem = {
    id: string;
    /** undefined = aplica a todos los tipos de equipo. */
    equipmentTypeId?: string;
    label: string;
    required: boolean;
    requiredQuick: boolean;
    position: number;
    isActive: boolean;
};

/** Sí / No / No se pudo probar. */
export type ChecklistAnswerValue = 'si' | 'no' | 'np';
export type ChecklistAnswer = {
    itemId: string;
    label: string;
    answer: ChecklistAnswerValue;
    note?: string;
};

export type TallerSettings = {
    branchId: string;
    partsLocationId?: string;
    hidePartsInPos: boolean;
    terms?: string;
    defaultWarrantyDays?: number;
    defaultAtCustomer: boolean;
};

/** Persona que atiende (barbero, técnico, estilista...) de una sucursal. */
export type Staff = {
    id: string;
    branchId: string;
    name: string;
    phone?: string;
    color?: string;
    commissionRate: number;
    profileId?: string;
    isActive: boolean;
    position: number;
};

/** Ficha de lo que se atiende de un cliente (equipo, mascota, vehículo...). */
export type CustomerSubject = {
    id: string;
    customerId: string;
    equipmentTypeId?: string;
    brand?: string;
    model?: string;
    serial?: string;
    details: Record<string, string>;
    notes?: string;
    isActive: boolean;
};

export type ServiceItemKind = 'labor' | 'part';

export type ServiceItem = {
    id: string;
    serviceId: string;
    kind: ServiceItemKind;
    serviceTypeId?: string;
    product: Product;
    quantity: number;
    price: number;
    cost: number;
    /** Personas que hicieron esta línea (service_item_staff). */
    staffIds: string[];
};

export type ServiceEventKind = 'created' | 'status' | 'assigned' | 'note' | 'charged' | 'charge_voided';
export type ServiceEvent = {
    id: string;
    kind: ServiceEventKind;
    fromStatus?: ServiceStatus;
    toStatus?: ServiceStatus;
    fromUser?: string;
    toUser?: string;
    fromStaff?: string;
    toStaff?: string;
    note?: string;
    visibleToCustomer: boolean;
    createdBy?: string;
    createdByName?: string;
    createdAt: Date;
};

export type Service = {
    id: string;
    number: number;
    /** UUID de la sucursal. */
    branchId: string;
    branchName: string;
    customerId?: string;
    customer?: Customer;
    serviceTypeId?: string;
    serviceType?: ServiceType;
    /** Solo lo que trae el embed; el registro completo sale de useTallerConfig().staff. */
    staff?: Pick<Staff, 'id' | 'name' | 'profileId'>;
    /** Falla reportada por el cliente. */
    description: string;
    status: ServiceStatus;
    laborPrice: number;
    partsTotal: number;
    total: number;
    paymentStatus: PaymentStatus;
    amountPaid: number;
    saleId?: string;
    createdAt: Date;
    completedAt?: Date;
    equipmentTypeId?: string;
    equipmentBrand?: string;
    equipmentModel?: string;
    equipmentSerial?: string;
    equipmentPassword?: string;
    equipmentDetails: Record<string, string>;
    accessories?: string;
    intakeChecklist: ChecklistAnswer[];
    diagnosis?: string;
    broughtByName?: string;
    broughtByPhone?: string;
    receivedBy?: string;
    receivedByName?: string;
    estimate?: number;
    promisedAt?: Date;
    isQuick: boolean;
    /** Se queda en el local (si no, se atiende y se termina). */
    staysInShop: boolean;
    /** La ficha es de reparación: habilita diagnóstico, piezas y «no se pudo reparar». */
    isRepair: boolean;
    /** Se atiende en casa del cliente. */
    atCustomer: boolean;
    serviceAddress?: string;
    staffId?: string;
    subjectId?: string;
    statusChangedAt: Date;
    readyAt?: Date;
    deliveredAt?: Date;
    deliveredBy?: string;
    deliveredByName?: string;
    pickedUpByName?: string;
    outcome?: 'repaired' | 'not_repaired';
    /** Código del enlace público de seguimiento (/seguimiento?c=…). */
    trackingCode: string;
    /** Reingreso por garantía de otro caso, o de una venta. */
    warrantyOfServiceId?: string;
    warrantySaleId?: string;
    /** Hasta cuándo cubre la garantía de este caso (se fija al entregarlo). */
    warrantyUntil?: string;
    items?: ServiceItem[];
};

export type ServicePhoto = { id: string; path: string; createdAt: Date; url?: string };

// ---------- Motopréstamos: vehículos ----------
export type VehicleExtraField = { key: string; label: string; type: 'text' | 'number' };

export type VehicleType = {
  id: string;
  name: string;
  extraFields: VehicleExtraField[];
  position: number;
  isActive: boolean;
};

export type Vehicle = {
  id: string;
  branchId: string;
  vehicleTypeId?: string;
  origin: VehicleOrigin;
  productId?: string;
  productName?: string;
  productPrice?: number;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  saleId?: string;
  brand?: string;
  model?: string;
  year?: number;
  color?: string;
  chassis?: string;
  engineNumber?: string;
  plate?: string;
  registrationNumber?: string;
  cc?: string;
  extra: Record<string, string | number>;
  condition: VehicleCondition;
  cost?: number;
  price?: number;
  status: VehicleStatus;
  registrationStatus: RegistrationStatus;
  registrationLocation?: string;
  registrationSince?: Date;
  /** Préstamo que la tiene en garantía (o el último, si ya se liberó). */
  loanId?: string;
  registrationDeliveredTo?: string;
  registrationDeliveredDoc?: string;
  registrationDeliveredAt?: Date;
  registrationDeliveredByName?: string;
  notes?: string;
  createdByName?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type VehicleEvent = {
  id: string;
  kind: 'ingreso' | 'venta' | 'venta_anulada' | 'cambio_estado' | 'matricula' | 'edicion' | 'baja' | 'garantia' | 'liberacion'
    | 'incautacion' | 'devolucion' | 'liquidacion' | 'recuperacion';
  fromStatus?: string;
  toStatus?: string;
  note?: string;
  saleId?: string;
  loanId?: string;
  createdByName?: string;
  createdAt: Date;
};

/** Una recuperación de moto (Motopréstamos 4A): venta recuperada o garantía
 *  incautada → devuelta o liquidada. Se escribe solo por las RPC. */
export type VehicleRecovery = {
  id: string;
  branchId: string;
  vehicleId: string;
  kind: 'venta' | 'garantia';
  saleId?: string;
  loanId?: string;
  status: EstadoDeRecuperacion;
  /** yyyy-mm-dd */
  recoveredOn: string;
  reason?: string;
  conditionNote?: string;
  debtAtRecovery?: number;
  /** Valor con que la moto vuelve al inventario (venta recuperada o dación). */
  reentryValue?: number;
  writtenOff: number;
  refunded: number;
  refundMethod?: 'cash' | 'transfer';
  liquidationMode?: 'tercero' | 'dacion';
  /** Lo que pagó el tercero o el valor de la dación. */
  proceeds?: number;
  /** La parte que se aplicó al préstamo. */
  applied?: number;
  shortfallAction?: 'deuda' | 'baja';
  paymentId?: string;
  note?: string;
  createdByName?: string;
  createdAt: Date;
  closedAt?: Date;
};

// ---------- Cobranza en la calle (Motopréstamos 3A) ----------

/** Un usuario marcado como cobrador en una sucursal. */
export type Cobrador = { id: string; branchId: string; profileId: string; name: string; isActive: boolean };

/** Cliente de la cartera de un cobrador, con su orden de visita. */
export type AsignacionDeCartera = { id: string; branchId: string; customerId: string; collectorId: string; orden: number };

export type VisitaDeCobro = {
  id: string;
  branchId: string;
  customerId: string;
  collectorId?: string;
  outcome: ResultadoVisita;
  promiseDate?: string;
  promiseAmount?: number;
  note?: string;
  paymentId?: string;
  createdByName?: string;
  createdAt: string;
};

/** Abono cobrado por un cobrador (préstamo o venta). `enCalle`: efectivo que
 *  sigue en su bolsillo hasta la entrega (`settlementId`). */
export type AbonoDeCobrador = {
  id: string;
  tipo: 'prestamo' | 'venta';
  collectorId: string;
  customerId: string;
  cuentaId?: string;
  amount: number;
  method: string;
  date: string;
  enCalle: boolean;
  settlementId?: string;
  voided: boolean;
};

/** Entrega del cobrador: lo esperado (sus abonos en efectivo) contra lo recibido. */
export type EntregaDeCobrador = {
  id: string;
  collectorId: string;
  expected: number;
  received: number;
  difference: number;
  note?: string;
  receivedByName?: string;
  cajaMovementId?: string;
  createdAt: string;
};

/** Lo que devuelve un cobro de la ruta, para mostrarlo al terminar. */
export type CobroDeRuta = {
  paymentId: string;
  aplicado: number;
  mora: number;
  saldo: number | null;
  enCalle: boolean;
  repetido?: boolean;
  /** Para imprimir o mandar el recibo (no viene en un cobro repetido). */
  recibo?: PaymentResult;
  /** Dónde quedó el abono: el general a las ventas también es de `venta`. */
  tipoAbono: 'prestamo' | 'venta';
};

/** Lo que devuelve recibir una entrega. */
export type EntregaRecibida = { settlementId: string; expected: number; received: number; difference: number; payments: number };
