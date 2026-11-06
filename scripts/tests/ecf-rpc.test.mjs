// Pruebas de las llamadas a la base que comparten ecf-emitir, ecf-estado y
// ecf-admin (leer credenciales, guardar la sesión, sumar el uso). Nunca se llama
// a la base: cada prueba usa un cliente falso con una `rpc` que guarda lo que
// recibe. `npm test` corre `node --test`; Node quita los tipos de rpc.ts, por eso
// ese archivo solo puede usar sintaxis borrable.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  credencialesDesde,
  guardarSesion,
  leerCredenciales,
  sumarUso,
} from '../../supabase/functions/_shared/ecf/rpc.ts';

const EMPRESA = '00000000-0000-0000-0000-0000000000aa';
const PASSWORD = 'clave-super-secreta';
const API_KEY = 'api-key-secreta-123';
const REFRESH = 'refresh-secreto-456';
const ID_TOKEN = 'id-token-secreto-789';

// Cliente falso: `rpc` devuelve lo que se le prepara y guarda cada llamada.
function clienteFalso(respuesta) {
  const llamadas = [];
  return {
    llamadas,
    rpc: async (fn, args) => {
      llamadas.push({ fn, args });
      if (respuesta instanceof Error) throw respuesta;
      return respuesta;
    },
  };
}

// Lo que devuelve ecf_leer_credenciales: llaves en snake_case.
const filaCompleta = {
  email: 'ecf+demo@sellalles.com',
  password: PASSWORD,
  api_key: API_KEY,
  refresh_token: REFRESH,
  sub: 'sub-1',
  id_token: ID_TOKEN,
  id_token_vence: '2026-10-30T13:00:00.000Z',
};

test('credencialesDesde pasa las llaves de snake_case a las del cliente de MSeller', () => {
  assert.deepEqual(credencialesDesde(filaCompleta, 'TesteCF'), {
    email: 'ecf+demo@sellalles.com',
    password: PASSWORD,
    apiKey: API_KEY,
    refreshToken: REFRESH,
    sub: 'sub-1',
    idToken: ID_TOKEN,
    idTokenVence: '2026-10-30T13:00:00.000Z',
  });
});

test('credencialesDesde: sin sesión guardada, los campos de la sesión quedan en null', () => {
  const sinSesion = { email: 'a@b.com', password: PASSWORD, api_key: API_KEY };
  assert.deepEqual(credencialesDesde(sinSesion, 'eCF'), {
    email: 'a@b.com',
    password: PASSWORD,
    apiKey: API_KEY,
    refreshToken: null,
    sub: null,
    idToken: null,
    idTokenVence: null,
  });
  // La base manda null (no ausente) en lo que no tiene.
  const conNulos = { ...sinSesion, refresh_token: null, sub: null, id_token: null, id_token_vence: null };
  assert.deepEqual(credencialesDesde(conNulos, 'eCF'), credencialesDesde(sinSesion, 'eCF'));
});

test('credencialesDesde: sin credenciales guardadas lanza un error que nombra el ambiente', () => {
  for (const nada of [null, undefined]) {
    assert.throws(
      () => credencialesDesde(nada, 'CerteCF'),
      { message: 'La empresa no tiene credenciales de MSeller guardadas para CerteCF.' },
    );
  }
});

test('credencialesDesde: si falta el correo, la contraseña o la API key, dice que están incompletas', () => {
  for (const falta of ['email', 'password', 'api_key']) {
    for (const vacio of [null, '']) {
      assert.throws(
        () => credencialesDesde({ ...filaCompleta, [falta]: vacio }, 'TesteCF'),
        { message: 'Las credenciales de MSeller de TesteCF están incompletas.' },
        `sin ${falta}`,
      );
    }
  }
});

test('credencialesDesde: ningún mensaje de error lleva secretos', () => {
  const incompleta = { ...filaCompleta, api_key: null };
  assert.throws(
    () => credencialesDesde(incompleta, 'TesteCF'),
    (e) => {
      const m = String(e.message);
      return ![PASSWORD, REFRESH, ID_TOKEN].some((s) => m.includes(s));
    },
  );
});

test('leerCredenciales llama a ecf_leer_credenciales con la empresa y el ambiente y devuelve las credenciales', async () => {
  const db = clienteFalso({ data: filaCompleta, error: null });
  const c = await leerCredenciales(db, EMPRESA, 'TesteCF');
  assert.deepEqual(db.llamadas, [
    { fn: 'ecf_leer_credenciales', args: { p_company: EMPRESA, p_ambiente: 'TesteCF' } },
  ]);
  assert.equal(c.apiKey, API_KEY);
  assert.equal(c.refreshToken, REFRESH);
});

test('leerCredenciales: si la base falla lanza un error sin lo leído; si no hay nada, el de "no tiene credenciales"', async () => {
  await assert.rejects(
    leerCredenciales(clienteFalso({ data: null, error: { message: 'boom' } }), EMPRESA, 'eCF'),
    { message: 'No se pudieron leer las credenciales de MSeller: boom' },
  );
  await assert.rejects(
    leerCredenciales(clienteFalso({ data: null, error: null }), EMPRESA, 'eCF'),
    { message: 'La empresa no tiene credenciales de MSeller guardadas para eCF.' },
  );
});

test('guardarSesion manda a ecf_guardar_sesion cada campo de la sesión con su nombre', async () => {
  const db = clienteFalso({ data: null, error: null });
  await guardarSesion(db, EMPRESA, 'TesteCF', {
    idToken: ID_TOKEN,
    idTokenVence: '2026-10-30T13:00:00.000Z',
    refreshToken: REFRESH,
    sub: 'sub-1',
  });
  assert.deepEqual(db.llamadas, [
    {
      fn: 'ecf_guardar_sesion',
      args: {
        p_company: EMPRESA,
        p_ambiente: 'TesteCF',
        p_id_token: ID_TOKEN,
        p_id_token_vence: '2026-10-30T13:00:00.000Z',
        p_refresh_token: REFRESH,
        p_sub: 'sub-1',
      },
    },
  ]);

  // Al renovar no llega refresh token nuevo: va null y la base conserva el anterior.
  const db2 = clienteFalso({ data: null, error: null });
  await guardarSesion(db2, EMPRESA, 'eCF', { idToken: 't', idTokenVence: 'v', refreshToken: null, sub: 's' });
  assert.equal(db2.llamadas[0].args.p_refresh_token, null);
});

test('guardarSesion: si la base falla el error no lleva los tokens', async () => {
  const db = clienteFalso({ data: null, error: { message: 'no hay credenciales' } });
  await assert.rejects(
    guardarSesion(db, EMPRESA, 'TesteCF', { idToken: ID_TOKEN, idTokenVence: 'v', refreshToken: REFRESH, sub: 's' }),
    (e) => {
      const m = String(e.message);
      return m === 'No se pudo guardar la sesión de MSeller: no hay credenciales' && !m.includes(ID_TOKEN) && !m.includes(REFRESH);
    },
  );
});

test('sumarUso manda requests y comprobantes a ecf_sumar_uso', async () => {
  const db = clienteFalso({ data: null, error: null });
  await sumarUso(db, EMPRESA, 3, 2);
  assert.deepEqual(db.llamadas, [
    { fn: 'ecf_sumar_uso', args: { p_company: EMPRESA, p_requests: 3, p_comprobantes: 2 } },
  ]);
  await assert.rejects(sumarUso(clienteFalso({ data: null, error: { message: 'boom' } }), EMPRESA, 1, 0), {
    message: 'No se pudo sumar el uso del plan: boom',
  });
});
