// Módulo Motopréstamos: catálogo, rubro, etiquetas de vehículos y reportes.
// `npm test` corre `node --test`; Node quita los tipos de los .ts al importarlos.
import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_MODULES, moduleForRoute, resolveEnabledModules } from '../../src/lib/modules.ts';
import { BUSINESS_TYPE_PRESETS, OPTIONAL_VERTICALS } from '../../src/lib/business-types.ts';

test('las rutas /motos son del módulo Motopréstamos', () => {
  assert.equal(moduleForRoute('/motos'), 'motoprestamos');
  assert.equal(moduleForRoute('/motos/ficha'), 'motoprestamos');
  assert.equal(moduleForRoute('/motosierra'), null);
});

test('el módulo viene apagado y se enciende por empresa', () => {
  const mod = APP_MODULES.find((m) => m.key === 'motoprestamos');
  assert.ok(mod);
  assert.equal(mod.defaultEnabled, false);
  assert.equal(resolveEnabledModules([]).has('motoprestamos'), false);
  assert.equal(resolveEnabledModules([{ module_key: 'motoprestamos', enabled: true }]).has('motoprestamos'), true);
});

test('el rubro Motopréstamos enciende sus módulos y siembra el tipo Motor', () => {
  const preset = BUSINESS_TYPE_PRESETS.motoprestamos;
  assert.ok(preset);
  assert.deepEqual([...preset.modules].sort(), ['caja', 'customer-portal', 'motoprestamos', 'prestamos']);
  assert.deepEqual(preset.vehicleTypes, ['Motor']);
  assert.ok(OPTIONAL_VERTICALS.includes('motoprestamos'));
});

// --- Etiquetas y descripción de vehículos (src/lib/motos.ts) ---
import {
  matchesVehicle, motivoParaNoMarcarVehiculo, normalizeChassis, parseMonto, REGISTRATION_STATUS_LABEL, unidadesParaElegir,
  VEHICLE_STATUS, vehicleLabel, vehicleLineName,
} from '../../src/lib/motos.ts';

// Chasis y motor antes que año y color: el e-CF corta el nombre a 80 caracteres.
test('descripción de la línea igual que motos_descripcion en la base', () => {
  assert.equal(
    vehicleLineName({ brand: 'Honda', model: 'CG 150', year: 2025, color: 'Azul', chassis: 'abc 123', engineNumber: 'M-1' }),
    'Honda CG 150 · Chasis abc 123 · Motor M-1 · 2025 · Azul');
  assert.equal(vehicleLineName({ brand: 'Yamaha', model: 'YBR', chassis: 'GAR-1' }), 'Yamaha YBR · Chasis GAR-1');
  assert.equal(vehicleLineName({ brand: 'Honda', model: 'CG 150', chassis: 'V-2', engineNumber: 'E-2' }), 'Honda CG 150 · Chasis V-2 · Motor E-2');
  assert.equal(vehicleLineName({ brand: '  ', model: 'CG 150', color: ' ', chassis: ' V-9 ' }), 'CG 150 · Chasis V-9');
});

test('etiqueta corta del vehículo, sin chasis ni motor', () => {
  assert.equal(vehicleLabel({ brand: 'Honda', model: 'CG 150', year: 2025, color: 'Roja' }), 'Honda CG 150 · 2025 · Roja');
  assert.equal(vehicleLabel({}), 'Vehículo');
});

test('estados con su etiqueta', () => {
  assert.deepEqual(Object.keys(VEHICLE_STATUS), ['disponible', 'vendido', 'en_garantia', 'recuperado', 'liberado', 'baja']);
  assert.equal(VEHICLE_STATUS.en_garantia.label, 'En garantía');
  assert.equal(VEHICLE_STATUS.baja.label, 'De baja');
  assert.equal(REGISTRATION_STATUS_LABEL.lista_para_entregar, 'Lista para entregar');
});

