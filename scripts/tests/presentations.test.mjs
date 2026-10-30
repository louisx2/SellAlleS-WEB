// Pruebas de la lógica pura de presentaciones (unidad, paquete, caja). Sin runner
// de terceros: `npm test` corre `node --test`, y Node quita los tipos de
// presentations.ts al importarlo (por eso ese archivo solo puede tener `import type`).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  presentationsOf,
  isSoldLoose,
  presentationLabel,
  buttonLabel,
  lineBaseQty,
  baseQtyInCart,
  maxAddable,
  isSellable,
  lineProduct,
  toLinePresentation,
  findByCode,
  breakdownStock,
  formatBreakdown,
  validateDrafts,
  PRESENTATION_CSV_HEADERS,
  parsePresentationColumns,
  presentationColumns,
  resolveQuotedPresentation,
} from '../../src/lib/presentations.ts';

const CAJA = { id: 'pc', name: 'Caja', units: 288, price: 3600, code: '7501-288' };
const PAQUETE = { id: 'pp', name: 'Paquete', units: 12, price: 160, code: '7501-12' };

// Producto mínimo. Las presentaciones van desordenadas a propósito (Caja antes que Paquete).
const galletas = (over = {}) => ({
  id: 'g1',
  code: '7501',
  name: 'Galletas',
  price: 15,
  cost: 10,
  itbis: false,
  image: '',
  stock: 1250,
  unit: 'und',
  tracksStock: true,
  presentations: [CAJA, PAQUETE],
  ...over,
});

const line = (over = {}) => ({
  cartItemId: 'c1',
  product: galletas(),
  quantity: 1,
  ...over,
});

test('presentationsOf ordena de menor a mayor', () => {
  const p = galletas();
  assert.deepEqual(presentationsOf(p).map((x) => x.name), ['Paquete', 'Caja']);
  // Es una copia: no reordena la lista del producto.
  assert.deepEqual(p.presentations.map((x) => x.name), ['Caja', 'Paquete']);
  // Sin presentaciones: lista vacía.
  assert.deepEqual(presentationsOf(galletas({ presentations: undefined })), []);
});

test('isSoldLoose: undefined se vende suelto', () => {
  assert.equal(isSoldLoose(galletas()), true);
  assert.equal(isSoldLoose(galletas({ soldLoose: true })), true);
  assert.equal(isSoldLoose(galletas({ soldLoose: false })), false);
});

test('presentationLabel', () => {
  assert.equal(presentationLabel({ name: 'Paquete', units: 12 }, 'und'), 'Paquete x12');
  assert.equal(presentationLabel({ name: 'Saco', units: 125 }, 'lb'), 'Saco x125 lb');
  assert.equal(presentationLabel({ name: 'Saco', units: 62.5 }, 'lb'), 'Saco x62.5 lb');
});

test('buttonLabel', () => {
  assert.equal(buttonLabel('Paquete'), 'Paq.');
  assert.equal(buttonLabel('Caja'), 'Caja');
  assert.equal(buttonLabel('Docena'), 'Docena');
});

test('lineBaseQty', () => {
  assert.equal(lineBaseQty({ quantity: 2, presentation: { name: 'Paquete', units: 12 } }), 24);
  // Review Focus 2: una línea vieja, sin presentación, es suelta (units_per = 1).
  assert.equal(lineBaseQty({ quantity: 3 }), 3);
  // Sin ruido de coma flotante: 0.1 × 3 = 0.30000000000000004.
  assert.equal(lineBaseQty({ quantity: 0.1, presentation: { name: 'x', units: 3 } }), 0.3);
});

test('baseQtyInCart', () => {
  const items = [
    line({ cartItemId: 'a', quantity: 2, presentation: { id: 'pp', name: 'Paquete', units: 12 } }),
    line({ cartItemId: 'b', quantity: 3 }),
    line({ cartItemId: 'c', quantity: 5, product: galletas({ id: 'otro' }) }),
  ];
  assert.equal(baseQtyInCart('g1', items), 27);
  // Excluyendo la línea de paquetes (la que se está editando): quedan las 3 sueltas.
  assert.equal(baseQtyInCart('g1', items, 'a'), 3);
  assert.equal(baseQtyInCart('nada', items), 0);
});

