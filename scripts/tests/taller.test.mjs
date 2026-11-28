// Pruebas de la lógica pura del Taller: estados, chequeos, garantía, mensaje al
// cliente y los cálculos del reporte. `npm test` corre `node --test`, y Node quita
// los tipos de los .ts al importarlos (por eso solo tienen `import type`).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  caseNumber, checklistFor, daysInShop, equipmentLabel, isLate, isOpen, isReadyToDeliver,
  mensajeDeEstado, missingRequired, statusLabel, customerText, manualStatuses, canClose, closeLabel,
  fichaFields, camposDeFicha, valorDeFicha, defaultStaysInShop, trackingUrl, warrantyActive, whatsappPhone, fieldKey, RUBROS, tiposQueFaltan,
  ordenNueva,
} from '../../src/lib/taller.ts';
import {
  duracion, fechaDeCobro, porTecnico, resumen, tiempoPorEstado, topEquipos, topLineas,
} from '../../src/lib/taller-reportes.ts';
import { baseQtyInCart } from '../../src/lib/presentations.ts';
import { moduleForRoute, resolveEnabledModules } from '../../src/lib/modules.ts';
import { BUSINESS_TYPE_PRESETS } from '../../src/lib/business-types.ts';
import { reportSlugForRoute, REPORT_ITEMS } from '../../src/lib/permissions.ts';

const H = 3_600_000;
const D = 24 * H;
const t0 = new Date('2026-11-01T12:00:00Z');
const at = (h) => new Date(t0.getTime() + h * H);

test('número de caso con ceros', () => {
  assert.equal(caseNumber(7), '#0007');
  assert.equal(caseNumber(12345), '#12345');
});

test('estados abiertos y listos', () => {
  assert.equal(isOpen('in_repair'), true);
  assert.equal(isOpen('delivered'), false);
  assert.equal(isOpen('cancelled'), false);
  assert.equal(isReadyToDeliver('ready'), true);
  assert.equal(isReadyToDeliver('not_repaired'), true);
  assert.equal(isReadyToDeliver('in_repair'), false);
});

test('equipo y días en el taller', () => {
  assert.equal(equipmentLabel({ equipmentBrand: ' Apple ', equipmentModel: 'iPhone 13' }), 'Apple iPhone 13');
  assert.equal(equipmentLabel({}), '');
  assert.equal(daysInShop({ createdAt: t0 }, new Date(t0.getTime() + 3.5 * D)), 3);
  assert.equal(daysInShop({ createdAt: t0, deliveredAt: new Date(t0.getTime() + D) }, new Date(t0.getTime() + 9 * D)), 1);
});

test('atrasado: prometido vencido y todavía en el taller', () => {
  const ahora = at(48);
  assert.equal(isLate({ promisedAt: at(24), status: 'in_repair' }, ahora), true);
  assert.equal(isLate({ promisedAt: at(24), status: 'ready' }, ahora), false, 'listo ya no está atrasado');
  assert.equal(isLate({ promisedAt: at(72), status: 'in_repair' }, ahora), false);
  assert.equal(isLate({ status: 'in_repair' }, ahora), false);
});

test('chequeos por tipo de equipo y obligatorios', () => {
  const items = [
    { id: 'a', label: 'Prende', required: true, requiredQuick: true, position: 1, isActive: true, equipmentTypeId: 'tel' },
    { id: 'b', label: 'Teclas', required: true, requiredQuick: false, position: 0, isActive: true, equipmentTypeId: 'lap' },
    { id: 'c', label: 'Rayones', required: false, requiredQuick: true, position: 0, isActive: true },
    { id: 'd', label: 'Viejo', required: true, requiredQuick: true, position: 2, isActive: false, equipmentTypeId: 'tel' },
  ];
  const tel = checklistFor(items, 'tel');
  assert.deepEqual(tel.map((i) => i.id), ['c', 'a'], 'los de todos + los suyos, activos, en orden');
  assert.equal(missingRequired(tel, {}, false)?.id, 'a');
  assert.equal(missingRequired(tel, {}, true)?.id, 'c', 'en rápida mandan los marcados para rápida');
  assert.equal(missingRequired(tel, { a: { itemId: 'a', label: 'Prende', answer: 'si' } }, false), null);
});

