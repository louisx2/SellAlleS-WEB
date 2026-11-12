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
  accionDeCampo,
  esDocumentoExtranjero,
  faltanDatosCliente,
  destinoDelComprador,
  nombresParecidos,
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

// ---------------------------------------------------------------------------
// Menores de la revisión final
// ---------------------------------------------------------------------------

test('accionDeCampo: qué hace el campo con cada valor', () => {
  // Incompleto o vacío: se limpia la línea de estado (no queda el resultado anterior).
  assert.equal(accionDeCampo('', ''), 'limpiar');
  assert.equal(accionDeCampo('13086234', '130862346'), 'limpiar');
  // Completo pero con el verificador malo.
  assert.equal(accionDeCampo('130862347', ''), 'invalido');
  // El mismo documento que ya se consultó: se deja como está.
  assert.equal(accionDeCampo('130862346', '130862346'), 'mantener');
  // Otro documento completo: se consulta (y la línea vieja se limpia ya, sin esperar).
  assert.equal(accionDeCampo('132893662', '130862346'), 'consultar');
  assert.equal(accionDeCampo('130862346', ''), 'consultar');
});

test('esDocumentoExtranjero: con letras o más de 11 dígitos no se le da formato de RNC', () => {
  assert.equal(esDocumentoExtranjero('EIN 12-3456789'), true);
  assert.equal(esDocumentoExtranjero('91350100MA2XYZ'), true);
  assert.equal(esDocumentoExtranjero('123456789012'), true);
  assert.equal(esDocumentoExtranjero('130-86234-6'), false);
  assert.equal(esDocumentoExtranjero('402-1234567-8'), false);
  assert.equal(esDocumentoExtranjero(''), false);
});

test('faltanDatosCliente: el teléfono solo es obligatorio si no hay RNC o cédula', () => {
  assert.equal(faltanDatosCliente('', '809-555-1234', ''), 'nombre');
  assert.equal(faltanDatosCliente('Juan', '', ''), 'telefono');
  assert.equal(faltanDatosCliente('Juan', '', '1234'), 'telefono', 'un documento incompleto no cuenta');
  assert.equal(faltanDatosCliente('IT SOLUCLICK SRL', '', '130-86234-6'), null);
  assert.equal(faltanDatosCliente('Juan', '', '402-1234567-8'), null);
  assert.equal(faltanDatosCliente('Juan', '809-555-1234', ''), null);
});

test('destinoDelComprador: con el documento de un cliente que ya existe, se usa ese', () => {
  assert.equal(destinoDelComprador({ id: 'a' }, { id: 'juan' }), 'existente');
  assert.equal(destinoDelComprador({ id: 'a' }, undefined), 'existente');
});

test('destinoDelComprador: con un cliente real sin RNC en el carrito, el cajero elige', () => {
  assert.equal(destinoDelComprador(undefined, { id: 'juan' }), 'elegir');
});

test('destinoDelComprador: sin cliente en el carrito (consumidor final), se crea', () => {
  assert.equal(destinoDelComprador(undefined, undefined), 'crear');
});

test('nombresParecidos: comparte una palabra, sin tildes ni mayúsculas', () => {
  assert.equal(nombresParecidos('Juan Pérez', 'JUAN ANTONIO PEREZ GOMEZ'), true);
  assert.equal(nombresParecidos('Pujols Group EIRL', 'D ELIAS & PUJOLS TIENDA DE COMUNICACIONES EIRL'), true);
});

test('nombresParecidos: nada en común avisa', () => {
  assert.equal(nombresParecidos('Juan Pérez', 'FERRETERIA XYZ SRL'), false);
});

test('nombresParecidos: SRL, EIRL, "del" y palabras cortas no cuentan como parecido', () => {
  assert.equal(nombresParecidos('Inversiones del Este SRL', 'CONSTRUCTORA DEL NORTE SRL'), false);
});

test('nombresParecidos: sin palabras que comparar no avisa', () => {
  assert.equal(nombresParecidos('JP', 'FERRETERIA XYZ SRL'), true);
  assert.equal(nombresParecidos('', 'FERRETERIA XYZ SRL'), true);
  assert.equal(nombresParecidos('Juan Pérez', ''), true);
});
