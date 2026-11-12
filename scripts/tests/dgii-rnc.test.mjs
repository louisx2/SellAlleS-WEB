// Pruebas de la lectura de la consulta de RNC de la DGII
// (supabase/functions/_shared/dgii/rnc.ts). Nunca se llama a la DGII: las
// respuestas son reales, guardadas el 11-nov-2026 en fixtures/dgii/
// (formulario.html es el GET; encontrado.txt, el POST con el RNC 130862346 de IT
// SOLUCLICK SRL; no-encontrado.txt, el POST con 199999991, que cumple el dígito
// verificador pero no existe). Si la DGII cambia su página, estas pruebas siguen
// pasando con lo guardado: hay que volver a capturar las respuestas para notarlo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  digitosDeDocumento,
  documentoValido,
  camposDelFormulario,
  cuerpoDeConsulta,
  leerRespuesta,
  consultarDgii,
  ErrorDgii,
} from '../../supabase/functions/_shared/dgii/rnc.ts';

const leer = (nombre) => readFileSync(new URL(`./fixtures/dgii/${nombre}`, import.meta.url), 'utf8');
const FORMULARIO = leer('formulario.html');
const ENCONTRADO = leer('encontrado.txt');
const NO_ENCONTRADO = leer('no-encontrado.txt');

// ---------------------------------------------------------------------------
// Dígito verificador
// ---------------------------------------------------------------------------

test('documentoValido: RNC con su verificador y cédulas que pasan Luhn', () => {
  for (const d of ['130862346', '132893662', '199999991', '40212345678', '00112345673']) {
    assert.equal(documentoValido(d), true, d);
  }
});

test('documentoValido: verificador equivocado o largo que no es de RNC ni de cédula', () => {
  for (const d of ['130862347', '132893661', '40212345679', '12345678', '1234567890', '', '13086234a']) {
    assert.equal(documentoValido(d), false, d);
  }
});

test('digitosDeDocumento deja solo los dígitos', () => {
  assert.equal(digitosDeDocumento('130-86234-6'), '130862346');
  assert.equal(digitosDeDocumento(' 402-1234567-8 '), '40212345678');
  assert.equal(digitosDeDocumento(''), '');
});

// ---------------------------------------------------------------------------
// Formulario y cuerpo del POST
// ---------------------------------------------------------------------------

test('camposDelFormulario saca los tres campos ocultos de ASP.NET', () => {
  const c = camposDelFormulario(FORMULARIO);
  assert.ok(c.viewState.length > 50, 'viewState');
  assert.ok(c.viewStateGenerator.length > 0, 'viewStateGenerator');
  assert.ok(c.eventValidation.length > 50, 'eventValidation');
});

test('camposDelFormulario lanza ErrorDgii si la página no trae los campos', () => {
  assert.throws(() => camposDelFormulario('<html></html>'), ErrorDgii);
});

test('cuerpoDeConsulta lleva la pestaña activa (sin ella la DGII da error) y el documento', () => {
  const b = cuerpoDeConsulta('130862346', camposDelFormulario(FORMULARIO));
  assert.equal(b.get('ctl00$cphMain$hidActiveTab'), 'rnc');
  assert.equal(b.get('ctl00$cphMain$txtRNCCedula'), '130862346');
  assert.equal(b.get('ctl00$cphMain$txtRazonSocial'), '');
  assert.equal(b.get('ctl00$smMain'), 'ctl00$cphMain$upBusqueda|ctl00$cphMain$btnBuscarPorRNC');
  assert.equal(b.get('ctl00$cphMain$btnBuscarPorRNC'), 'BUSCAR');
  assert.equal(b.get('__ASYNCPOST'), 'true');
  assert.ok(b.get('__VIEWSTATE'));
});

// ---------------------------------------------------------------------------
// Lectura de la respuesta
// ---------------------------------------------------------------------------

