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
  matchesVehicle, normalizeChassis, REGISTRATION_STATUS_LABEL, unidadesParaElegir, VEHICLE_STATUS, vehicleLabel, vehicleLineName,
} from '../../src/lib/motos.ts';

test('descripción de la línea igual que motos_descripcion en la base', () => {
  assert.equal(
    vehicleLineName({ brand: 'Honda', model: 'CG 150', year: 2025, color: 'Azul', chassis: 'abc 123', engineNumber: 'M-1' }),
    'Honda CG 150 · 2025 · Azul · Chasis abc 123 · Motor M-1');
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
