// Pruebas de qué documento de una venta se comparte (factura, plan de pagos o
// estado del financiamiento): ruta en Storage, nombre de descarga y textos del
// correo. Las usan las Edge Functions receipt-link y send-sale-receipt.
// Lo esencial: la factura queda EXACTAMENTE como antes, para que el front viejo
// y los enlaces ya enviados no cambien.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  documentoValido,
  rutaDelDocumento,
  nombreDeDescarga,
  asuntoDelCorreo,
  tituloDelCorreo,
  adjuntoDelCorreo,
} from '../../supabase/functions/_shared/documentos.ts';

test('sin documento o con uno desconocido es la factura', () => {
  assert.equal(documentoValido(undefined), 'factura');
  assert.equal(documentoValido('otro'), 'factura');
  assert.equal(documentoValido('plan'), 'plan');
  assert.equal(documentoValido('estado'), 'estado');
});

test('la factura conserva su ruta; plan y estado tienen la suya', () => {
  assert.equal(rutaDelDocumento('emp', 'vta', 'factura'), 'emp/vta.pdf');
  assert.equal(rutaDelDocumento('emp', 'vta', 'plan'), 'emp/vta-plan.pdf');
  assert.equal(rutaDelDocumento('emp', 'vta', 'estado'), 'emp/vta-estado.pdf');
});

test('nombre de descarga: la factura como antes, con o sin NCF', () => {
  assert.equal(nombreDeDescarga('factura', 'B0200000012'), 'comprobante-B0200000012.pdf');
  assert.equal(nombreDeDescarga('factura', null), 'comprobante.pdf');
  assert.equal(nombreDeDescarga('plan', 'B0200000012'), 'plan-de-pagos.pdf');
  assert.equal(nombreDeDescarga('estado'), 'estado-de-financiamiento.pdf');
});

test('asunto del correo: la factura como antes', () => {
  assert.equal(asuntoDelCorreo('factura', 'Comercial GP', 'B0200000012'), 'Comprobante de Compra NCF B0200000012 - Comercial GP');
  assert.equal(asuntoDelCorreo('factura', 'Comercial GP', null), 'Comprobante de Compra - Comercial GP');
  assert.equal(asuntoDelCorreo('plan', 'Comercial GP', 'B0200000012'), 'Plan de Pagos - Comercial GP');
  assert.equal(asuntoDelCorreo('estado', 'Comercial GP'), 'Estado de su Financiamiento - Comercial GP');
});

test('título y adjunto del correo según el documento', () => {
  assert.equal(tituloDelCorreo('factura'), 'Comprobante de Compra');
  assert.equal(tituloDelCorreo('plan'), 'Plan de Pagos');
  assert.equal(tituloDelCorreo('estado'), 'Estado de su Financiamiento');
  assert.equal(adjuntoDelCorreo('factura'), 'su factura en formato PDF');
  assert.equal(adjuntoDelCorreo('plan'), 'su plan de pagos en formato PDF');
  assert.equal(adjuntoDelCorreo('estado'), 'el estado de su financiamiento en formato PDF');
});
