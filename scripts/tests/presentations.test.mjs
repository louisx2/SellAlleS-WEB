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
  isPrefixOfLongerCode,
  duplicateCodeMessage,
  productCodeError,
  breakdownStock,
  formatBreakdown,
  validateDrafts,
  PRESENTATION_CSV_HEADERS,
  parsePresentationColumns,
  presentationColumns,
  validatePresentationInputs,
  csvSoldLooseError,
  csvPresentationCodeErrors,
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

  // Un solo destino: no trae la marca de ambiguo.
  assert.equal('ambiguous' in found, false);
  assert.equal('ambiguous' in porProducto, false);
});

// Un código que lleva a más de un destino no elige ninguno: cobrar el que salga
// primero sería cobrar mal sin avisar (p. ej. un producto cuyo código se cambió al
// de la caja de otro).
test('findByCode: código repetido es ambiguo', () => {
  const caja = { id: 'x', name: 'Caja', units: 6, price: 1, code: 'X' };
  const conPres = galletas({ id: 'a1', code: 'A', presentations: [caja] });
  const conCodigo = galletas({ id: 'b1', code: 'X', presentations: [] });

  // Producto + presentación de otro (sin importar el orden ni las mayúsculas).
  const r1 = findByCode(' x ', [conPres, conCodigo]);
  assert.equal(r1.ambiguous, true);
  assert.equal(r1.matches.length, 2);
  assert.ok(r1.matches.some((m) => m.product === conCodigo && m.presentation === undefined));
  assert.ok(r1.matches.some((m) => m.product === conPres && m.presentation === caja));
  assert.equal(findByCode('X', [conCodigo, conPres]).ambiguous, true);

  // Dos productos con el mismo código y ninguna presentación de por medio: es un
  // problema de datos anterior a las presentaciones y se conserva lo de siempre,
  // el primero de la lista.
  const otroX = galletas({ id: 'c1', code: 'x', presentations: [] });
  const r2 = findByCode('X', [conCodigo, otroX]);
  assert.equal('ambiguous' in r2, false);
  assert.equal(r2.product, conCodigo);
  assert.equal(r2.presentation, undefined);
  assert.equal(findByCode('x', [otroX, conCodigo]).product, otroX);
  // Pero si además hay una presentación con ese código, sí es ambiguo.
  const r2b = findByCode('X', [conCodigo, otroX, conPres]);
  assert.equal(r2b.ambiguous, true);
  assert.equal(r2b.matches.length, 3);

  // Dos presentaciones (de productos distintos o del mismo).
  const otraCaja = galletas({ id: 'd1', code: 'D', presentations: [{ id: 'y', name: 'Fardo', units: 24, price: 1, code: 'x' }] });
  assert.equal(findByCode('x', [conPres, otraCaja]).ambiguous, true);
  const dosEnUno = galletas({
    id: 'e1', code: 'E',
    presentations: [{ id: 'p1', name: 'Paquete', units: 6, price: 1, code: 'Z' }, { id: 'p2', name: 'Caja', units: 24, price: 1, code: 'z' }],
  });
  assert.equal(findByCode('z', [dosEnUno]).ambiguous, true);

  // El producto y su propia presentación con el mismo código: tampoco se sabe si es suelto o la caja.
  const propio = galletas({ id: 'f1', code: 'F', presentations: [{ id: 'pf', name: 'Caja', units: 6, price: 1, code: 'f' }] });
  const r3 = findByCode('F', [propio]);
  assert.equal(r3.ambiguous, true);
  assert.deepEqual(r3.matches.map((m) => m.presentation?.id), [undefined, 'pf']);
});

test('duplicateCodeMessage', () => {
  assert.equal(
    duplicateCodeMessage(' 7501-288 '),
    'El código «7501-288» está repetido en esta sucursal; corrígelo en Inventario.',
  );
});

