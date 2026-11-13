// Pruebas de los datos del cliente que salen en la factura cuando la empresa lo
// configuró y el cajero marcó la casilla (caso del chofer que entrega).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMPOS_CLIENTE,
  normalizarCamposCliente,
  lineasDatosCliente,
  puedeIncluirDatosCliente,
} from '../../src/lib/datos-cliente.ts';

test('los campos se ofrecen en orden: dirección, teléfono, correo', () => {
  assert.deepEqual(CAMPOS_CLIENTE.map((c) => c.campo), ['address', 'phone', 'email']);
  assert.deepEqual(CAMPOS_CLIENTE.map((c) => c.etiqueta), ['Dirección', 'Teléfono', 'Correo']);
});

test('normalizar quita inválidos y repetidos y respeta el orden de la factura', () => {
  assert.deepEqual(normalizarCamposCliente(['email', 'address', 'x', 'address']), ['address', 'email']);
});

test('normalizar algo que no es lista da lista vacía', () => {
  assert.deepEqual(normalizarCamposCliente(null), []);
  assert.deepEqual(normalizarCamposCliente('address'), []);
});

test('las líneas llevan solo los datos que el cliente tiene, sin espacios de sobra', () => {
  assert.deepEqual(
    lineasDatosCliente({ address: ' Calle 1 ', phone: '', email: 'a@b.do' }, ['address', 'phone', 'email']),
    [
      { etiqueta: 'Dirección', valor: 'Calle 1' },
      { etiqueta: 'Correo', valor: 'a@b.do' },
    ],
  );
});

test('las líneas siguen el orden de la factura aunque la config venga en otro', () => {
  assert.deepEqual(
    lineasDatosCliente({ address: 'Calle 1', phone: '809' }, ['phone', 'address']).map((l) => l.etiqueta),
    ['Dirección', 'Teléfono'],
  );
});

test('sin cliente no hay líneas', () => {
  assert.deepEqual(lineasDatosCliente(undefined, ['address']), []);
});

test('un dato no elegido no sale aunque el cliente lo tenga', () => {
  assert.deepEqual(lineasDatosCliente({ address: 'Calle 1', phone: '809' }, ['phone']), [
    { etiqueta: 'Teléfono', valor: '809' },
  ]);
});

test('la casilla solo aparece con la config encendida y algún dato que imprimir', () => {
  assert.equal(puedeIncluirDatosCliente(false, ['address'], { address: 'x' }), false);
  assert.equal(puedeIncluirDatosCliente(true, ['phone'], { address: 'x' }), false);
  assert.equal(puedeIncluirDatosCliente(true, ['address'], { address: 'x' }), true);
  assert.equal(puedeIncluirDatosCliente(true, ['address'], undefined), false);
});
