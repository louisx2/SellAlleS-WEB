// Pruebas de la lógica pura del Taller: estados, chequeos, garantía, mensaje al
// cliente y los cálculos del reporte. `npm test` corre `node --test`, y Node quita
// los tipos de los .ts al importarlos (por eso solo tienen `import type`).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  caseNumber, checklistFor, daysInShop, equipmentLabel, isLate, isOpen, isReadyToDeliver,
  mensajeDeEstado, missingRequired, trackingUrl, warrantyActive, whatsappPhone, fieldKey, RUBROS,
} from '../../src/lib/taller.ts';
import {
  duracion, fechaDeCobro, porTecnico, resumen, tiempoPorEstado, topEquipos, topLineas,
} from '../../src/lib/taller-reportes.ts';
import { baseQtyInCart } from '../../src/lib/presentations.ts';

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
  assert.equal(trackingUrl('Ab3x', 'https://app.sellalles.com/'), 'https://app.sellalles.com/seguimiento?c=Ab3x');
  const s = { number: 42, status: 'ready', equipmentBrand: 'Samsung', equipmentModel: 'A15', total: 1500, paymentStatus: 'pending' };
  const m = mensajeDeEstado(s, 'Pedro Pérez', 'DelmasTechnology', 'https://x/seguimiento?c=1');
  assert.match(m, /^Hola Pedro, te escribimos de DelmasTechnology sobre Samsung A15 \(caso #0042\): ¡Ya está listo!/);
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
