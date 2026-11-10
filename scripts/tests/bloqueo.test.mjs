// Pruebas del modo "solo facturación": cuándo entra una empresa, qué rutas
// quedan abiertas y qué escrituras deja pasar el cliente de Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  motivoDeBloqueo,
  rutaPermitidaEnBloqueo,
  escrituraBloqueada,
  rpcBloqueada,
  MENSAJE_BLOQUEO,
} from '../../src/lib/bloqueo.ts';

const AHORA = Date.parse('2026-11-10T15:00:00Z');
const AYER = '2026-11-09T15:00:00Z';
const MANANA = '2026-11-11T15:00:00Z';

test('la prueba vencida bloquea por prueba_vencida', () => {
  assert.equal(motivoDeBloqueo({ esSuperAdmin: false, estado: 'trial', finPrueba: AYER, soloVentas: false, ahora: AHORA }), 'prueba_vencida');
});

test('la prueba vigente no bloquea', () => {
  assert.equal(motivoDeBloqueo({ esSuperAdmin: false, estado: 'trial', finPrueba: MANANA, soloVentas: false, ahora: AHORA }), null);
});

test('una prueba sin fecha de fin no bloquea', () => {
  assert.equal(motivoDeBloqueo({ esSuperAdmin: false, estado: 'trial', finPrueba: null, soloVentas: false, ahora: AHORA }), null);
});

test('solo ventas bloquea por cuotas', () => {
  assert.equal(motivoDeBloqueo({ esSuperAdmin: false, estado: 'active', finPrueba: AYER, soloVentas: true, ahora: AHORA }), 'cuotas');
});

test('una empresa activa con la fecha de prueba vieja no bloquea', () => {
  assert.equal(motivoDeBloqueo({ esSuperAdmin: false, estado: 'active', finPrueba: AYER, soloVentas: false, ahora: AHORA }), null);
});

test('si coinciden, manda la prueba vencida', () => {
  assert.equal(motivoDeBloqueo({ esSuperAdmin: false, estado: 'trial', finPrueba: AYER, soloVentas: true, ahora: AHORA }), 'prueba_vencida');
});

test('el super admin nunca queda bloqueado', () => {
  assert.equal(motivoDeBloqueo({ esSuperAdmin: true, estado: 'trial', finPrueba: AYER, soloVentas: true, ahora: AHORA }), null);
});

test('rutas abiertas: facturar, historial, caja y suscripción', () => {
  for (const ruta of ['/pos', '/sales', '/sales/detail', '/caja', '/caja/historial', '/suscripcion']) {
    assert.equal(rutaPermitidaEnBloqueo(ruta), true, ruta);
  }
});

test('rutas cerradas: todo lo demás', () => {
  for (const ruta of ['/dashboard', '/quotes', '/services', '/credit', '/inventory', '/reports/sales-summary', '/settings', '/users', '/expenses', '/salesman', '/posx']) {
    assert.equal(rutaPermitidaEnBloqueo(ruta), false, ruta);
  }
});

test('sin bloqueo no se frena ninguna escritura', () => {
  assert.equal(escrituraBloqueada(null, 'products', 'update'), null);
  assert.equal(rpcBloqueada(null, 'annul_sale'), null);
});

test('en bloqueo se puede crear y editar el cliente de la venta', () => {
  assert.equal(escrituraBloqueada('prueba_vencida', 'customers', 'insert'), null);
  assert.equal(escrituraBloqueada('cuotas', 'customers', 'update'), null);
});

test('en bloqueo no se toca inventario ni se borran clientes', () => {
  assert.equal(escrituraBloqueada('prueba_vencida', 'products', 'update'), MENSAJE_BLOQUEO.prueba_vencida);
  assert.equal(escrituraBloqueada('cuotas', 'customers', 'delete'), MENSAJE_BLOQUEO.cuotas);
});

test('en bloqueo se puede vender, cobrar, usar la caja y pagar la suscripción', () => {
  for (const fn of ['create_sale_with_items', 'register_sale_payment', 'open_caja_session', 'close_caja_session', 'reportar_pago_de_suscripcion', 'mi_cuenta_de_suscripcion']) {
    assert.equal(rpcBloqueada('prueba_vencida', fn), null, fn);
    assert.equal(rpcBloqueada('cuotas', fn), null, fn);
  }
});

test('en bloqueo el checkout puede leer el NCF y el e-CF, y reintentar el envío', () => {
  for (const fn of ['ecf_activa', 'ncf_b_vigente', 'ecf_reintentar', 'reemitir_ecf']) {
    assert.equal(rpcBloqueada('prueba_vencida', fn), null, fn);
    assert.equal(rpcBloqueada('cuotas', fn), null, fn);
  }
});

test('en bloqueo no se anula ni se hacen otras operaciones', () => {
  assert.equal(rpcBloqueada('prueba_vencida', 'annul_sale'), MENSAJE_BLOQUEO.prueba_vencida);
  assert.equal(rpcBloqueada('cuotas', 'transfer_products'), MENSAJE_BLOQUEO.cuotas);
});

test('cada motivo tiene su mensaje', () => {
  assert.match(MENSAJE_BLOQUEO.prueba_vencida, /período de prueba ha finalizado/);
  assert.match(MENSAJE_BLOQUEO.cuotas, /pagos pendientes/);
});