test('teléfono para WhatsApp: los 10 dígitos de RD llevan el 1', () => {
  assert.equal(whatsappPhone('809-548-7587'), '18095487587');
  assert.equal(whatsappPhone('(829) 627 9160'), '18296279160');
  assert.equal(whatsappPhone('+1 809 555 1234'), '18095551234');
  assert.equal(whatsappPhone(undefined), '');
});

test('enlace de seguimiento y mensaje al cliente', () => {
  assert.equal(trackingUrl('Ab3xYz7kQp', 'delmastechnology'), 'https://sellalles.com/delmastechnology/c/Ab3xYz7kQp');
  assert.equal(trackingUrl('Ab3xYz7kQp', ''), 'https://sellalles.com/taller/c/Ab3xYz7kQp');
  const s = { number: 42, status: 'ready', equipmentBrand: 'Samsung', equipmentModel: 'A15', total: 1500, paymentStatus: 'pending', staysInShop: true, isRepair: true };
  const m = mensajeDeEstado(s, 'Pedro Pérez', 'DelmasTechnology', 'https://x/seguimiento?c=1');
  assert.match(m, /^Hola Pedro, te escribimos de DelmasTechnology sobre Samsung A15 \((orden #0042)\): ¡Ya está listo!/);
  assert.match(m, /El total es RD\$1,500\.00\./);
  assert.match(m, /https:\/\/x\/seguimiento\?c=1$/);
  const pagado = mensajeDeEstado({ ...s, paymentStatus: 'paid' }, undefined, 'X');
  assert.doesNotMatch(pagado, /total/);
  assert.match(pagado, /^Hola, /);
});

test('garantía vigente hasta el día que dice, inclusive', () => {
  const hoy = new Date(2026, 10, 19, 15, 0, 0);
  assert.equal(warrantyActive('2026-11-19', hoy), true);
  assert.equal(warrantyActive('2026-11-18', hoy), false);
  assert.equal(warrantyActive(undefined, hoy), false);
});

test('clave de un campo extra', () => {
  assert.equal(fieldKey('Nivel de combustible'), 'nivel_de_combustible');
  assert.equal(fieldKey('Año'), 'ano');
  assert.equal(fieldKey('!!'), 'campo');
});

test('plantillas por rubro: nombres únicos y chequeos', () => {
  for (const r of RUBROS) {
    const nombres = r.equipos.map((e) => e.name);
    assert.equal(new Set(nombres).size, nombres.length, r.key);
    for (const e of r.equipos) {
      assert.ok(e.checklist.length >= 2, `${e.name} necesita al menos dos chequeos`);
      const keys = (e.extraFields ?? []).map((f) => f.key);
      assert.equal(new Set(keys).size, keys.length, `${e.name}: campos repetidos`);
    }
  }
  const por = Object.fromEntries(RUBROS.map((r) => [r.key, r]));
  for (const k of ['mascotas', 'lubricentro', 'salon', 'limpieza']) assert.ok(por[k], k);
  assert.equal(por.salon.equipos.length, 0);
  assert.equal(por.limpieza.equipos.length, 0);
  assert.equal(por.limpieza.aDomicilio, true);
  for (const e of por.mascotas.equipos) {
    assert.equal(e.serialLabel, null);
    assert.equal(e.isRepair, false);
  }
  for (const e of por.lubricentro.equipos) {
    assert.equal(e.isRepair, false);
    assert.equal(e.staysInShop, true);
  }
  for (const e of por.celulares.equipos) assert.deepEqual([e.isRepair, e.staysInShop, e.brandLabel, e.modelLabel], [true, true, 'Marca', 'Modelo']);
});

const SI = { staysInShop: true, isRepair: false };
const NO = { staysInShop: false, isRepair: false };

test('estados según el camino', () => {
  assert.equal(statusLabel('received', NO), 'Llegó');
  assert.equal(statusLabel('delivered', NO), 'Terminado');
  assert.equal(statusLabel('in_repair', { staysInShop: true, isRepair: true }), 'En reparación');
  assert.equal(statusLabel('in_repair', NO), 'En proceso');
  assert.equal(customerText('received', NO), 'Ya te anotamos');
  assert.equal(customerText('delivered', NO), '¡Gracias por visitarnos!');
});

test('estados que se ofrecen a mano', () => {
  assert.deepEqual(manualStatuses(NO), ['received', 'in_repair']);
  assert.deepEqual(manualStatuses(SI), ['received', 'in_repair', 'ready']);
  const full = ['received', 'diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair', 'ready', 'not_repaired'];
  assert.deepEqual(manualStatuses({ staysInShop: true, isRepair: true }), full);
  assert.deepEqual(manualStatuses({ staysInShop: false, isRepair: true }), full.filter((x) => x !== 'ready'));
});

test('cerrar la orden', () => {
  assert.equal(canClose('ready', SI), true);
  assert.equal(canClose('in_repair', SI), false);
  assert.equal(canClose('received', NO), true);
  assert.equal(canClose('in_repair', NO), true);
  for (const c of [SI, NO]) {
    assert.equal(canClose('delivered', c), false);
    assert.equal(canClose('cancelled', c), false);
  }
  assert.equal(closeLabel(SI), 'Entregar');
  assert.equal(closeLabel(NO), 'Terminar');
});

test('sin reparación no salen palabras de taller', () => {
  for (const x of [true, false]) {
    const ctx = { staysInShop: x, isRepair: false };
    for (const st of [...manualStatuses(ctx), 'delivered', 'cancelled']) {
      assert.doesNotMatch(statusLabel(st, ctx), /repar|equipo|técnic|taller/i, `${st} label`);
      assert.doesNotMatch(customerText(st, ctx), /repar|equipo|técnic|taller/i, `${st} texto`);
    }
  }
});

test('campos de la ficha', () => {
  assert.deepEqual(fichaFields({ brandLabel: 'Nombre', modelLabel: 'Raza', serialLabel: null }),
    [{ key: 'brand', label: 'Nombre' }, { key: 'model', label: 'Raza' }]);
  assert.equal(defaultStaysInShop({ staysInShop: true }, true), false);
  assert.equal(defaultStaysInShop({ staysInShop: true }, false), true);
  assert.equal(defaultStaysInShop(undefined, false), false);
  // En la orden: los del tipo, o los tres de siempre si el tipo ya no está.
  assert.deepEqual(camposDeFicha({ brandLabel: 'Nombre', modelLabel: null, serialLabel: 'Placa' }).map((c) => c.label), ['Nombre', 'Placa']);
  assert.deepEqual(camposDeFicha(undefined).map((c) => c.key), ['brand', 'model', 'serial']);
  const orden = { equipmentBrand: 'Max', equipmentModel: 'Poodle', equipmentSerial: undefined };
  assert.equal(valorDeFicha(orden, 'brand'), 'Max');
  assert.equal(valorDeFicha(orden, 'model'), 'Poodle');
  assert.equal(valorDeFicha(orden, 'serial'), undefined);
});

test('mensaje sin ficha', () => {
  const m = mensajeDeEstado({ number: 142, status: 'delivered', total: 0, paymentStatus: 'paid', ...NO }, 'Ana Gómez', 'Salón X');
  assert.match(m, /sobre tu orden #0142/);
  assert.match(m, /¡Gracias por visitarnos!/);
});

test('mensaje a domicilio con la dirección', () => {
  const s = { number: 7, status: 'received', total: 0, paymentStatus: 'pending', ...NO, atCustomer: true, serviceAddress: '  Calle 5 #12, Naco ' };
  const m = mensajeDeEstado(s, 'Ana', 'Limpia RD', 'https://x/c/1');
  assert.match(m, /: Ya te anotamos\. Dirección del servicio: Calle 5 #12, Naco\.\n\n/);
  assert.doesNotMatch(mensajeDeEstado({ ...s, atCustomer: false }, 'Ana', 'Limpia RD'), /Dirección/);
  assert.doesNotMatch(mensajeDeEstado({ ...s, serviceAddress: ' ' }, 'Ana', 'Limpia RD'), /Dirección/);
});

test('orden nueva', () => {
  const base = { ahora: false, clienteEspera: false, atCustomer: false, lineas: [] };

  // Sin ficha, «Atender ahora»: entra en proceso, no se queda y no es reparación.
  const sinFicha = ordenNueva({ ...base, ahora: true, lineas: [{ staffIds: ['p1', 'p2'] }] });
  assert.equal(sinFicha.status, 'in_repair');
  assert.equal(sinFicha.stays_in_shop, false);
  assert.equal(sinFicha.is_repair, false);
  assert.equal(sinFicha.at_customer, false);
  assert.equal(sinFicha.staff_id, 'p1');
  assert.equal(sinFicha.service_address, null);

  // «Lo atiende» gana sobre la primera persona de la primera línea.
  assert.equal(ordenNueva({ ...base, lineas: [{ staffIds: ['p1'] }], responsable: 'p9' }).staff_id, 'p9');

  // Tipo que se queda y de reparación, sin «ahora».
  const rep = { staysInShop: true, isRepair: true };
  const recibido = ordenNueva({ ...base, tipo: rep });
  assert.equal(recibido.status, 'received');
  assert.equal(recibido.stays_in_shop, true);
  assert.equal(recibido.is_repair, true);
  assert.equal(ordenNueva({ ...base, tipo: rep, clienteEspera: true }).stays_in_shop, false, 'el cliente espera');
  assert.equal(ordenNueva({ ...base, tipo: { staysInShop: false, isRepair: false } }).stays_in_shop, false);

  // A domicilio: nunca se queda; la dirección por defecto es la de cobro, después la del cliente.
  const cliente = { address: 'Calle 1', collectionAddress: 'Calle 2' };
  const domicilio = ordenNueva({ ...base, tipo: { staysInShop: true, isRepair: false }, atCustomer: true, cliente });
  assert.equal(domicilio.at_customer, true);
  assert.equal(domicilio.stays_in_shop, false);
  assert.equal(domicilio.service_address, 'Calle 2');
  assert.equal(ordenNueva({ ...base, atCustomer: true, cliente, direccion: ' Calle 3 ' }).service_address, 'Calle 3');
  assert.equal(ordenNueva({ ...base, atCustomer: true, cliente: { address: 'Calle 1' }, direccion: '  ' }).service_address, 'Calle 1');
  assert.equal(ordenNueva({ ...base, atCustomer: true }).service_address, null, 'sin cliente ni dirección');
  assert.equal(ordenNueva({ ...base, cliente, direccion: 'Calle 3' }).service_address, null, 'solo a domicilio lleva dirección');

  // Sin personas: sin responsable.
  assert.equal(ordenNueva({ ...base, lineas: [{ staffIds: [] }] }).staff_id, null);
  assert.equal(ordenNueva(base).staff_id, null);
});

test('POS: las piezas de un caso no cuentan contra el stock', () => {
  const p = { id: 'p1', unit: 'und' };
  const items = [
    { cartItemId: '1', product: p, quantity: 2, serviceItemId: 'si-1' },
    { cartItemId: '2', product: p, quantity: 1 },
  ];
  assert.equal(baseQtyInCart('p1', items), 1);
});

// ---- reporte ----
const ev = (kind, h, toStatus) => ({ id: `${kind}-${h}`, kind, toStatus, visibleToCustomer: false, createdAt: at(h) });
const caso = (over) => ({
  id: 'c1', number: 1, status: 'delivered', createdAt: at(0), laborPrice: 1000, partsTotal: 3000, total: 4000, ...over,
});
const rango = { from: at(-1), to: at(1000) };

test('el cobro que vale es el último sin anular', () => {
  assert.equal(fechaDeCobro([ev('charged', 5)])?.getTime(), at(5).getTime());
  assert.equal(fechaDeCobro([ev('charged', 5), ev('charge_voided', 6)]), undefined);
  assert.equal(fechaDeCobro([ev('charged', 5), ev('charge_voided', 6), ev('charged', 9)])?.getTime(), at(9).getTime());
});

test('resumen del período', () => {
  const casos = [
    caso({ id: 'c1', readyAt: at(48), deliveredAt: at(72), outcome: 'repaired', saleId: 's1', assignedTo: 'u1', assignedName: 'Ana' }),
    caso({ id: 'c2', status: 'in_repair', laborPrice: 0, partsTotal: 0, total: 0, promisedAt: at(10), assignedTo: 'u2', assignedName: 'Luis' }),
    caso({ id: 'c3', status: 'ready', readyAt: at(0.5), total: 500, laborPrice: 500, partsTotal: 0 }),
    caso({ id: 'c4', warrantyOf: 'c1', status: 'received', total: 0, laborPrice: 0, partsTotal: 0 }),
  ];
  const lineas = [
    { id: 'l1', serviceId: 'c1', kind: 'labor', product: { name: 'Cambio de pantalla' }, quantity: 1, price: 1000, cost: 0 },
    { id: 'l2', serviceId: 'c1', kind: 'part', product: { name: 'Pantalla A15' }, quantity: 1, price: 3000, cost: 1800 },
  ];
  const eventos = new Map([
    ['c1', [ev('created', 0, 'received'), ev('status', 24, 'in_repair'), ev('status', 48, 'ready'), ev('charged', 60), ev('status', 72, 'delivered')]],
  ]);
  const r = resumen(casos, lineas, eventos, rango, new Set(['c3']), at(24 * 9));
  assert.equal(r.ingresados, 4);
  assert.equal(r.entregados, 1);
  assert.equal(r.enTaller, 2, 'c2 en reparación y c4 recibido');
  assert.equal(r.listos, 1);
  assert.equal(r.listosViejos, 1, 'c3 lleva más de 7 días listo');
  assert.equal(r.atrasados, 1);
  assert.equal(r.cobrados, 1);
  assert.equal(r.facturado, 4000);
  assert.equal(r.manoDeObra, 1000);
  assert.equal(r.piezasVenta, 3000);
  assert.equal(r.piezasCosto, 1800);
  assert.equal(r.garantias, 1);
  assert.equal(r.rapidas, 1);
  assert.equal(r.tiempoReparacion, (48 * H + 0.5 * H) / 2);

  const tec = porTecnico(casos, eventos, rango, new Map([['c1', { assignedTo: 'u1' }]]));
  const ana = tec.find((f) => f.clave === 'u1');
  assert.equal(ana.terminados, 1);
  assert.equal(ana.manoDeObra, 1000);
  assert.equal(ana.reingresos, 1, 'c4 volvió por garantía de un caso de Ana');
  assert.equal(tec.find((f) => f.clave === 'u2').enCurso, 1);

  const etapas = tiempoPorEstado(eventos, rango);
  assert.deepEqual(etapas.map((e) => [e.estado, e.promedio / H]), [['received', 24], ['in_repair', 24], ['ready', 24]]);

  const piezas = topLineas(lineas, 'part', new Set(['c1']));
  assert.deepEqual(piezas[0], { nombre: 'Pantalla A15', veces: 1, cantidad: 1, venta: 3000, costo: 1800 });
  assert.equal(topLineas(lineas, 'part', new Set()).length, 0, 'solo los casos del período');
  assert.equal(topEquipos([caso({ equipment: 'Samsung A15' }), caso({ id: 'x', equipment: 'Samsung A15' })], rango)[0].veces, 2);
});

test('duración legible', () => {
  assert.equal(duracion(null), '—');
  assert.equal(duracion(10 * 60_000), '1 h');
  assert.equal(duracion(5 * H), '5 h');
  assert.equal(duracion(36 * H), '1.5 días');
  assert.equal(duracion(15 * D), '15 días');
});

test('plantilla: nombres que faltan', () => {
  assert.deepEqual(tiposQueFaltan('mascotas', [' perro ']).map((e) => e.name), ['Gato']);
  assert.equal(tiposQueFaltan('mascotas', ['PERRO', 'gato']).length, 0);
  assert.equal(tiposQueFaltan('nada', []).length, 0);
});

test('Servicios apagado por defecto', () => {
  assert.equal(resolveEnabledModules([]).has('services'), false);
  assert.equal(resolveEnabledModules([{ module_key: 'services', enabled: true }]).has('services'), true);
});

test('rubros de servicios', () => {
  for (const tipo of ['salon', 'mascotas', 'limpieza', 'lubricentro', 'reparaciones']) {
    const preset = BUSINESS_TYPE_PRESETS[tipo];
    assert.ok(preset, tipo);
    assert.ok(preset.modules.includes('services'), tipo);
    assert.ok(RUBROS.some((r) => r.key === preset.tallerRubro), `${tipo}: rubro ${preset.tallerRubro}`);
  }
});

test('el rubro de mascotas es peluquería, sin lo clínico', () => {
  assert.equal(BUSINESS_TYPE_PRESETS.mascotas.label, 'Peluquería de mascotas');
  assert.doesNotMatch(BUSINESS_TYPE_PRESETS.mascotas.label, /veterinari/i);
});

test('la ruta del reporte nuevo', () => {
  assert.equal(moduleForRoute('/reports/servicios'), 'services');
});

test('el reporte de servicios conserva el slug de permiso taller', () => {
  assert.equal(reportSlugForRoute('/reports/servicios'), 'taller');
  assert.equal(reportSlugForRoute('/reports/inventory'), 'inventory');
  assert.ok(REPORT_ITEMS.some((r) => r.slug === 'taller'));
});