test('maxAddable', () => {
  const items = [
    line({ cartItemId: 'a', quantity: 2, presentation: { id: 'pp', name: 'Paquete', units: 12 } }),
    line({ cartItemId: 'b', quantity: 3 }),
  ];
  const p = galletas({ stock: 30 }); // 27 en el carrito: quedan 3
  assert.equal(maxAddable(p, items, 12), 0);
  assert.equal(maxAddable(p, items, 1), 3);
  assert.equal(maxAddable(p, [], 12), 2);
  // Sin control de inventario no hay tope.
  assert.equal(maxAddable(galletas({ stock: 0, tracksStock: false }), items, 12), Infinity);
  // Nunca negativo.
  assert.equal(maxAddable(galletas({ stock: 10 }), items, 1), 0);

  // Lo suelto no se redondea hacia abajo: una unidad medible con saldo fraccionario
  // muestra el saldo exacto (0.5 lb sigue siendo vendible); las presentaciones sí.
  const libras = galletas({ unit: 'lb', stock: 3.5 });
  assert.equal(maxAddable(libras, [], 1), 3.5);
  assert.equal(maxAddable(libras, [], 2), 1);
  assert.equal(maxAddable(galletas({ unit: 'lb', stock: 0.5 }), [], 1), 0.5);
  // El saldo suelto descuenta lo que ya hay en el carrito, sin ruido de coma flotante.
  assert.equal(maxAddable(libras, [line({ quantity: 0.1 }), line({ cartItemId: 'c2', quantity: 0.2 })], 1), 3.2);
});

test('isSellable', () => {
  const sinSuelto = (stock, over = {}) => galletas({ soldLoose: false, stock, ...over });
  // soldLoose false: tiene que alcanzar para la presentación más chica (12).
  assert.equal(isSellable(sinSuelto(11)), false);
  assert.equal(isSellable(sinSuelto(12)), true);
  assert.equal(isSellable(sinSuelto(12, { presentations: [] })), false);
  assert.equal(isSellable(sinSuelto(12, { presentations: undefined })), false);
  // Sin control de inventario siempre se puede vender.
  assert.equal(isSellable(sinSuelto(0, { tracksStock: false })), true);
  // Suelto: basta con que haya algo.
  assert.equal(isSellable(galletas({ soldLoose: true, stock: 0 })), false);
  assert.equal(isSellable(galletas({ soldLoose: true, stock: 1 })), true);
  assert.equal(isSellable(galletas({ stock: 0 })), false);
});

test('lineProduct', () => {
  const p = galletas();
  const lp = lineProduct(p, PAQUETE);
  assert.equal(lp.price, 160);
  assert.equal(lp.id, 'g1');
  assert.equal(p.price, 15); // no muta el original
  // Sin presentación devuelve el mismo objeto.
  assert.equal(lineProduct(p), p);
  assert.equal(lineProduct(p, undefined), p);

  // El precio por mayor es por unidad: la línea de una presentación no lo hereda
  // (5 paquetes no deben cobrarse a 12 cada uno en vez de 160).
  const conMayor = galletas({ wholesalePrice: 12, wholesaleMinQuantity: 5 });
  const lm = lineProduct(conMayor, PAQUETE);
  assert.equal(lm.price, 160);
  assert.equal(lm.wholesalePrice, undefined);
  assert.equal(lm.wholesaleMinQuantity, undefined);
  assert.equal(lm.id, 'g1');
  // El original conserva su precio por mayor.
  assert.equal(conMayor.wholesalePrice, 12);
  assert.equal(conMayor.wholesaleMinQuantity, 5);
  assert.equal(lineProduct(conMayor), conMayor);
});

test('toLinePresentation', () => {
  assert.deepEqual(toLinePresentation(PAQUETE), { id: 'pp', name: 'Paquete', units: 12 });
});

