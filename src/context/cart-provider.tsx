'use client';

import { createContext, useEffect, ReactNode, useContext } from 'react';
import type { CartItem, Product, Sale, Customer, FinancingDetails, Cart, Coupon } from '@/lib/types';
import { ITBIS_RATE, GENERIC_CUSTOMER, round2 } from '@/lib/utils';
import { create, useStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const MAX_CARTS = 3;

interface CartState {
  carts: Cart[];
  activeCartId: string;
  saleCompletionCount: number;
  toast: string | null;
}

interface CartActions {
  addItem: (product: Product) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  setCustomPrice: (cartItemId: string, price: number | undefined) => void;
  clearCart: () => void;
  completeSale: () => void;

  addCart: () => void;
  removeCart: (cartId: string) => void;
  setActiveCart: (cartId: string) => void;
  setSelectedCustomer: (customer: Customer) => void;
  setCoupon: (coupon: Coupon | undefined) => void;

  _init: () => void;
}

export const getGenericCustomer = (): Customer => GENERIC_CUSTOMER;

// Precio unitario efectivo: el override manual del cajero siempre gana; si no
// hay override, se aplica el % de descuento del cliente seleccionado.
export const getEffectiveUnitPrice = (item: CartItem, customer?: Customer): number => {
  if (item.customPrice !== undefined) return item.customPrice;
  
  // 1. Determinar precio base (por mayor si cumple la cantidad mínima, si no, al detalle)
  let basePrice = item.product.price;
  if (
    item.product.wholesalePrice !== undefined &&
    item.product.wholesalePrice !== null &&
    item.product.wholesaleMinQuantity !== undefined &&
    item.product.wholesaleMinQuantity !== null &&
    item.quantity >= item.product.wholesaleMinQuantity
  ) {
    basePrice = item.product.wholesalePrice;
  }

  // 2. Aplicar descuento de cliente si aplica
  const discount = customer?.discountPercentage ?? 0;
  if (discount > 0) return round2(basePrice * (1 - discount / 100));
  return basePrice;
};

const createNewCart = (): Cart => {
  return {
    id: `cart-${Date.now()}-${Math.random()}`,
    items: [],
    selectedCustomer: getGenericCustomer(),
    quoteId: undefined,
  };
};

type CartStore = CartState & CartActions;

const cartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      carts: [],
      activeCartId: '',
      saleCompletionCount: 0,
      toast: null,

      // Initializer
      _init: () => {
        // This function is called once to set up the initial state.
        if (get().carts.length === 0) {
          const newCart = createNewCart();
          set({ carts: [newCart], activeCartId: newCart.id });
        }
      },

      // Actions
      addItem: (product) => set(state => {
        const newCarts = state.carts.map(cart => {
          if (cart.id === state.activeCartId) {
            // Find an item with the same product ID and no custom price
            const existingItem = cart.items.find(item => item.product.id === product.id && item.customPrice === undefined);
            if (existingItem) {
              // If found, just increase its quantity
              return {
                ...cart,
                items: cart.items.map(item =>
                  item.cartItemId === existingItem.cartItemId ? { ...item, quantity: item.quantity + 1 } : item
                ),
              };
            }
            // If not found, add a new line item
            const newCartItem: CartItem = {
                cartItemId: `item-${Date.now()}-${Math.random()}`,
                product,
                quantity: 1,
            };
            return { ...cart, items: [...cart.items, newCartItem] };
          }
          return cart;
        });
        return { carts: newCarts };
      }),

      removeItem: (cartItemId) => set(state => ({
        carts: state.carts.map(cart =>
          cart.id === state.activeCartId
            ? { ...cart, items: cart.items.filter(item => item.cartItemId !== cartItemId) }
            : cart
        ),
      })),

      updateQuantity: (cartItemId, quantity) => set(state => ({
        carts: state.carts.map(cart => {
          if (cart.id === state.activeCartId) {
            if (quantity <= 0) {
              // Remove item if quantity is zero or less
              return { ...cart, items: cart.items.filter(item => item.cartItemId !== cartItemId) };
            }
            return {
              ...cart,
              items: cart.items.map(item =>
                item.cartItemId === cartItemId ? { ...item, quantity } : item
              ),
            };
          }
          return cart;
        }),
      })),

      setCustomPrice: (cartItemId, price) => set(state => {
        const newCarts = state.carts.map(cart => {
            if (cart.id === state.activeCartId) {
                const itemToChange = cart.items.find(item => item.cartItemId === cartItemId);
                if (!itemToChange) return cart;

                // If quantity is 1 or price is being reset, just update the item
                if (itemToChange.quantity === 1 || price === undefined) {
                    return {
                        ...cart,
                        items: cart.items.map(item =>
                            item.cartItemId === cartItemId ? { ...item, customPrice: price } : item
                        )
                    };
                }

                // If quantity > 1 and a new custom price is set, split the item
                const newItems = cart.items.filter(item => item.cartItemId !== cartItemId);
                
                // The item with the new price (quantity 1)
                const discountedItem: CartItem = {
                    ...itemToChange,
                    cartItemId: `item-${Date.now()}-${Math.random()}`, // New unique ID for the split item
                    quantity: 1,
                    customPrice: price
                };
                
                // The remaining items with original price and adjusted quantity
                const remainingItem: CartItem = {
                    ...itemToChange,
                    quantity: itemToChange.quantity - 1,
                };
                
                newItems.push(remainingItem, discountedItem);

                return { ...cart, items: newItems };
            }
            return cart;
        });
        return { carts: newCarts };
      }),

      clearCart: () => set(state => ({
        carts: state.carts.map(cart =>
          cart.id === state.activeCartId ? { ...cart, items: [], selectedCustomer: getGenericCustomer(), coupon: undefined } : cart
        ),
      })),
      
      completeSale: () => set(state => {
        const activeCart = state.carts.find(c => c.id === state.activeCartId);
        if (!activeCart || activeCart.items.length === 0) return {};
        
        let remainingCarts = state.carts.filter(cart => cart.id !== state.activeCartId);
        if (remainingCarts.length === 0) {
          remainingCarts = [createNewCart()];
        }
        
        const newActiveCartId = remainingCarts[0].id;
        
        return {
          carts: remainingCarts,
          activeCartId: newActiveCartId,
          saleCompletionCount: state.saleCompletionCount + 1,
        };
      }),

      addCart: () => set(state => {
        if (state.carts.length >= MAX_CARTS) {
          set({ toast: `No se pueden crear más de ${MAX_CARTS} carritos.` });
          setTimeout(() => set({ toast: null }), 3000);
          return {};
        }
        const newCart = createNewCart();
        return {
          carts: [...state.carts, newCart],
          activeCartId: newCart.id,
          toast: null,
        };
      }),

      removeCart: (cartId) => set(state => {
        if (state.carts.length <= 1) return {}; 

        const newCarts = state.carts.filter(cart => cart.id !== cartId);
        let newActiveId = state.activeCartId;

        if (state.activeCartId === cartId) {
          newActiveId = newCarts[0]?.id || '';
        }

        return { carts: newCarts, activeCartId: newActiveId };
      }),

      setActiveCart: (cartId) => set({ activeCartId: cartId }),
      
      setSelectedCustomer: (customer) => set(state => ({
        carts: state.carts.map(cart =>
          // Un cupón pertenece a un cliente específico: si cambia el cliente, se descarta.
          cart.id === state.activeCartId ? { ...cart, selectedCustomer: customer, coupon: undefined } : cart
        ),
      })),

      setCoupon: (coupon) => set(state => ({
        carts: state.carts.map(cart =>
          cart.id === state.activeCartId ? { ...cart, coupon } : cart
        ),
      })),
    }),
    {
      name: 'sellalles-cart-storage', // name of the item in the storage (must be unique)
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
      onRehydrateStorage: (state) => {
        // This is called when the storage is rehydrated
        return (state, error) => {
          if (error) {
            console.error('An error happened during storage rehydration', error);
          } else {
             if (state && state.carts.length === 0) {
               state._init();
            }
          }
        }
      },
    }
  )
);

