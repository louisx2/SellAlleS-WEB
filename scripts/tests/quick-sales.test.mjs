// Pruebas de la lógica pura de Ventas Rápidas. Sin runner de terceros:
// `npm test` corre `node --test`, y Node quita los tipos de quick-sales.ts
// al importarlo (por eso ese archivo solo puede tener `import type`).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUICK_DEFAULT_NAME,
  validateQuickItem,
  buildQuickCartItem,
  quickUnitPrice,
  normalizeQuickName,
  filterRecentQuickItems,
  isUncostedQuick,
  lineBase,
  topProductKey,
  summarizeQuickLines,
} from '../../src/lib/quick-sales.ts';

const RATE = 0.18;

// Producto mínimo para armar líneas de carrito en las pruebas.
const product = (over = {}) => ({
  id: 'p1',
  code: '',
  name: 'Producto',
  price: 118,
  cost: 0,
  itbis: true,
  image: '',
  stock: 10,
  unit: 'und',
  tracksStock: true,
  ...over,
});

const line = (over = {}) => ({
  cartItemId: 'c1',
  product: product(),
  quantity: 1,
  ...over,
});

test('QUICK_DEFAULT_NAME es "Varios"', () => {
  assert.equal(QUICK_DEFAULT_NAME, 'Varios');
});

test('validateQuickItem: entrada válida devuelve null', () => {
  assert.equal(validateQuickItem({ name: ' Cable ', price: 150, quantity: 2, itbis: true }), null);
});

test('validateQuickItem: precio 0 es válido', () => {
  assert.equal(validateQuickItem({ name: 'Cable', price: 0, quantity: 1, itbis: false }), null);
});

test('validateQuickItem: descripción vacía', () => {
  assert.equal(
    validateQuickItem({ name: '   ', price: 150, quantity: 1, itbis: true }),
    'Escribe la descripción del artículo.',
  );
});

test('validateQuickItem: precio NaN y negativo', () => {
  assert.equal(
    validateQuickItem({ name: 'Cable', price: NaN, quantity: 1, itbis: true }),
    'Escribe un precio válido.',
  );
  assert.equal(
    validateQuickItem({ name: 'Cable', price: -1, quantity: 1, itbis: true }),
    'El precio no puede ser negativo.',
  );
});

test('validateQuickItem: cantidad no entera o cero', () => {
  const msg = 'La cantidad debe ser un número entero mayor que cero.';
  assert.equal(validateQuickItem({ name: 'Cable', price: 10, quantity: 1.5, itbis: true }), msg);
  assert.equal(validateQuickItem({ name: 'Cable', price: 10, quantity: 0, itbis: true }), msg);
});

test('validateQuickItem: costo negativo o NaN es error; sin costo es válido', () => {
  const msg = 'El costo no puede ser negativo.';
  assert.equal(validateQuickItem({ name: 'Cable', price: 10, quantity: 1, itbis: true, cost: -1 }), msg);
  assert.equal(validateQuickItem({ name: 'Cable', price: 10, quantity: 1, itbis: true, cost: NaN }), msg);
  assert.equal(validateQuickItem({ name: 'Cable', price: 10, quantity: 1, itbis: true, cost: 0 }), null);
  assert.equal(validateQuickItem({ name: 'Cable', price: 10, quantity: 1, itbis: true, cost: undefined }), null);
});

test('validateQuickItem: devuelve el primer error en el orden descripción, precio, cantidad, costo', () => {
  assert.equal(
    validateQuickItem({ name: '', price: NaN, quantity: 0, itbis: true, cost: -1 }),
    'Escribe la descripción del artículo.',
  );
  assert.equal(
    validateQuickItem({ name: 'x', price: NaN, quantity: 0, itbis: true, cost: -1 }),
    'Escribe un precio válido.',
  );
  assert.equal(
    validateQuickItem({ name: 'x', price: -5, quantity: 0, itbis: true, cost: -1 }),
    'El precio no puede ser negativo.',
  );
  assert.equal(
    validateQuickItem({ name: 'x', price: 5, quantity: 0, itbis: true, cost: -1 }),
    'La cantidad debe ser un número entero mayor que cero.',
  );
});

test('buildQuickCartItem: arma la línea rápida con producto sintético', () => {
  const item = buildQuickCartItem(
    { name: ' Cable ', price: 150, quantity: 2, itbis: true, cost: 60 },
    'x',
  );
  assert.equal(item.cartItemId, 'x');
  assert.equal(item.quantity, 2);
  assert.equal(item.isQuick, true);
  assert.equal(item.cost, 60);
  assert.equal(item.customPrice, undefined);
  assert.deepEqual(item.product, {
    id: '',
    code: '',
    name: 'Cable',
    price: 150,
    cost: 60,
    itbis: true,
    image: '',
    stock: 0,
    unit: 'und',
    tracksStock: false,
  });
});

test('buildQuickCartItem: sin costo, item.cost es undefined y product.cost es 0', () => {
  const item = buildQuickCartItem({ name: 'Varios', price: 500, quantity: 1, itbis: false }, 'y');
  assert.equal(item.cost, undefined);
  assert.equal(item.product.cost, 0);
  assert.equal(item.product.itbis, false);
  assert.equal(item.isQuick, true);
});

test('quickUnitPrice: customPrice manda; si no, el precio del producto', () => {
  assert.equal(quickUnitPrice(line({ customPrice: 120, product: product({ price: 150 }) })), 120);
  assert.equal(quickUnitPrice(line({ product: product({ price: 150 }) })), 150);
  // Un customPrice en 0 es un precio válido, no "ausente".
  assert.equal(quickUnitPrice(line({ customPrice: 0, product: product({ price: 150 }) })), 0);
});