test('findByCode', () => {
  const g = galletas();
  const otro = galletas({ id: 'o1', code: 'ABC', presentations: [] });
  const found = findByCode(' 7501-288 ', [otro, g]);
  assert.equal(found.product, g);
  assert.equal(found.presentation, CAJA);

  // El código del producto: sin presentación; ignora mayúsculas.
  const porProducto = findByCode('abc', [otro, g]);
  assert.equal(porProducto.product, otro);
  assert.equal(porProducto.presentation, undefined);

  assert.equal(findByCode('nope', [otro, g]), undefined);
  assert.equal(findByCode('   ', [otro, g]), undefined);

  // Si un producto tiene el código 'X' y la presentación de otro también, gana el producto,
  // aunque la presentación aparezca primero en la lista.
  const conPres = galletas({ id: 'a1', code: 'A', presentations: [{ id: 'x', name: 'Caja', units: 6, price: 1, code: 'X' }] });
  const conCodigo = galletas({ id: 'b1', code: 'X', presentations: [] });
  const gana = findByCode('x', [conPres, conCodigo]);
  assert.equal(gana.product, conCodigo);
  assert.equal(gana.presentation, undefined);
});

test('breakdownStock', () => {
  const pres = [PAQUETE, CAJA]; // en cualquier orden
  assert.deepEqual(breakdownStock(1250, pres), [
    { name: 'Caja', count: 4 },
    { name: 'Paquete', count: 8 },
    { name: null, count: 2 },
  ]);
  assert.deepEqual(breakdownStock(288, pres), [{ name: 'Caja', count: 1 }]);
  // Review Focus 4: unidad medible, el sobrante lleva decimales.
  assert.deepEqual(breakdownStock(260.5, [{ name: 'Saco', units: 125 }]), [
    { name: 'Saco', count: 2 },
    { name: null, count: 10.5 },
  ]);
  assert.deepEqual(breakdownStock(0, pres), []);
  // Menos que la presentación más chica: todo suelto.
  assert.deepEqual(breakdownStock(5, pres), [{ name: null, count: 5 }]);
  // Sin presentaciones: todo suelto.
  assert.deepEqual(breakdownStock(7, []), [{ name: null, count: 7 }]);
});

test('formatBreakdown', () => {
  const parts = breakdownStock(1250, [PAQUETE, CAJA]);
  assert.equal(formatBreakdown(parts, 'und'), '4 Caja, 8 Paq., 2 und');
  assert.equal(formatBreakdown([{ name: 'Saco', count: 2 }, { name: null, count: 10.5 }], 'lb'), '2 Saco, 10.5 lb');
  assert.equal(formatBreakdown([], 'und'), '0 und');
});