// El lector de mano teclea un carácter a la vez: con GAL-001 y GAL-001-12, al llegar a
// «GAL-001» el POS tiene que esperar en vez de agregar la unidad suelta.
test('isPrefixOfLongerCode', () => {
  const gal = galletas({
    id: 'g', code: 'GAL-001',
    presentations: [{ id: 'p12', name: 'Paquete', units: 12, price: 1, code: 'GAL-001-12' }],
  });
  const abc = galletas({ id: 'a', code: 'ABC', presentations: undefined });
  const abcd = galletas({ id: 'b', code: 'ABCD', presentations: [] });
  const sinCodigo = galletas({ id: 's', code: '', presentations: [{ id: 'sp', name: 'Caja', units: 6, price: 1 }] });
  const lista = [gal, abc, abcd, sinCodigo];

  // Prefijo de una presentación y de otro producto; sin distinguir mayúsculas ni bordes.
  assert.equal(isPrefixOfLongerCode('GAL-001', lista), true);
  assert.equal(isPrefixOfLongerCode(' gal-001 ', lista), true);
  assert.equal(isPrefixOfLongerCode('abc', lista), true);
  // El código completo, o uno igual a otro, no es prefijo de uno MÁS largo.
  assert.equal(isPrefixOfLongerCode('GAL-001-12', lista), false);
  assert.equal(isPrefixOfLongerCode('ABCD', lista), false);
  assert.equal(isPrefixOfLongerCode('ABC', [abc, galletas({ id: 'a2', code: 'abc', presentations: [] })]), false);
  // Nada que esperar: vacío, o un código que no empieza ningún otro.
  assert.equal(isPrefixOfLongerCode('', lista), false);
  assert.equal(isPrefixOfLongerCode('   ', lista), false);
  assert.equal(isPrefixOfLongerCode('ZZZ', lista), false);
});

