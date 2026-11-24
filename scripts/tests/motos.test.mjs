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
  matchesVehicle, normalizeChassis, REGISTRATION_STATUS_LABEL, VEHICLE_STATUS, vehicleLabel, vehicleLineName,
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
