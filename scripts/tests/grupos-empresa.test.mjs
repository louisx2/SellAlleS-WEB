// Pruebas del panel de Empresas: a qué grupo va cada empresa, en qué orden, y
// hasta qué cuota dura un precio especial al activarla.
import test from 'node:test';
import assert from 'node:assert/strict';

import { grupoDeEmpresa, compararEnGrupo, GRUPOS_EMPRESA } from '../../src/lib/grupos-empresa.ts';
import { finPrecioEspecial, sumarMeses } from '../../src/lib/subscription-status.ts';

const AHORA = Date.parse('2026-11-23T15:00:00Z');

test('las activas salen primero, luego las pruebas y al final las suspendidas', () => {
  assert.deepEqual(GRUPOS_EMPRESA.map((g) => g.key), ['activas', 'prueba_vencida', 'prueba', 'suspendidas']);
});

test('una empresa en prueba con la fecha pasada es prueba vencida', () => {
  assert.equal(grupoDeEmpresa({ status: 'trial', trialEndsAt: '2026-09-01T03:59:59Z' }, AHORA), 'prueba_vencida');
});

test('una empresa en prueba con la fecha por delante sigue en prueba', () => {
  assert.equal(grupoDeEmpresa({ status: 'trial', trialEndsAt: '2026-11-28T03:59:59Z' }, AHORA), 'prueba');
});

test('una prueba sin fecha de fin no vence', () => {
  assert.equal(grupoDeEmpresa({ status: 'trial', trialEndsAt: null }, AHORA), 'prueba');
});

test('activa y suspendida van a su grupo aunque la fecha de prueba haya pasado', () => {
  assert.equal(grupoDeEmpresa({ status: 'active', trialEndsAt: '2026-09-01T03:59:59Z' }, AHORA), 'activas');
  assert.equal(grupoDeEmpresa({ status: 'suspended', trialEndsAt: '2026-09-01T03:59:59Z' }, AHORA), 'suspendidas');
});

const ordenar = (grupo, filas) => [...filas].sort((a, b) => compararEnGrupo(grupo, a, b)).map((f) => f.nombre);

test('prueba vencida: la que venció hace menos va primero', () => {
  assert.deepEqual(ordenar('prueba_vencida', [
    { nombre: 'Vieja', trialEndsAt: '2026-08-03T03:59:59Z' },
    { nombre: 'Reciente', trialEndsAt: '2026-11-13T03:59:59Z' },
  ]), ['Reciente', 'Vieja']);
});

test('en prueba: la que termina antes va primero y la que no tiene fecha al final', () => {
  assert.deepEqual(ordenar('prueba', [
    { nombre: 'Sin fecha', trialEndsAt: null },
    { nombre: 'Tarde', trialEndsAt: '2026-12-20T03:59:59Z' },
    { nombre: 'Pronto', trialEndsAt: '2026-11-28T03:59:59Z' },
  ]), ['Pronto', 'Tarde', 'Sin fecha']);
});

test('activas: primero las que deben y luego por nombre', () => {
  assert.deepEqual(ordenar('activas', [
    { nombre: 'Beta', ordenCobro: 5 },
    { nombre: 'Alfa', ordenCobro: 5 },
    { nombre: 'Morosa', ordenCobro: 0 },
  ]), ['Morosa', 'Alfa', 'Beta']);
});

test('suspendidas: la más reciente primero', () => {
  assert.deepEqual(ordenar('suspendidas', [
    { nombre: 'Antes', suspendedAt: '2026-10-01T12:00:00Z' },
    { nombre: 'Ayer', suspendedAt: '2026-11-22T12:00:00Z' },
  ]), ['Ayer', 'Antes']);
});

test('POPI: tres cuotas de descuento desde el 23-dic terminan en la del 23-feb', () => {
  assert.equal(finPrecioEspecial('2026-12-23', 3, 'monthly'), '2027-02-23');
});

test('una sola cuota de descuento termina en la primera', () => {
  assert.equal(finPrecioEspecial('2026-12-23', 1, 'monthly'), '2026-12-23');
});

test('en anual, dos cuotas de descuento cubren dos años', () => {
  assert.equal(finPrecioEspecial('2026-12-23', 2, 'annual'), '2027-12-23');
});

test('el fin del descuento no se corre en los meses cortos', () => {
  assert.equal(finPrecioEspecial('2027-01-31', 2, 'monthly'), '2027-02-28');
  assert.equal(sumarMeses('2026-11-23', 1), '2026-12-23');
});
