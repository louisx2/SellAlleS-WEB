// Pruebas de la lógica de RNC de la app (src/lib/rnc.ts): la copia del dígito
// verificador (la app no puede importar supabase/), el llenado en cascada del
// cliente, la búsqueda de un cliente por su documento y cuándo una respuesta de la
// DGII ya no corresponde al campo. Node quita los tipos: rnc.ts solo puede tener
// `import type`.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  digitosDeDocumento,
  documentoValido,
  cascadaCliente,
  buscarClientePorDocumento,
  respuestaVigente,
} from '../../src/lib/rnc.ts';
import { documentoValido as documentoValidoServidor } from '../../supabase/functions/_shared/dgii/rnc.ts';

const DATOS = {
  rnc: '130862346',
  razonSocial: 'IT SOLUCLICK SRL',
  nombreComercial: 'IT SOLUCLICK',
  categoria: '',
  regimenPagos: 'NORMAL',
  estado: 'ACTIVO',
  actividadEconomica: 'DISEÑO Y DESARROLLO DE SOFTWARE',
  administracionLocal: 'ADM LOCAL ABRAHAM LINCOLN',
  facturadorElectronico: true,
};

test('el dígito verificador de la app da lo mismo que el del servidor', () => {
  const casos = [
    '130862346', '132893662', '199999991', '101000007', '40212345678', '00112345673',
    '130862347', '40212345679', '12345678', '1234567890', '', '00100000009',
  ];
  for (const d of casos) assert.equal(documentoValido(d), documentoValidoServidor(d), d);
  assert.equal(digitosDeDocumento('402-1234567-8'), '40212345678');
});

test('cascadaCliente: con el nombre vacío y un RNC activo llena el nombre y pasa a crédito fiscal', () => {
  assert.deepEqual(cascadaCliente(DATOS, { nombre: '', ncfType: 'consumer' }), {
    nombre: 'IT SOLUCLICK SRL',
    ncfType: 'fiscal',
  });
  assert.deepEqual(cascadaCliente(DATOS, { nombre: '   ', ncfType: 'consumer' }).nombre, 'IT SOLUCLICK SRL');
});

test('cascadaCliente: con un nombre ya escrito no lo pisa, solo lo ofrece', () => {
  const r = cascadaCliente(DATOS, { nombre: 'Juan', ncfType: 'fiscal' });
  assert.equal(r.nombre, undefined);
  assert.equal(r.ofrecerNombre, 'IT SOLUCLICK SRL');
});

test('cascadaCliente: si el nombre ya es el de la DGII no ofrece nada', () => {
  assert.deepEqual(cascadaCliente(DATOS, { nombre: 'it soluclick srl ', ncfType: 'fiscal' }), {});
});

test('cascadaCliente: el tipo NCF solo cambia con un RNC activo que estaba en consumidor final', () => {
  const cedula = { ...DATOS, rnc: '40212345678' };
  assert.equal(cascadaCliente(cedula, { nombre: '', ncfType: 'consumer' }).ncfType, undefined, 'cédula');
  const suspendido = { ...DATOS, estado: 'SUSPENDIDO' };
  assert.equal(cascadaCliente(suspendido, { nombre: '', ncfType: 'consumer' }).ncfType, undefined, 'suspendido');
  assert.equal(cascadaCliente(DATOS, { nombre: '', ncfType: 'gubernamental' }).ncfType, undefined, 'gubernamental');
});

test('buscarClientePorDocumento compara por dígitos, con o sin guiones', () => {
  const clientes = [
    { id: 'a', rnc: '' },
    { id: 'b', rnc: null },
    { id: 'c', rnc: '130-86234-6' },
    { id: 'd', rnc: '402-1234567-8' },
  ];
  assert.equal(buscarClientePorDocumento(clientes, '130862346')?.id, 'c');
  assert.equal(buscarClientePorDocumento(clientes, '402-1234567-8')?.id, 'd');
  assert.equal(buscarClientePorDocumento(clientes, '132893662'), undefined);
  assert.equal(buscarClientePorDocumento(clientes, ''), undefined, 'un documento vacío no empareja con clientes sin RNC');
});

test('respuestaVigente: la respuesta solo vale si el campo sigue teniendo ese documento', () => {
  assert.equal(respuestaVigente('130862346', '130-86234-6'), true);
  assert.equal(respuestaVigente('130862346', '13086234'), false);
  assert.equal(respuestaVigente('130862346', '132893662'), false);
  assert.equal(respuestaVigente('130862346', ''), false);
});