test('chasis comparables sin espacios ni minúsculas', () => {
  assert.equal(normalizeChassis('  abc 12 3 '), 'ABC123');
});

test('búsqueda por chasis, placa, modelo o cliente', () => {
  const v = { brand: 'Honda', model: 'CG 150', color: 'Roja', chassis: 'LTM-123', plate: 'K000123', customerName: 'Juan Pérez' };
  assert.equal(matchesVehicle(v, 'ltm123'), true);
  assert.equal(matchesVehicle(v, 'k000'), true);
  assert.equal(matchesVehicle(v, 'cg 150'), true);
  assert.equal(matchesVehicle(v, 'perez'), true);
  assert.equal(matchesVehicle(v, 'yamaha'), false);
  assert.equal(matchesVehicle(v, ''), true);
});

test('selector de chasis: qué unidades ofrece y qué dice cuando no hay', () => {
  const moto = { id: 'p1', name: 'Honda CG 150' };
  const u = (id, o = {}) => ({ id, productId: 'p1', status: 'disponible', brand: 'Honda', model: 'CG 150', chassis: id, ...o });
  const unidades = [u('A', { color: 'Roja' }), u('B', { color: 'Negra' }), u('C', { status: 'vendido' }), u('D', { productId: 'p2' })];

  // Ofrece las disponibles de ese artículo que no están ya en un carrito.
  const r = unidadesParaElegir(unidades, moto, new Set(['A']), '');
  assert.deepEqual(r.opciones.map((v) => v.id), ['B']);
  assert.equal(r.aviso, null);

  // Sin unidades disponibles del artículo.
  assert.equal(unidadesParaElegir([u('C', { status: 'vendido' })], moto, new Set(), '').aviso,
    'No hay unidades disponibles de Honda CG 150. Ingrésalas desde Vehículos.');
  // Las hay, pero todas están en un carrito: no es que falten.
  assert.equal(unidadesParaElegir(unidades, moto, new Set(['A', 'B']), '').aviso,
    'Las unidades disponibles de Honda CG 150 ya están en un carrito.');
  // Las hay libres, pero la búsqueda no encuentra ninguna.
  assert.equal(unidadesParaElegir(unidades, moto, new Set(), 'azul').aviso, 'Ninguna unidad coincide con «azul».');
  assert.deepEqual(unidadesParaElegir(unidades, moto, new Set(), 'negra').opciones.map((v) => v.id), ['B']);
});

test('montos de la unidad: con comas de miles, vacío o inválido', () => {
  assert.equal(parseMonto('95,000'), 95000);
  assert.equal(parseMonto(' 1,250.50 '), 1250.5);
  assert.equal(parseMonto('70000'), 70000);
  assert.equal(parseMonto(''), undefined);
  assert.equal(parseMonto('   '), undefined);
  assert.ok(Number.isNaN(parseMonto('95.000,00')));
  assert.ok(Number.isNaN(parseMonto('abc')));
  assert.ok(Number.isNaN(parseMonto('-5')));
});

test('marcar un artículo como vehículo: dice qué hacer antes, con los campos a la vista', () => {
  const base = { eraVehiculo: false, esVehiculo: true, stock: 0, presentaciones: 0 };
  assert.equal(motivoParaNoMarcarVehiculo(base), null);
  // Ya era vehículo o no se marca: nada que avisar.
  assert.equal(motivoParaNoMarcarVehiculo({ ...base, eraVehiculo: true, stock: 3 }), null);
  assert.equal(motivoParaNoMarcarVehiculo({ ...base, esVehiculo: false, stock: 3 }), null);
  assert.equal(motivoParaNoMarcarVehiculo({ ...base, stock: 5 }),
    'Tiene 5 en existencias. Apaga «Es un vehículo», pon las existencias en 0 y guarda; después márcalo e ingresa cada moto desde Vehículos.');
  assert.equal(motivoParaNoMarcarVehiculo({ ...base, presentaciones: 2 }),
    'Tiene presentaciones. Apaga «Es un vehículo», quítalas y guarda; después márcalo.');
});