// Carga una cotización como carrito activo. Función a nivel de módulo para
// poder llamarla desde páginas fuera del CartProvider (p. ej. /quotes): actúa
// sobre el store persistido, y el POS lo lee al navegar.
// Devuelve false si ya hay MAX_CARTS carritos con artículos.
export function openQuoteCart(items: CartItem[], customer: Customer | undefined, quoteId: string): boolean {
  const state = cartStore.getState();
  const active = state.carts.find(c => c.id === state.activeCartId);
  const newCart: Cart = {
    id: `cart-${Date.now()}-${Math.random()}`,
    items,
    selectedCustomer: customer ?? getGenericCustomer(),
    quoteId,
  };
  if (active && active.items.length === 0) {
    cartStore.setState({
      carts: state.carts.map(c => (c.id === active.id ? newCart : c)),
      activeCartId: newCart.id,
    });
    return true;
  }
  if (state.carts.length < MAX_CARTS) {
    cartStore.setState({ carts: [...state.carts, newCart], activeCartId: newCart.id });
    return true;
  }
  return false;
}

// This context will provide the store to the components.
const CartContext = createContext<typeof cartStore | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  // Initialize the store only on the client-side and only once.
  useEffect(() => {
    // Check if carts are empty after potential rehydration
    if (cartStore.getState().carts.length === 0) {
      cartStore.getState()._init();
    }
  }, []);

  return <CartContext.Provider value={cartStore}>{children}</CartContext.Provider>;
}

