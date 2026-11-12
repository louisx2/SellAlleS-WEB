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
  cascadaNombre,
  buscarClientePorDocumento,
  respuestaVigente,
  respuestaAplicable,
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

// ---------------------------------------------------------------------------
// Revisión final: cascada sin efectos sorpresa
// ---------------------------------------------------------------------------

test('cascadaCliente: al abrir Editar cliente con su mismo RNC guardado no cambia el tipo NCF', () => {
  const r = cascadaCliente(DATOS, { nombre: 'IT SOLUCLICK SRL', ncfType: 'consumer', rncGuardado: '130-86234-6' });
  assert.equal(r.ncfType, undefined);
  // Si el usuario escribe otro RNC distinto del guardado, la cascada sí aplica.
  const otro = cascadaCliente(DATOS, { nombre: '', ncfType: 'consumer', rncGuardado: '132893662' });
  assert.equal(otro.ncfType, 'fiscal');
});

test('cascadaNombre: un nombre que se llenó solo se reemplaza al corregir el RNC; uno escrito a mano, no', () => {
  // El nombre actual es el que puso la DGII con el RNC anterior: se cambia.
  assert.deepEqual(cascadaNombre('EMPRESA B SRL', 'EMPRESA A SRL', 'EMPRESA A SRL'), { nombre: 'EMPRESA B SRL' });
  assert.deepEqual(cascadaNombre('EMPRESA B SRL', 'empresa a srl ', 'EMPRESA A SRL'), { nombre: 'EMPRESA B SRL' });
  // Lo escribió el usuario: solo se ofrece.
  assert.deepEqual(cascadaNombre('EMPRESA B SRL', 'Juan', 'EMPRESA A SRL'), { ofrecerNombre: 'EMPRESA B SRL' });
  assert.deepEqual(cascadaNombre('EMPRESA B SRL', 'Juan', undefined), { ofrecerNombre: 'EMPRESA B SRL' });
  // Vacío: se llena. Igual: nada. Sin razón social: nada.
  assert.deepEqual(cascadaNombre('EMPRESA B SRL', '', undefined), { nombre: 'EMPRESA B SRL' });
  assert.deepEqual(cascadaNombre('EMPRESA B SRL', 'Empresa B SRL', 'EMPRESA A SRL'), {});
  assert.deepEqual(cascadaNombre('  ', 'Juan', undefined), {});
});

test('cascadaCliente usa la misma regla del nombre llenado solo', () => {
  const r = cascadaCliente(DATOS, { nombre: 'EMPRESA A SRL', ncfType: 'fiscal', nombreAutomatico: 'EMPRESA A SRL' });
  assert.equal(r.nombre, 'IT SOLUCLICK SRL');
  assert.equal(r.ofrecerNombre, undefined);
});

test('respuestaAplicable: con el campo desmontado (diálogo cerrado) la respuesta no se aplica', () => {
  assert.equal(respuestaAplicable(false, '130862346', '130862346'), false);
  assert.equal(respuestaAplicable(true, '130862346', '130-86234-6'), true);
  assert.equal(respuestaAplicable(true, '130862346', '132893662'), false);
});