// --- Reportes de vehículos (src/lib/motos-reportes.ts) ---
import { carteraDeVehiculos, ventasDeVehiculos } from '../../src/lib/motos-reportes.ts';

const veh = (o) => ({ status: 'disponible', brand: 'Honda', model: 'CG 150', cost: 0, ...o });

test('cartera: unidades por estado, inventario a costo y vendidos a cuotas', () => {
  const vehicles = [
    veh({ id: 'a', cost: 50000 }),
    veh({ id: 'b', cost: 60000 }),
    veh({ id: 'c', status: 'vendido', saleId: 's-cuotas', cost: 70000 }),
    veh({ id: 'd', status: 'vendido', saleId: 's-contado', cost: 65000 }),
  ];
  const saldos = new Map([['s-cuotas', { pendiente: 30000, atrasado: true }]]);
  const c = carteraDeVehiculos(vehicles, saldos);
  assert.equal(c.porEstado.disponible, 2);
  assert.equal(c.porEstado.vendido, 2);
  assert.equal(c.porEstado.baja, 0);
  assert.equal(c.inventarioACosto, 110000);
  assert.deepEqual(c.vendidosACuotas, { cantidad: 1, pendiente: 30000, atrasados: 1 });
});

test('ventas del período por modelo, contado frente a financiado', () => {
  const vehicles = [
    veh({ id: 'c', status: 'vendido', saleId: 's1' }),
    veh({ id: 'd', status: 'vendido', saleId: 's2' }),
    veh({ id: 'e', status: 'vendido', saleId: 's3', brand: 'Suzuki', model: 'GN 125' }),
    veh({ id: 'f', status: 'vendido', saleId: 'vieja' }),
  ];
  const d = (dia) => new Date(2026, 10, dia);
  const ventas = [
    { id: 's1', createdAt: d(10), paymentMethod: 'cash' },
    { id: 's2', createdAt: d(12), paymentMethod: 'financing', downPayment: 20000, installments: 52, frequency: 'weekly' },
    { id: 's3', createdAt: d(15), paymentMethod: 'financing', downPayment: 10000, installments: 26, frequency: 'weekly' },
    { id: 'vieja', createdAt: d(1), paymentMethod: 'cash' },
  ];
  const r = ventasDeVehiculos(vehicles, ventas, d(5), d(30));
  assert.equal(r.contado, 1);
  assert.equal(r.financiado, 2);
  assert.equal(r.inicialPromedio, 15000);
  assert.equal(r.plazoPromedio, 39);
  assert.deepEqual(r.porModelo, [
    { modelo: 'Honda CG 150', contado: 1, financiado: 1 },
    { modelo: 'Suzuki GN 125', contado: 0, financiado: 1 },
  ]);
});

// --- 2B: garantía en préstamos y matrículas (src/lib/motos.ts, motos-reportes.ts) ---
import {
  deudaDelVehiculo, diasDesde, entregaDeMatricula, matriculasPorPestana, reporteDeMatriculas, vehiculosParaGarantia,
} from '../../src/lib/motos.ts';

test('garantía: solo las motos del cliente en esa sucursal, liberadas o vendidas', () => {
  const lista = [
    { id: 'lib', customerId: 'c1', branchId: 'b1', status: 'liberado' },
    { id: 'ven', customerId: 'c1', branchId: 'b1', status: 'vendido' },
    { id: 'gar', customerId: 'c1', branchId: 'b1', status: 'en_garantia' },
    { id: 'otro', customerId: 'c2', branchId: 'b1', status: 'liberado' },
    { id: 'suc', customerId: 'c1', branchId: 'b2', status: 'liberado' },
    { id: 'baja', customerId: 'c1', branchId: 'b1', status: 'baja' },
  ];
  assert.deepEqual(vehiculosParaGarantia(lista, 'c1', 'b1').map((v) => v.id), ['lib', 'ven']);
});