test('validateDrafts', () => {
  const opts = (over = {}) => ({
    productName: 'Galletas',
    decimals: false,
    soldLoose: true,
    takenCodes: new Map(),
    ...over,
  });
  const draft = (over = {}) => ({ name: 'Paquete', units: 12, price: 160, code: '', ...over });

  // Bien armado, o sin presentaciones pero suelto.
  assert.equal(validateDrafts([draft(), draft({ name: 'Caja', units: 288, price: 3600, code: 'A-1' })], opts()), null);
  assert.equal(validateDrafts([], opts()), null);
  // Precio 0 y unidad medible con fracción son válidos.
  assert.equal(validateDrafts([draft({ price: 0 })], opts()), null);
  assert.equal(validateDrafts([draft({ units: 62.5 })], opts({ decimals: true })), null);

  assert.equal(validateDrafts([draft({ name: '   ' })], opts()), 'La presentación necesita un nombre.');
  assert.equal(
    validateDrafts([draft({ units: 1 })], opts()),
    'Una presentación tiene que traer más de una unidad.',
  );
  assert.equal(
    validateDrafts([draft({ units: '' })], opts()),
    'Una presentación tiene que traer más de una unidad.',
  );
  assert.equal(
    validateDrafts([draft({ units: 12.5 })], opts({ decimals: false })),
    '«Galletas» se cuenta por piezas: la presentación tiene que traer una cantidad entera.',
  );
  assert.equal(
    validateDrafts([draft({ price: -1 })], opts()),
    'El precio de la presentación no puede ser negativo.',
  );
  assert.equal(
    validateDrafts([draft({ price: '' })], opts()),
    'El precio de la presentación no puede ser negativo.',
  );
  // Nombre repetido con otro casing y espacios.
  assert.equal(
    validateDrafts([draft({ name: 'Caja' }), draft({ name: ' caja ', units: 24 })], opts()),
    'Ya hay una presentación llamada «caja» en este producto.',
  );
  // Código que ya usa otro en la sucursal (las claves van en minúscula).
  const taken = new Map([['abc-1', 'Otro']]);
  assert.equal(
    validateDrafts([draft({ code: ' ABC-1 ' })], opts({ takenCodes: taken })),
    'El código «ABC-1» ya lo usa «Otro» en esta sucursal.',
  );
  // Dos borradores con el mismo código: el dueño es este mismo producto.
  assert.equal(
    validateDrafts([draft({ code: 'X' }), draft({ name: 'Caja', units: 24, code: 'x' })], opts()),
    'El código «x» ya lo usa «Galletas» en esta sucursal.',
  );
  // Sin presentaciones y sin venta suelta.
  assert.equal(
    validateDrafts([], opts({ soldLoose: false })),
    'Si «Galletas» no se vende suelto, necesita al menos una presentación.',
  );
  assert.equal(validateDrafts([draft()], opts({ soldLoose: false })), null);

  // Se informa el primer error por borrador, en el orden de la base: nombre, unidades, precio.
  assert.equal(
    validateDrafts([draft({ units: 1, price: -1 })], opts()),
    'Una presentación tiene que traer más de una unidad.',
  );
});

test('PRESENTATION_CSV_HEADERS', () => {
  assert.deepEqual(PRESENTATION_CSV_HEADERS, [
    'presentacion_1', 'contiene_1', 'precio_1', 'codigo_1',
    'presentacion_2', 'contiene_2', 'precio_2', 'codigo_2',
    'presentacion_3', 'contiene_3', 'precio_3', 'codigo_3',
  ]);
});