// Formulario del producto: su código no puede ser el de una presentación de otro
// producto de la sucursal (el escaneo no sabría cuál es). Dos productos con el mismo
// código siguen permitidos, como antes de las presentaciones.
test('productCodeError', () => {
  const productos = [
    galletas(), // g1: código 7501, presentaciones 7501-12 y 7501-288
    galletas({ id: 'j1', name: 'Jabón', code: 'J-1', presentations: [] }),
  ];

  assert.equal(productCodeError('LIBRE', undefined, productos), null);
  assert.equal(productCodeError('   ', undefined, productos), null);
  // El de una presentación de otro producto, nombrándola (sin mayúsculas ni bordes).
  assert.equal(
    productCodeError(' 7501-288 ', 'j1', productos),
    'El código «7501-288» ya lo usa la presentación «Caja» de «Galletas» en esta sucursal.',
  );
  assert.equal(
    productCodeError('7501-12', undefined, productos),
    'El código «7501-12» ya lo usa la presentación «Paquete» de «Galletas» en esta sucursal.',
  );
  // El código de otro producto no se bloquea aquí.
  assert.equal(productCodeError(' j-1 ', undefined, productos), null);
  assert.equal(productCodeError('7501', 'j1', productos), null);
  // El producto que se edita no choca consigo mismo (sus presentaciones las revisa validateDrafts).
  assert.equal(productCodeError('7501-12', 'g1', productos), null);
  // Sin presentaciones en la sucursal no hay nada que bloquear.
  const sinPresentaciones = productos.map((p) => ({ ...p, presentations: [] }));
  assert.equal(productCodeError('7501', 'j1', sinPresentaciones), null);
  assert.equal(productCodeError('7501-288', 'j1', sinPresentaciones), null);
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

// Lo que el CSV exporta se vuelve a leer igual: sin presentaciones, con 1 y con 3, y las
// presentaciones salen de menor a mayor aunque estén desordenadas en el producto.
test('presentationColumns se lee de vuelta con parsePresentationColumns', () => {
  const sinCodigo = { id: 'ps', name: 'Docena', units: 12, price: 99.5 };
  const casos = [
    galletas({ presentations: [] }),
    galletas({ presentations: [sinCodigo] }),
    galletas({ presentations: [CAJA, PAQUETE, { id: 'px', name: 'Display', units: 48, price: 700, code: '7501-48' }] }),
    galletas({ unit: 'lb', presentations: [{ id: 'sa', name: 'Saco', units: 62.5, price: 1500 }] }),
  ];
  for (const producto of casos) {
    const cols = presentationColumns(producto);
    const { presentations, errors } = parsePresentationColumns((k) => cols[k], parseNum);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      presentations,
      presentationsOf(producto).map(({ name, units, price, code }) => (code ? { name, units, price, code } : { name, units, price })),
    );
    // Y lo leído pasa el chequeo de rangos con la unidad del producto.
    assert.equal(
      validatePresentationInputs(presentations, { productName: producto.name, decimals: producto.unit === 'lb' }),
      null,
    );
  }
});

test('validatePresentationInputs', () => {
  const opts = (over = {}) => ({ productName: 'Galletas', decimals: false, ...over });
  const input = (over = {}) => ({ name: 'Paquete', units: 12, price: 160, ...over });

  // Sin presentaciones no es error aquí: eso lo decide csvSoldLooseError.
  assert.equal(validatePresentationInputs([], opts()), null);
  assert.equal(validatePresentationInputs([input(), input({ name: 'Caja', units: 288, code: 'A-1' })], opts()), null);
  assert.equal(validatePresentationInputs([input({ price: 0 })], opts()), null);
  assert.equal(validatePresentationInputs([input({ units: 62.5 })], opts({ decimals: true })), null);

  // Mismos textos que el formulario y la base.
  assert.equal(
    validatePresentationInputs([input({ units: 1 })], opts()),
    'Una presentación tiene que traer más de una unidad.',
  );
  assert.equal(
    validatePresentationInputs([input({ units: 0 })], opts()),
    'Una presentación tiene que traer más de una unidad.',
  );
  assert.equal(
    validatePresentationInputs([input({ units: 12.5 })], opts()),
    '«Galletas» se cuenta por piezas: la presentación tiene que traer una cantidad entera.',
  );
  assert.equal(
    validatePresentationInputs([input({ price: -5 })], opts()),
    'El precio de la presentación no puede ser negativo.',
  );
  assert.equal(
    validatePresentationInputs([input(), input({ name: ' PAQUETE ', units: 24 })], opts()),
    'Ya hay una presentación llamada «PAQUETE» en este producto.',
  );
  // El mismo código dos veces en la fila; contra la sucursal no se compara (lo hace la base).
  assert.equal(
    validatePresentationInputs([input({ code: 'X' }), input({ name: 'Caja', units: 24, code: ' x ' })], opts()),
    'El código «x» ya lo usa «Galletas» en esta sucursal.',
  );
  assert.equal(validatePresentationInputs([input({ code: 'ABC-1' })], opts()), null);
});

test('csvSoldLooseError', () => {
  const MSG = 'Si «Galletas» no se vende suelto, necesita al menos una presentación.';
  const row = (over = {}) => ({ name: 'Galletas', soldLoose: undefined, presentations: [], ...over });
  const conPresentaciones = { presentations: [{ name: 'Caja' }] };

  // Celda vacía (undefined) o «sí»: no se pide nada.
  assert.equal(csvSoldLooseError(row()), null);
  assert.equal(csvSoldLooseError(row({ soldLoose: true })), null);
  // «No» con presentaciones en la fila.
  assert.equal(csvSoldLooseError(row({ soldLoose: false, presentations: [{ name: 'Caja', units: 288, price: 3600 }] })), null);
  // «No» sin presentaciones: error, igual que la base, si el producto es nuevo...
  assert.equal(csvSoldLooseError(row({ soldLoose: false })), MSG);
  // ...o existe pero no tiene ninguna.
  assert.equal(csvSoldLooseError(row({ soldLoose: false }), { presentations: [] }), MSG);
  assert.equal(csvSoldLooseError(row({ soldLoose: false }), {}), MSG);
  // Actualiza un producto que ya las tiene: la importación no borra, así que se quedan.
  assert.equal(csvSoldLooseError(row({ soldLoose: false }), conPresentaciones), null);
});

// Códigos de presentación del CSV contra el archivo y la sucursal, antes de llegar a la
// base: un solo choque en `import_product_presentations` deshace TODAS las presentaciones.
test('csvPresentationCodeErrors', () => {
  const pres = (name, code) => ({ name, units: 12, price: 100, ...(code ? { code } : {}) });
  const entry = (rowNumber, name, over = {}) => ({ rowNumber, name, code: '', presentations: [], ...over });
  const galletas = {
    id: 'g1', name: 'Galletas', code: '7501',
    presentations: [{ name: 'Paquete', code: 'G-12' }, { name: 'Caja', code: 'G-288' }],
  };
  const jabon = { id: 'j1', name: 'Jabón', code: 'J-1', presentations: [] };
  const existing = [galletas, jabon];
  const run = (entries, ex = existing) => Object.fromEntries(csvPresentationCodeErrors(entries, ex));

  // Nada que revisar: sin códigos de presentación, o códigos libres.
  assert.deepEqual(run([]), {});
  assert.deepEqual(run([entry(1, 'A', { presentations: [pres('Caja')] })]), {});
  assert.deepEqual(
    run([entry(1, 'A', { code: 'A1', presentations: [pres('Caja', 'A-CAJA')] }), entry(2, 'B', { presentations: [pres('Caja', 'B-CAJA')] })]),
    {},
  );

  // Contra la sucursal: el código de un producto o de una presentación existente.
  assert.deepEqual(
    run([entry(1, 'Nuevo', { presentations: [pres('Caja', '7501')] })]),
    { 1: 'El código «7501» ya lo usa «Galletas» en esta sucursal.' },
  );
  assert.deepEqual(
    run([entry(4, 'Nuevo', { presentations: [pres('Caja', ' g-288 ')] })]),
    { 4: 'El código «g-288» ya lo usa «Galletas» en esta sucursal.' },
  );
  assert.deepEqual(
    run([entry(2, 'Nuevo', { presentations: [pres('Paquete', 'j-1')] })]),
    { 2: 'El código «j-1» ya lo usa «Jabón» en esta sucursal.' },
  );

  // Una fila que actualiza un producto puede repetir sus propios códigos de presentación
  // (exportar y volver a importar)...
  assert.deepEqual(
    run([entry(1, 'Galletas', { code: '7501', updatesId: 'g1', presentations: [pres('Paquete', 'G-12'), pres('caja', 'g-288')] })]),
    {},
  );
  // ...pero no el código del propio producto (el trigger lo prohíbe)...
  assert.deepEqual(
    run([entry(1, 'Galletas', { code: '7501', updatesId: 'g1', presentations: [pres('Display', '7501')] })]),
    { 1: 'El código «7501» ya lo usa «Galletas» en esta sucursal.' },
  );
  // ...ni el de otra presentación suya que la fila no toca.
  assert.deepEqual(
    run([entry(1, 'Galletas', { code: '7501', updatesId: 'g1', presentations: [pres('Display', 'G-288')] })]),
    { 1: 'El código «G-288» ya lo usa «Galletas» en esta sucursal.' },
  );
  // Crear con código nuevo: no hereda nada del original, así que sus códigos chocan.
  assert.deepEqual(
    run([entry(1, 'Galletas', { code: '7501-2', presentations: [pres('Paquete', 'G-12'), pres('Caja', 'G-288')] })]),
    { 1: 'El código «G-12» ya lo usa «Galletas» en esta sucursal.' },
  );
  // Una presentación tampoco puede llevar el código de su propio producto nuevo.
  assert.deepEqual(
    run([entry(3, 'Nuevo', { code: 'N-1', presentations: [pres('Caja', 'n-1')] })]),
    { 3: 'El código «n-1» ya lo usa «Nuevo» en esta sucursal.' },
  );

  // Dentro del archivo: el mismo código en dos filas marca la segunda y nombra la primera.
  assert.deepEqual(
    run([
      entry(1, 'A', { presentations: [pres('Caja', 'X-1')] }),
      entry(2, 'B', { presentations: [pres('Caja', ' x-1')] }),
    ]),
    { 2: 'El código «x-1» de la presentación «Caja» ya lo usa la fila 1 («A») del archivo.' },
  );
  // Igual al `codigo` de otro producto del archivo, esté antes o después: se marcan las
  // dos filas (no se sabe cuál está mal), cada una nombrando a la otra.
  assert.deepEqual(
    run([entry(1, 'A', { code: 'P-1' }), entry(2, 'B', { presentations: [pres('Caja', 'p-1')] })]),
    {
      1: 'El código «P-1» ya lo usa la presentación «Caja» de la fila 2 («B») del archivo.',
      2: 'El código «p-1» de la presentación «Caja» es el código del producto de la fila 1 («A») del archivo.',
    },
  );
  assert.deepEqual(
    run([entry(1, 'B', { presentations: [pres('Caja', 'P-1')] }), entry(2, 'A', { code: 'p-1' })]),
    {
      1: 'El código «P-1» de la presentación «Caja» es el código del producto de la fila 2 («A») del archivo.',
      2: 'El código «p-1» ya lo usa la presentación «Caja» de la fila 1 («B») del archivo.',
    },
  );
  // Un código repetido dentro de la misma fila lo marca el chequeo del formulario.
  assert.deepEqual(
    run([entry(5, 'A', { presentations: [pres('Caja', 'Z'), pres('Paquete', 'z')] })]),
    { 5: 'El código «z» ya lo usa «A» en esta sucursal.' },
  );

  // Una fila marcada no se queda con sus códigos: la siguiente que use otro de ellos pasa.
  assert.deepEqual(
    run([
      entry(1, 'A', { presentations: [pres('Caja', '7501'), pres('Paquete', 'Y-1')] }),
      entry(2, 'B', { presentations: [pres('Caja', 'Y-1')] }),
    ]),
    { 1: 'El código «7501» ya lo usa «Galletas» en esta sucursal.' },
  );
  // Varias filas malas: un mensaje por fila.
  const varios = run([
    entry(1, 'A', { presentations: [pres('Caja', 'J-1')] }),
    entry(2, 'B', { presentations: [pres('Caja', 'LIBRE')] }),
    entry(3, 'C', { presentations: [pres('Caja', 'G-12')] }),
  ]);
  assert.deepEqual(Object.keys(varios), ['1', '3']);
});

// El `codigo` de la fila (el del producto) contra las presentaciones: antes solo se
// revisaban las filas que traían códigos de presentación, y un producto con el código
// de la caja de otro hacía que el escaneo cobrara el producto equivocado.
test('csvPresentationCodeErrors: el codigo del producto', () => {
  const pres = (name, code) => ({ name, units: 12, price: 100, ...(code ? { code } : {}) });
  const entry = (rowNumber, name, over = {}) => ({ rowNumber, name, code: '', presentations: [], ...over });
  const galletas = {
    id: 'g1', name: 'Galletas', code: '7501',
    presentations: [{ name: 'Paquete', code: 'G-12' }, { name: 'Caja', code: 'G-288' }],
  };
  const jabon = { id: 'j1', name: 'Jabón', code: 'J-1', presentations: [] };
  const run = (entries, ex = [galletas, jabon]) => Object.fromEntries(csvPresentationCodeErrors(entries, ex));

  // Fila nueva, sin presentaciones, con el código de una presentación de la sucursal.
  assert.deepEqual(
    run([entry(3, 'Nuevo', { code: ' g-288 ' })]),
    { 3: 'El código «g-288» ya lo usa la presentación «Caja» de «Galletas» en esta sucursal.' },
  );
  // Una fila que actualiza otro producto también (el código de Jabón choca con la caja
  // de Galletas aunque ya estuviera así antes: el escaneo no sabría cuál es).
  assert.deepEqual(
    run([entry(2, 'Jabón', { code: 'G-12', updatesId: 'j1' })], [galletas, { ...jabon, code: 'G-12' }]),
    { 2: 'El código «G-12» ya lo usa la presentación «Paquete» de «Galletas» en esta sucursal.' },
  );
  // Crear con código nuevo: el código nuevo se compara igual.
  assert.deepEqual(
    run([entry(4, 'Galletas', { code: 'G-12', presentations: [pres('Display', 'G-48')] })]),
    { 4: 'El código «G-12» ya lo usa la presentación «Paquete» de «Galletas» en esta sucursal.' },
  );
  // Las presentaciones del producto que la fila actualiza no cuentan contra su propio
  // código (de eso se encarga el chequeo de las presentaciones).
  assert.deepEqual(run([entry(1, 'Galletas', { code: '7501', updatesId: 'g1' })]), {});
  // Códigos libres, o filas sin código: nada.
  assert.deepEqual(run([entry(1, 'Nuevo', { code: 'N-1' }), entry(2, 'Otro')]), {});

  // Contra una presentación de otra fila del archivo que NO trae códigos en conflicto
  // con la sucursal: se marcan ambas.
  assert.deepEqual(
    run([entry(1, 'A', { code: 'A-1', presentations: [pres('Caja', 'X-24')] }), entry(2, 'B', { code: 'x-24' })]),
    {
      1: 'El código «X-24» de la presentación «Caja» es el código del producto de la fila 2 («B») del archivo.',
      2: 'El código «x-24» ya lo usa la presentación «Caja» de la fila 1 («A») del archivo.',
    },
  );
  // Si la fila ya tiene un error de presentación, se informa ese (uno por fila).
  assert.deepEqual(
    run([entry(5, 'Nuevo', { code: 'G-288', presentations: [pres('Caja', '7501')] })]),
    { 5: 'El código «7501» ya lo usa «Galletas» en esta sucursal.' },
  );
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
  // La Caja sigue existiendo (mismo id) pero ahora trae otra cantidad: el precio
  // cotizado era el de una caja de 12 y no se le puede aplicar a una de 288.
  assert.deepEqual(
    resolveQuotedPresentation({ id: CAJA.id, name: 'Caja', units: 12 }, galletas()),
    { missing: 'Caja de Galletas (la presentación cambió)' },
  );
  // Con el id presente: la presentación ACTUAL, con su precio de hoy.
  const r = resolveQuotedPresentation({ id: 'pp', name: 'Paquete', units: 12 }, p);
  assert.equal(r.missing, undefined);
  assert.equal(r.presentation.price, 175);
  assert.equal(r.presentation.id, 'pp');
  // Sin presentación y suelto.
  assert.deepEqual(resolveQuotedPresentation(undefined, galletas()), {});
});