test('leerRespuesta: la ficha de IT SOLUCLICK, con las entidades decodificadas', () => {
  const r = leerRespuesta(ENCONTRADO);
  assert.equal(r.encontrado, true);
  assert.deepEqual(r.datos, {
    rnc: '130862346',
    razonSocial: 'IT SOLUCLICK SRL',
    nombreComercial: 'IT SOLUCLICK',
    categoria: '',
    regimenPagos: 'NORMAL',
    estado: 'ACTIVO',
    actividadEconomica: 'DISEÑO Y DESARROLLO DE SOFTWARE',
    administracionLocal: 'ADM LOCAL ABRAHAM LINCOLN',
    facturadorElectronico: true,
  });
});

test('leerRespuesta: un RNC que no está inscrito', () => {
  assert.deepEqual(leerRespuesta(NO_ENCONTRADO), { encontrado: false });
});

test('leerRespuesta: si la razón social viene vacía se usa el nombre comercial', () => {
  const sinRazon = ENCONTRADO.replace('<td>IT SOLUCLICK SRL</td>', '<td>  </td>');
  assert.equal(leerRespuesta(sinRazon).datos.razonSocial, 'IT SOLUCLICK');
});

test('leerRespuesta: Facturador Electrónico NO es false', () => {
  const no = ENCONTRADO.replace('Electr&#243;nico</td><td>SI</td>', 'Electr&#243;nico</td><td>NO</td>');
  assert.equal(leerRespuesta(no).datos.facturadorElectronico, false);
});

test('leerRespuesta: el error de la DGII o una página que no se reconoce lanzan ErrorDgii', () => {
  const error = NO_ENCONTRADO.replace(
    'El RNC/Cédula consultado no se encuentra inscrito como Contribuyente.',
    '11/11/2026 23:12 : Ocurrió un error al intentar realizar la búsqueda.',
  );
  assert.throws(() => leerRespuesta(error), ErrorDgii);
  assert.throws(() => leerRespuesta('<p>otra cosa</p>'), ErrorDgii);
  assert.throws(() => leerRespuesta(''), ErrorDgii);
});

// ---------------------------------------------------------------------------
// consultarDgii: GET, cookie y POST
// ---------------------------------------------------------------------------

function fetchFalso(...respuestas) {
  const llamadas = [];
  const f = async (url, init = {}) => {
    llamadas.push({ url: String(url), metodo: init.method ?? 'GET', headers: new Headers(init.headers), cuerpo: init.body });
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  f.llamadas = llamadas;
  return f;
}

const respuesta = (cuerpo, status = 200, headers = {}) => new Response(cuerpo, { status, headers });

test('consultarDgii hace el GET, pasa la cookie al POST y devuelve la ficha', async () => {
  const f = fetchFalso(
    respuesta(FORMULARIO, 200, { 'set-cookie': 'ASP.NET_SessionId=abc123; path=/; HttpOnly' }),
    respuesta(ENCONTRADO),
  );
  const r = await consultarDgii('130862346', f);

  assert.equal(r.encontrado, true);
  assert.equal(r.datos.razonSocial, 'IT SOLUCLICK SRL');
  assert.equal(f.llamadas.length, 2);
  assert.equal(f.llamadas[0].metodo, 'GET');
  assert.match(f.llamadas[0].url, /consultas\/rnc\.aspx$/);
  assert.equal(f.llamadas[1].metodo, 'POST');
  assert.match(f.llamadas[1].headers.get('cookie') ?? '', /ASP\.NET_SessionId=abc123/);
  assert.equal(f.llamadas[1].headers.get('x-microsoftajax'), 'Delta=true');
  const cuerpo = new URLSearchParams(String(f.llamadas[1].cuerpo));
  assert.equal(cuerpo.get('ctl00$cphMain$hidActiveTab'), 'rnc');
  assert.equal(cuerpo.get('ctl00$cphMain$txtRNCCedula'), '130862346');
});

test('consultarDgii: sin red o con un 500 lanza ErrorDgii', async () => {
  await assert.rejects(() => consultarDgii('130862346', fetchFalso(new Error('ECONNRESET'))), ErrorDgii);
  await assert.rejects(() => consultarDgii('130862346', fetchFalso(respuesta('caído', 500))), ErrorDgii);
  await assert.rejects(
    () => consultarDgii('130862346', fetchFalso(respuesta(FORMULARIO), respuesta('caído', 503))),
    ErrorDgii,
  );
});