test('entrega de la matrícula: lista sí, con deuda solo el admin y forzada', () => {
  assert.deepEqual(entregaDeMatricula({ registrationStatus: 'lista_para_entregar' }, false),
    { puede: true, forzada: false, aviso: null });
  const admin = entregaDeMatricula({ registrationStatus: 'en_custodia' }, true);
  assert.equal(admin.puede, true);
  assert.equal(admin.forzada, true);
  assert.match(admin.aviso, /motivo/);
  const cajero = entregaDeMatricula({ registrationStatus: 'en_custodia' }, false);
  assert.equal(cajero.puede, false);
  assert.equal(cajero.aviso, 'La deuda de esta moto no está saldada. Solo un administrador puede entregar la matrícula, y con motivo.');
  assert.equal(entregaDeMatricula({ registrationStatus: 'entregada' }, true).puede, false);
  assert.equal(entregaDeMatricula({ registrationStatus: 'no_aplica' }, true).puede, false);
});

test('días desde una fecha, de calendario y cruzando de mes', () => {
  assert.equal(diasDesde(new Date(2026, 9, 30, 18, 0), new Date(2026, 10, 2, 8, 0)), 3);
  assert.equal(diasDesde(new Date(2026, 10, 2, 8, 0), new Date(2026, 10, 2, 23, 0)), 0);
});

test('matrículas por pestaña: listas la más vieja primero, entregadas la más reciente primero', () => {
  const d = (dia) => new Date(2026, 10, dia);
  const lista = [
    { id: 'c', registrationStatus: 'en_custodia', registrationSince: d(1) },
    { id: 'l2', registrationStatus: 'lista_para_entregar', registrationSince: d(10) },
    { id: 'l1', registrationStatus: 'lista_para_entregar', registrationSince: d(3) },
    { id: 'e1', registrationStatus: 'entregada', registrationDeliveredAt: d(4) },
    { id: 'e2', registrationStatus: 'entregada', registrationDeliveredAt: d(9) },
    { id: 'n', registrationStatus: 'no_aplica' },
  ];
  const p = matriculasPorPestana(lista);
  assert.deepEqual(p.enCustodia.map((v) => v.id), ['c']);
  assert.deepEqual(p.listas.map((v) => v.id), ['l1', 'l2']);
  assert.deepEqual(p.entregadas.map((v) => v.id), ['e2', 'e1']);
});

test('deuda de la moto: el préstamo si está en garantía o liberada, la venta si está vendida', () => {
  const ventas = new Map([['s1', { pendiente: 30000, atrasado: false }]]);
  const prestamos = new Map([['l1', { pendiente: 8000, atrasado: true }]]);
  assert.deepEqual(deudaDelVehiculo({ status: 'en_garantia', loanId: 'l1' }, ventas, prestamos), { pendiente: 8000, atrasado: true });
  assert.deepEqual(deudaDelVehiculo({ status: 'liberado', loanId: 'l1' }, ventas, prestamos), { pendiente: 8000, atrasado: true });
  // Incautada (4A): el préstamo sigue corriendo y la ficha muestra su saldo.
  assert.deepEqual(deudaDelVehiculo({ status: 'recuperado', loanId: 'l1' }, ventas, prestamos), { pendiente: 8000, atrasado: true });
  assert.deepEqual(deudaDelVehiculo({ status: 'vendido', saleId: 's1' }, ventas, prestamos), { pendiente: 30000, atrasado: false });
  assert.equal(deudaDelVehiculo({ status: 'disponible' }, ventas, prestamos), null);
  assert.equal(deudaDelVehiculo({ status: 'vendido', saleId: 'otra' }, ventas, prestamos), null);
});

