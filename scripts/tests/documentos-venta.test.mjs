// Pruebas de los nombres de archivo y los mensajes de WhatsApp de cada
// documento de una venta (factura, plan de pagos, estado del financiamiento).
// La factura debe quedar exactamente como estaba.
import test from 'node:test';
import assert from 'node:assert/strict';

import { nombreArchivoPdf, mensajeWhatsApp } from '../../src/lib/documentos-venta.ts';

const venta = { id: 'abcdef12-3456-7890-abcd-ef1234567890', ncf: 'B0200000012' };
const sinNcf = { id: 'abcdef12-3456-7890-abcd-ef1234567890' };
const URL = 'https://sellalles.com/gp/c/7Kq2Wp9a';

test('archivo de la factura como siempre: con NCF o con el id corto', () => {
  assert.equal(nombreArchivoPdf('factura', venta), 'factura_B0200000012.pdf');
  assert.equal(nombreArchivoPdf('factura', sinNcf), 'factura_abcdef12.pdf');
});

test('archivo del plan y del estado con el id corto de la venta', () => {
  assert.equal(nombreArchivoPdf('plan', venta), 'plan_de_pagos_abcdef12.pdf');
  assert.equal(nombreArchivoPdf('estado', venta), 'estado_financiamiento_abcdef12.pdf');
});

test('el mensaje de la factura no cambia', () => {
  assert.equal(
    mensajeWhatsApp('factura', URL, 15, 'Comercial GP'),
    '¡Gracias por su compra en Comercial GP!\n\n' +
      `Aquí puede descargar su comprobante en PDF:\n${URL}\n\n` +
      'El enlace estará disponible por 15 días.',
  );
});

test('sin nombre de negocio la factura dice "nuestro negocio"', () => {
  assert.match(mensajeWhatsApp('factura', URL, 15), /nuestro negocio/);
});

test('el plan y el estado dicen qué son y llevan el enlace y los días', () => {
  const plan = mensajeWhatsApp('plan', URL, 15, 'Comercial GP');
  const estado = mensajeWhatsApp('estado', URL, 15, 'Comercial GP');
  assert.match(plan, /plan de pagos/);
  assert.match(estado, /estado de su financiamiento/);
  for (const m of [plan, estado]) {
    assert.ok(m.includes(URL));
    assert.match(m, /15 días/);
    assert.match(m, /Comercial GP/);
  }
});

// Revisión final: si el servidor todavía es el viejo, devuelve la ruta de la
// factura también para el plan. El navegador debe frenar ANTES de subir, para
// no pisar el PDF (ni el enlace) de la factura que el cliente ya tiene.
import { rutaCorrespondeAlDocumento } from '../../src/lib/documentos-venta.ts';

test('el plan con la ruta de la factura se rechaza (servidor viejo)', () => {
  assert.equal(rutaCorrespondeAlDocumento('emp/vta.pdf', 'plan'), false);
  assert.equal(rutaCorrespondeAlDocumento('emp/vta.pdf', 'estado'), false);
});

test('cada documento acepta su propia ruta', () => {
  assert.equal(rutaCorrespondeAlDocumento('emp/vta-plan.pdf', 'plan'), true);
  assert.equal(rutaCorrespondeAlDocumento('emp/vta-estado.pdf', 'estado'), true);
  assert.equal(rutaCorrespondeAlDocumento('emp/vta.pdf', 'factura'), true);
});