test('normalizeQuickName: recorta, junta espacios y baja a minúsculas', () => {
  assert.equal(normalizeQuickName(' Cable   USB '), 'cable usb');
  assert.equal(normalizeQuickName('Cable\t USB\n'), 'cable usb');
});

test('filterRecentQuickItems', () => {
  const mk = (name) => ({ name, price: 1, cost: null, itbis: false, lastSoldAt: '2026-10-16T00:00:00Z' });
  const items = ['Cable USB', 'Funda', 'Mouse', 'Teclado', 'Cargador', 'Audifonos', 'Bocina'].map(mk);

  // Término vacío: los primeros `limit` (5 por defecto).
  assert.deepEqual(filterRecentQuickItems(items, '').map((i) => i.name), [
    'Cable USB', 'Funda', 'Mouse', 'Teclado', 'Cargador',
  ]);
  assert.equal(filterRecentQuickItems(items, '   ').length, 5);
  assert.equal(filterRecentQuickItems(items, '', 2).length, 2);

  assert.deepEqual(filterRecentQuickItems(items, 'usb').map((i) => i.name), ['Cable USB']);
  assert.deepEqual(filterRecentQuickItems(items, ' CABLE  u').map((i) => i.name), ['Cable USB']);
  assert.deepEqual(filterRecentQuickItems(items, 'zzz'), []);

  // El límite también aplica a los que coinciden.
  const many = Array.from({ length: 8 }, (_, i) => mk(`Cable ${i}`));
  assert.equal(filterRecentQuickItems(many, 'cable').length, 5);
  assert.equal(filterRecentQuickItems(many, 'cable', 3).length, 3);
});

test('isUncostedQuick', () => {
  assert.equal(isUncostedQuick(line({ isQuick: true })), true);
  assert.equal(isUncostedQuick(line({ isQuick: true, cost: 0 })), false);
  assert.equal(isUncostedQuick(line({ isQuick: true, cost: 25 })), false);
  assert.equal(isUncostedQuick(line()), false);
  assert.equal(isUncostedQuick(line({ isQuick: false })), false);
});

test('lineBase (tasa 0.18)', () => {
  // 2 x 118 con ITBIS e incluido: la base es 236 / 1.18 = 200.
  assert.equal(lineBase(line({ quantity: 2, product: product({ price: 118, itbis: true }) }), true, RATE), 200);
  // Excluido: el precio ya es la base.
  assert.equal(lineBase(line({ quantity: 2, product: product({ price: 118, itbis: true }) }), false, RATE), 236);
  // Sin ITBIS, aunque la sucursal lo incluya: no se divide.
  assert.equal(lineBase(line({ quantity: 2, product: product({ price: 118, itbis: false }) }), true, RATE), 236);
  // customPrice manda sobre el precio del producto.
  assert.equal(
    lineBase(line({ quantity: 2, customPrice: 59, product: product({ price: 118, itbis: true }) }), true, RATE),
    100,
  );
});

test('lineBase redondea a 2 decimales', () => {
  // 100 / 1.18 = 84.7457...
  assert.equal(lineBase(line({ quantity: 1, product: product({ price: 100, itbis: true }) }), true, RATE), 84.75);
});

test('topProductKey', () => {
  assert.equal(
    topProductKey(line({ isQuick: true, product: product({ id: '', name: ' Cable USB' }) })),
    'rapido:cable usb',
  );
  assert.equal(topProductKey(line({ isQuick: false, product: product({ id: 'p1' }) })), 'p1');
  assert.equal(topProductKey(line({ product: product({ id: 'p1' }) })), 'p1');
});

test('summarizeQuickLines (tasa 0.18)', () => {
  const result = summarizeQuickLines(
    [
      { quantity: 2, price: 118, customPrice: null, cost: 50, itbis: true, itbisIncluded: true },
      { quantity: 1, price: 300, customPrice: 250, cost: null, itbis: false, itbisIncluded: true },
    ],
    RATE,
  );
  assert.deepEqual(result, {
    total: 486,
    totalWithCost: 236,
    profit: 100,
    uncostedCount: 1,
    uncostedAmount: 250,
  });
});

test('summarizeQuickLines: sin líneas todo es cero', () => {
  assert.deepEqual(summarizeQuickLines([], RATE), {
    total: 0,
    totalWithCost: 0,
    profit: 0,
    uncostedCount: 0,
    uncostedAmount: 0,
  });
});

test('summarizeQuickLines: costo 0 cuenta como costeado', () => {
  const result = summarizeQuickLines(
    [{ quantity: 3, price: 10, customPrice: null, cost: 0, itbis: false, itbisIncluded: false }],
    RATE,
  );
  assert.deepEqual(result, { total: 30, totalWithCost: 30, profit: 30, uncostedCount: 0, uncostedAmount: 0 });
});

// Una línea en el punto de equilibrio con ruido de coma flotante (3 × 0.1 =
// 0.30000000000000004) da una ganancia de -5.5e-17. Redondeada a centavos
// salía -0, y el reporte lo mostraba como "-0.00".
test('summarizeQuickLines: una ganancia que redondea a cero no sale como -0', () => {
  const result = summarizeQuickLines(
    [{ quantity: 3, price: 0.1, customPrice: null, cost: 0.1, itbis: false, itbisIncluded: false }],
    RATE,
  );
  assert.ok(Object.is(result.profit, 0), `profit debería ser +0 y es ${Object.is(result.profit, -0) ? '-0' : result.profit}`);
});