test('cartera: cada préstamo con garantía cuenta una vez aunque tenga dos motos', () => {
  const vehicles = [
    veh({ id: 'g1', status: 'en_garantia', loanId: 'L', cost: undefined }),
    veh({ id: 'g2', status: 'en_garantia', loanId: 'L', cost: undefined }),
    veh({ id: 'g3', status: 'en_garantia', loanId: 'M', cost: undefined }),
    veh({ id: 'a', cost: 50000 }),
  ];
  const prestamos = new Map([['L', { pendiente: 40000, atrasado: true }], ['M', { pendiente: 0, atrasado: false }]]);
  const c = carteraDeVehiculos(vehicles, new Map(), prestamos);
  assert.deepEqual(c.prestamosConGarantia, { cantidad: 1, pendiente: 40000, atrasados: 1 });
  assert.equal(c.inventarioACosto, 50000);
  assert.deepEqual(carteraDeVehiculos(vehicles, new Map()).prestamosConGarantia, { cantidad: 0, pendiente: 0, atrasados: 0 });
});

test('reporte de matrículas: listas hace más de 30 días y entregadas en el período', () => {
  const d = (mes, dia) => new Date(2026, mes, dia);
  const hoy = d(10, 24);
  const lista = [
    { registrationStatus: 'en_custodia', registrationSince: d(10, 1) },
    { registrationStatus: 'lista_para_entregar', registrationSince: d(9, 10) },  // 45 días
    { registrationStatus: 'lista_para_entregar', registrationSince: d(10, 20) },
    { registrationStatus: 'entregada', registrationDeliveredAt: d(10, 5) },
    { registrationStatus: 'entregada', registrationDeliveredAt: d(8, 5) },     // fuera del período
  ];
  assert.deepEqual(reporteDeMatriculas(lista, d(10, 1), d(10, 30), hoy),
    { enCustodia: 1, listas: 2, listasMasDe30: 1, entregadasEnPeriodo: 1 });
});

import { PERMISSION_RESOURCES, RESOURCE_MODULE, actionsFor } from '../../src/lib/permissions.ts';

test('cobranza: tres permisos del módulo, con las acciones que usa la base', () => {
  for (const key of ['cobranza', 'cobranza-all', 'cobranza-cuadre']) {
    assert.ok(PERMISSION_RESOURCES.some((r) => r.key === key), key);
    assert.equal(RESOURCE_MODULE[key], 'motoprestamos', key);
  }
  assert.deepEqual(actionsFor('cobranza'), ['view', 'create']);
  assert.deepEqual(actionsFor('cobranza-all'), ['view']);
  assert.deepEqual(actionsFor('cobranza-cuadre'), ['view', 'create']);
});

import { itemDeRuta } from '../../src/lib/rutas.ts';

test('el permiso de una página es el del ítem del menú más específico', () => {
  const items = [
    { href: '/motos', permission: 'motos' },
    { href: '/motos/cobranza', permission: 'cobranza' },
    { href: '/motos/cobranza/asignar', permission: 'cobranza-all' },
    { href: '/motos/config', permission: 'motos-config' },
  ];
  assert.equal(itemDeRuta(items, '/motos/cobranza')?.permission, 'cobranza');
  assert.equal(itemDeRuta(items, '/motos/cobranza/asignar')?.permission, 'cobranza-all');
  assert.equal(itemDeRuta(items, '/motos/config')?.permission, 'motos-config');
  assert.equal(itemDeRuta(items, '/motos/ficha')?.permission, 'motos');
  assert.equal(itemDeRuta(items, '/motos')?.permission, 'motos');
  assert.equal(itemDeRuta(items, '/motosierra'), undefined);
});

import { REPORT_ITEMS } from '../../src/lib/permissions.ts';

test('los reportes de cobranza se pueden dar o quitar en un rol', () => {
  const slugs = REPORT_ITEMS.map((r) => r.slug);
  assert.ok(slugs.includes('cobranza'));
  assert.ok(slugs.includes('cuadres'));
});

test('el reporte de recuperaciones se puede dar o quitar en un rol', () => {
  assert.ok(REPORT_ITEMS.some((r) => r.slug === 'recuperaciones'));
});