// Stand-in del lector de números del CSV: vacío o no numérico = undefined.
const parseNum = (s) => {
  if (s == null || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const fromRow = (row) => (key) => row[key];

test('parsePresentationColumns', () => {
  // Una presentación completa.
  assert.deepEqual(
    parsePresentationColumns(
      fromRow({ presentacion_1: 'Paquete', contiene_1: '12', precio_1: '160', codigo_1: '7501-12' }),
      parseNum,
    ),
    { presentations: [{ name: 'Paquete', units: 12, price: 160, code: '7501-12' }], errors: [] },
  );
  // Sin código: la clave no aparece.
  assert.deepEqual(
    parsePresentationColumns(fromRow({ presentacion_1: ' Caja ', contiene_1: '288', precio_1: '3600' }), parseNum),
    { presentations: [{ name: 'Caja', units: 288, price: 3600 }], errors: [] },
  );
  // Todo vacío.
  assert.deepEqual(parsePresentationColumns(fromRow({}), parseNum), { presentations: [], errors: [] });
  assert.deepEqual(
    parsePresentationColumns(fromRow({ presentacion_1: '  ', contiene_1: '', precio_1: '', codigo_1: '' }), parseNum),
    { presentations: [], errors: [] },
  );
  // Una presentación mala no tumba a las demás; los números de error son 1-based.
  assert.deepEqual(
    parsePresentationColumns(
      fromRow({
        presentacion_1: 'Paquete', contiene_1: '12', precio_1: '160',
        contiene_2: '24',
        presentacion_3: 'Caja', contiene_3: '288', precio_3: '3600',
      }),
      parseNum,
    ),
    {
      presentations: [
        { name: 'Paquete', units: 12, price: 160 },
        { name: 'Caja', units: 288, price: 3600 },
      ],
      errors: ['Presentación 2: falta el nombre.'],
    },
  );
  assert.deepEqual(
    parsePresentationColumns(fromRow({ presentacion_1: 'Caja', precio_1: '3600' }), parseNum).errors,
    ['Presentación 1: falta cuántas unidades trae.'],
  );
  assert.deepEqual(
    parsePresentationColumns(fromRow({ presentacion_1: 'Caja', contiene_1: '288' }), parseNum).errors,
    ['Presentación 1: falta el precio.'],
  );
  // Un número escrito pero ilegible no es "falta": es otro error.
  assert.deepEqual(
    parsePresentationColumns(fromRow({ presentacion_1: 'Caja', contiene_1: 'doce', precio_1: '3600' }), parseNum),
    { presentations: [], errors: ['Presentación 1: cuántas unidades trae no es un número válido.'] },
  );
  assert.deepEqual(
    parsePresentationColumns(fromRow({ presentacion_1: 'Caja', contiene_1: '288', precio_1: 'barato' }), parseNum),
    { presentations: [], errors: ['Presentación 1: el precio no es un número válido.'] },
  );
});

test('presentationColumns', () => {
  assert.deepEqual(presentationColumns(galletas()), {
    presentacion_1: 'Paquete', contiene_1: '12', precio_1: '160', codigo_1: '7501-12',
    presentacion_2: 'Caja', contiene_2: '288', precio_2: '3600', codigo_2: '7501-288',
    presentacion_3: '', contiene_3: '', precio_3: '', codigo_3: '',
  });
  // Sin presentaciones: las 12 columnas vacías, en el orden de los encabezados.
  const vacias = presentationColumns(galletas({ presentations: undefined }));
  assert.deepEqual(Object.keys(vacias), [...PRESENTATION_CSV_HEADERS]);
  assert.ok(Object.values(vacias).every((v) => v === ''));
  // Unidad medible con fracción, presentación sin código; solo salen las 3 primeras.
  const arroz = galletas({
    unit: 'lb',
    presentations: [
      { id: '1', name: 'Saco', units: 62.5, price: 1500 },
      { id: '2', name: 'Fardo', units: 125, price: 2900 },
      { id: '3', name: 'Quintal', units: 100, price: 2300 },
      { id: '4', name: 'Camión', units: 5000, price: 99000 },
    ],
  });
  const cols = presentationColumns(arroz);
  assert.equal(cols.presentacion_1, 'Saco');
  assert.equal(cols.contiene_1, '62.5');
  assert.equal(cols.codigo_1, '');
  assert.equal(cols.presentacion_2, 'Quintal');
  assert.equal(cols.presentacion_3, 'Fardo');
});

test('resolveQuotedPresentation', () => {
  const p = galletas({ presentations: [{ ...PAQUETE, price: 175 }] });

  // Review Focus 3: la Caja cotizada ya no existe.
  assert.deepEqual(
    resolveQuotedPresentation({ id: 'pc', name: 'Caja', units: 288 }, p),
    { missing: 'Caja de Galletas (la presentación ya no existe)' },
  );
  // Cotizada sin id (se borró después de cotizar y quedó nulo): tampoco se puede cargar.
  assert.deepEqual(
    resolveQuotedPresentation({ name: 'Caja', units: 288 }, p),
    { missing: 'Caja de Galletas (la presentación ya no existe)' },
  );
  // Sin presentación y el producto ya no se vende suelto.
  assert.deepEqual(
    resolveQuotedPresentation(undefined, galletas({ soldLoose: false })),
    { missing: 'Galletas (ya no se vende suelto)' },
  );
  // Con el id presente: la presentación ACTUAL, con su precio de hoy.
  const r = resolveQuotedPresentation({ id: 'pp', name: 'Paquete', units: 12 }, p);
  assert.equal(r.missing, undefined);
  assert.equal(r.presentation.price, 175);
  assert.equal(r.presentation.id, 'pp');
  // Sin presentación y suelto.
  assert.deepEqual(resolveQuotedPresentation(undefined, galletas()), {});
});