export const useCart = () => {
  const store = useContext(CartContext);
  if (!store) {
    throw new Error('useCart must be used within a CartProvider');
  }
  
  // This allows components to subscribe to changes.
  const state = useStore(store);

  // Derived state calculations
  const activeCart = state.carts.find(cart => cart.id === state.activeCartId);
  
  const selectedCustomer = activeCart?.selectedCustomer;

  const subtotal = activeCart?.items.reduce((acc, item) => {
    const price = getEffectiveUnitPrice(item, selectedCustomer);
    return acc + price * item.quantity;
  }, 0) || 0;

  const itbisAmount = activeCart?.items.reduce((acc, item) => {
    const price = getEffectiveUnitPrice(item, selectedCustomer);
    return item.product.itbis ? acc + (price * item.quantity * ITBIS_RATE) : acc
  }, 0) || 0;

  const total = subtotal + itbisAmount;

  const totalItems = activeCart?.items.reduce((acc, item) => acc + item.quantity, 0) || 0;

  const totalDiscount = activeCart?.items.reduce((acc, item) => {
    const price = getEffectiveUnitPrice(item, selectedCustomer);
    if (price < item.product.price) {
      return acc + (item.product.price - price) * item.quantity;
    }
    return acc;
  }, 0) || 0;

  const createSale = (options: {
    paymentMethod: 'cash' | 'card' | 'transfer' | 'credit' | 'financing';
    branchId: string;
    amountPaid: number;
    paymentReference?: string;
    downPaymentMethod?: 'cash' | 'card' | 'transfer';
    downPaymentReference?: string;
    financingDetails?: FinancingDetails;
    notes?: string;
    userName?: string;
    userEmail?: string;
  }): Omit<Sale, 'id'> & { id: string } => {
    if (!activeCart) throw new Error("No active cart to create sale from");

    const { paymentMethod, branchId, amountPaid, paymentReference, downPaymentMethod, downPaymentReference, financingDetails, notes } = options;

    let paymentStatus: Sale['paymentStatus'] = 'paid';
    if (paymentMethod === 'credit') {
        paymentStatus = 'credit';
    } else if (paymentMethod === 'financing') {
        paymentStatus = 'in_financing';
    } else if (amountPaid < total) {
        paymentStatus = 'credit';
    }

    const userName = options.userName ?? localStorage.getItem('userName') ?? undefined;
    const userEmail = options.userEmail ?? localStorage.getItem('userEmail') ?? undefined;

    // Congela en cada línea el precio realmente cobrado: si el cajero no puso
    // un precio manual pero el cliente tiene descuento, ese precio pasa a ser
    // el customPrice guardado (trazabilidad histórica en sale_items).
    const items = activeCart.items.map((item) => {
      if (item.customPrice !== undefined) return item;
      const effectivePrice = getEffectiveUnitPrice(item, activeCart.selectedCustomer);
      return effectivePrice < item.product.price ? { ...item, customPrice: effectivePrice } : item;
    });

    return {
      id: '', // el id real (uuid) lo genera la base al guardar
      items,
      subtotal,
      itbisAmount,
      total,
      paymentMethod,
      paymentStatus: paymentStatus,
      amountPaid,
      paymentReference,
      // Solo relevante cuando hay abono inicial en venta a crédito/financiada.
      downPaymentMethod: amountPaid > 0 && (paymentStatus === 'credit' || paymentStatus === 'in_financing') ? downPaymentMethod : undefined,
      downPaymentReference: amountPaid > 0 && (paymentStatus === 'credit' || paymentStatus === 'in_financing') ? downPaymentReference : undefined,
      customer: activeCart.selectedCustomer,
      customerId: activeCart.selectedCustomer?.id,
      createdAt: new Date(),
      branchId,
      financingDetails,
      payments: [],
      notes,
      userName,
      userEmail,
      ncf: undefined, // lo asigna la base desde ncf_sequences (si la empresa emite NCF)
      ncfType: activeCart.selectedCustomer?.ncfType || 'consumer',
      quoteId: activeCart.quoteId, // si vino de una cotización, se marcará convertida
      couponId: activeCart.coupon?.id, // se canjea en el servidor tras crear la venta
      coupon: activeCart.coupon, // solo para mostrarlo en el recibo
    };
  };

  return {
    ...state,
    activeCart,
    subtotal,
    itbisAmount,
    total,
    totalItems,
    totalDiscount,
    createSale,
    getGenericCustomer,
  };
};
