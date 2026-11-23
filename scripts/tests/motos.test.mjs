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
