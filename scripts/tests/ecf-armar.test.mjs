// Pruebas del armado del JSON del e-CF (módulo puro, sin red). `npm test` corre
// `node --test`; Node quita los tipos de armar.ts al importarlo, por eso ese
// archivo solo puede usar sintaxis borrable (nada de enum ni namespace).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  armarEcf,
  lineasDesdeItems,
  fechaLocal,
  aFechaDgii,
  ITBIS_TASA,
} from '../../supabase/functions/_shared/ecf/armar.ts';

// Datos mínimos de una factura de consumo; cada prueba pisa lo que necesita.
const datos = (over = {}) => ({
  tipo: 32,
  encf: 'E320000000001',
  fechaEmision: '2026-10-30',
  emisor: {
    rnc: '130000001',
    razonSocial: 'Supermercado Ejemplo SRL',
    direccion: 'Av. Principal #50, Santo Domingo',
  },
  comprador: null,
  itbisIncluido: false,
  aCredito: false,
  lineas: [{ nombre: 'Detergente', cantidad: 1, precio: 100, itbis: true, servicio: false }],
  totalGuardado: 118,
  itbisGuardado: 18,
  ...over,
});

// Armado que debe salir bien: devuelve el contenido de `ECF`.
const armar = (over = {}) => {
  const r = armarEcf(datos(over));
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  return r.json.ECF;
};

const gravado = (nombre, cantidad, precio) => ({ nombre, cantidad, precio, itbis: true, servicio: false });
const exento = (nombre, cantidad, precio) => ({ nombre, cantidad, precio, itbis: false, servicio: false });

test('ITBIS_TASA es 18%', () => {
  assert.equal(ITBIS_TASA, 0.18);
});

test('E32 sin comprador va como Consumidor Final', () => {
  const ecf = armar({ vencimientoSecuencia: '2028-12-31' });
  assert.deepEqual(ecf.Encabezado.Comprador, {
    RNCComprador: '00000000000',
    RazonSocialComprador: 'Consumidor Final',
  });
  // La factura de consumo no lleva vencimiento de secuencia, aunque se lo pasen.
  assert.equal(ecf.Encabezado.IdDoc.FechaVencimientoSecuencia, undefined);
  assert.equal(ecf.Encabezado.Emisor.FechaEmision, '30-10-2026');
  assert.equal(ecf.Encabezado.Version, '1.0');
  assert.equal(ecf.Encabezado.IdDoc.TipoeCF, 32);
  assert.equal(ecf.Encabezado.IdDoc.eNCF, 'E320000000001');
  assert.equal(ecf.Encabezado.IdDoc.TipoIngresos, '01');
});

test('E32 contado: TipoPago 1 y sin fecha límite de pago', () => {
  const ecf = armar();
  assert.equal(ecf.Encabezado.IdDoc.TipoPago, 1);
  assert.equal(ecf.Encabezado.IdDoc.FechaLimitePago, undefined);
});

test('E32 a crédito: TipoPago 2 pero sin fecha límite (solo la lleva el E31)', () => {
  const ecf = armar({ aCredito: true, fechaLimitePago: '2026-11-29' });
  assert.equal(ecf.Encabezado.IdDoc.TipoPago, 2);
  assert.equal(ecf.Encabezado.IdDoc.FechaLimitePago, undefined);
});

test('Emisor: nombre comercial solo si viene', () => {
  const sin = armar({ emisor: { rnc: '130000001', razonSocial: 'A SRL', nombreComercial: null, direccion: 'Calle 1' } });
  assert.equal('NombreComercial' in sin.Encabezado.Emisor, false);
  const con = armar({ emisor: { rnc: '130000001', razonSocial: 'A SRL', nombreComercial: 'Tienda A', direccion: 'Calle 1' } });
  assert.equal(con.Encabezado.Emisor.NombreComercial, 'Tienda A');
  assert.equal(con.Encabezado.Emisor.RNCEmisor, '130000001');
  assert.equal(con.Encabezado.Emisor.RazonSocialEmisor, 'A SRL');
  assert.equal(con.Encabezado.Emisor.DireccionEmisor, 'Calle 1');
});

test('ITBIS aparte: gravado y exento', () => {
  const ecf = armar({
    lineas: [gravado('Cable', 1, 100), exento('Agua', 1, 50)],
    totalGuardado: 168,
    itbisGuardado: 18,
  });
  const t = ecf.Encabezado.Totales;
  assert.equal(t.MontoGravadoTotal, 100);
  assert.equal(t.MontoGravadoI1, 100);
  assert.equal(t.MontoExento, 50);
  assert.equal(t.ITBIS1, 18);
  assert.equal(t.TotalITBIS, 18);
  assert.equal(t.TotalITBIS1, 18);
  assert.equal(t.MontoTotal, 168);
  assert.equal(ecf.Encabezado.IdDoc.IndicadorMontoGravado, 0);
  const items = ecf.DetallesItems.Item;
  assert.equal(items[0].IndicadorFacturacion, 1);
  assert.equal(items[1].IndicadorFacturacion, 4);
});

test('ITBIS incluido: el precio y el monto de la línea llevan el ITBIS', () => {
  const ecf = armar({
    itbisIncluido: true,
    lineas: [gravado('Cable', 1, 118)],
    totalGuardado: 118,
    itbisGuardado: 18,
  });
  const t = ecf.Encabezado.Totales;
  assert.equal(ecf.Encabezado.IdDoc.IndicadorMontoGravado, 1);
  assert.equal(t.MontoGravadoTotal, 100);
  assert.equal(t.MontoGravadoI1, 100);
  assert.equal(t.TotalITBIS, 18);
  assert.equal(t.TotalITBIS1, 18);
  assert.equal(t.MontoTotal, 118);
  assert.equal(ecf.DetallesItems.Item[0].MontoItem, 118);
  assert.equal(ecf.DetallesItems.Item[0].PrecioUnitarioItem, 118);
});

test('ITBIS incluido con una línea exenta: el exento no se descompone', () => {
  const ecf = armar({
    itbisIncluido: true,
    lineas: [gravado('Cable', 1, 118), exento('Agua', 1, 50)],
    totalGuardado: 168,
    itbisGuardado: 18,
  });
  const t = ecf.Encabezado.Totales;
  assert.equal(t.MontoGravadoTotal, 100);
  assert.equal(t.MontoExento, 50);
  assert.equal(t.TotalITBIS, 18);
  assert.equal(t.MontoTotal, 168);
});

test('El ITBIS se calcula sobre el total gravado, no línea por línea', () => {
  // Tres líneas de 0.30: por línea saldría 0.05 + 0.05 + 0.05 = 0.15,
  // sobre el total (0.90) sale 0.16, que es lo que guarda el carrito.
  const ecf = armar({
    lineas: [gravado('A', 1, 0.3), gravado('B', 1, 0.3), gravado('C', 1, 0.3)],
    totalGuardado: 1.06,
    itbisGuardado: 0.16,
  });
  assert.equal(ecf.Encabezado.Totales.TotalITBIS, 0.16);
  assert.equal(ecf.Encabezado.Totales.MontoTotal, 1.06);
});

test('Solo exentas: no lleva claves de monto gravado ni de ITBIS', () => {
  const ecf = armar({
    itbisIncluido: true,
    lineas: [exento('Agua', 2, 25)],
    totalGuardado: 50,
    itbisGuardado: 0,
  });
  const t = ecf.Encabezado.Totales;
  assert.deepEqual(t, { MontoExento: 50, MontoTotal: 50 });
  // Sin líneas gravadas no hay nada que "incluir".
  assert.equal(ecf.Encabezado.IdDoc.IndicadorMontoGravado, 0);
});

test('Solo gravadas: no lleva MontoExento', () => {
  const t = armar().Encabezado.Totales;
  assert.equal('MontoExento' in t, false);
});

test('Cantidad decimal: 2.5 x 10 da MontoItem 25', () => {
  const ecf = armar({
    lineas: [exento('Arroz (lb)', 2.5, 10)],
    totalGuardado: 25,
    itbisGuardado: 0,
  });
  const item = ecf.DetallesItems.Item[0];
  assert.equal(item.CantidadItem, 2.5);
  assert.equal(item.PrecioUnitarioItem, 10);
  assert.equal(item.MontoItem, 25);
});

test('E31 a crédito', () => {
  const ecf = armar({
    tipo: 31,
    encf: 'E310000000005',
    vencimientoSecuencia: '2028-12-31',
    comprador: { rnc: '101023122', nombre: 'Cliente Prueba SRL' },
    aCredito: true,
    fechaLimitePago: '2026-11-29',
  });
  const id = ecf.Encabezado.IdDoc;
  assert.equal(id.TipoeCF, 31);
  assert.equal(id.TipoPago, 2);
  assert.equal(id.FechaLimitePago, '29-11-2026');
  assert.equal(id.FechaVencimientoSecuencia, '31-12-2028');
  assert.deepEqual(ecf.Encabezado.Comprador, {
    RNCComprador: '101023122',
    RazonSocialComprador: 'Cliente Prueba SRL',
  });
});

test('E31 al contado no lleva fecha límite de pago', () => {
  const ecf = armar({
    tipo: 31,
    vencimientoSecuencia: '2028-12-31',
    comprador: { rnc: '101023122', nombre: 'Cliente Prueba SRL' },
    fechaLimitePago: '2026-11-29',
  });
  assert.equal(ecf.Encabezado.IdDoc.TipoPago, 1);
  assert.equal(ecf.Encabezado.IdDoc.FechaLimitePago, undefined);
});

test('E31 sin comprador no se arma', () => {
  const r = armarEcf(datos({ tipo: 31, vencimientoSecuencia: '2028-12-31', comprador: null }));
  assert.equal(r.ok, false);
  assert.match(r.error, /RNC del cliente/);
});

test('E31 con RNC en blanco tampoco se arma', () => {
  const r = armarEcf(datos({
    tipo: 31,
    vencimientoSecuencia: '2028-12-31',
    comprador: { rnc: '  ', nombre: 'Cliente' },
  }));
  assert.equal(r.ok, false);
  assert.match(r.error, /RNC del cliente/);
});

test('E31 sin vencimiento de la secuencia no se arma', () => {
  const r = armarEcf(datos({
    tipo: 31,
    comprador: { rnc: '101023122', nombre: 'Cliente Prueba SRL' },
  }));
  assert.equal(r.ok, false);
  assert.match(r.error, /vencimiento/i);
});

test('E31 a crédito sin fecha límite de pago no se arma', () => {
  const r = armarEcf(datos({
    tipo: 31,
    vencimientoSecuencia: '2028-12-31',
    comprador: { rnc: '101023122', nombre: 'Cliente Prueba SRL' },
    aCredito: true,
  }));
  assert.equal(r.ok, false);
  assert.match(r.error, /fecha límite/i);
});

test('E34 anula con referencia', () => {
  const referencia = { encf: 'E320000000007', fechaEmision: '2026-10-01', masDe30Dias: false };
  const ecf = armar({
    tipo: 34,
    encf: 'E340000000001',
    vencimientoSecuencia: '2028-12-31',
    referencia,
  });
  assert.deepEqual(ecf.InformacionReferencia, {
    NCFModificado: 'E320000000007',
    FechaNCFModificado: '01-10-2026',
    CodigoModificacion: 1,
  });
  assert.equal(ecf.Encabezado.IdDoc.IndicadorNotaCredito, 0);
  assert.equal(ecf.Encabezado.IdDoc.FechaVencimientoSecuencia, undefined);

  const vieja = armar({
    tipo: 34,
    encf: 'E340000000001',
    referencia: { ...referencia, masDe30Dias: true },
  });
  assert.equal(vieja.Encabezado.IdDoc.IndicadorNotaCredito, 1);
});

test('E34 sin comprador (venta a consumidor final) usa Consumidor Final', () => {
  const ecf = armar({
    tipo: 34,
    encf: 'E340000000001',
    referencia: { encf: 'E320000000007', fechaEmision: '2026-10-01', masDe30Dias: false },
  });
  assert.equal(ecf.Encabezado.Comprador.RNCComprador, '00000000000');
});

test('E34 sin referencia no se arma', () => {
  const r = armarEcf(datos({ tipo: 34, encf: 'E340000000001' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /referencia/i);
});

test('Solo el E34 lleva InformacionReferencia ni IndicadorNotaCredito', () => {
  const ecf = armar({ referencia: { encf: 'E320000000007', fechaEmision: '2026-10-01', masDe30Dias: true } });
  assert.equal('InformacionReferencia' in ecf, false);
  assert.equal(ecf.Encabezado.IdDoc.IndicadorNotaCredito, undefined);
});

test('Servicio marca IndicadorBienoServicio 2', () => {
  const ecf = armar({
    lineas: [
      { nombre: 'Instalación', cantidad: 1, precio: 100, itbis: true, servicio: true },
      gravado('Cable', 1, 100),
    ],
    totalGuardado: 236,
    itbisGuardado: 36,
  });
  assert.equal(ecf.DetallesItems.Item[0].IndicadorBienoServicio, 2);
  assert.equal(ecf.DetallesItems.Item[1].IndicadorBienoServicio, 1);
});

test('Cuadre: un centavo de diferencia pasa, dos no', () => {
  const lineas = [gravado('Cable', 1, 100), exento('Agua', 1, 50)];
  const mal = armarEcf(datos({ lineas, totalGuardado: 168.02, itbisGuardado: 18 }));
  assert.equal(mal.ok, false);
  assert.match(mal.error, /no cuadra/);
  const bien = armarEcf(datos({ lineas, totalGuardado: 168.01, itbisGuardado: 18 }));
  assert.equal(bien.ok, true);
});

test('Cuadre: el ITBIS guardado también se compara', () => {
  const r = armarEcf(datos({ totalGuardado: 118, itbisGuardado: 17 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /no cuadra/);
  assert.match(r.error, /ITBIS/);
});

test('Sin líneas o con líneas inválidas no se arma', () => {
  assert.equal(armarEcf(datos({ lineas: [] })).ok, false);
  assert.equal(armarEcf(datos({ lineas: [gravado('X', 0, 100)] })).ok, false);
  assert.equal(armarEcf(datos({ lineas: [gravado('X', 1, -5)] })).ok, false);
});

test('NumeroLinea empieza en 1 y es consecutivo; FechaHoraFirma va vacía', () => {
  const ecf = armar({
    lineas: [gravado('A', 1, 10), gravado('B', 1, 10), exento('C', 1, 10)],
    totalGuardado: 33.6,
    itbisGuardado: 3.6,
  });
  assert.deepEqual(ecf.DetallesItems.Item.map((i) => i.NumeroLinea), [1, 2, 3]);
  assert.equal(ecf.FechaHoraFirma, '');
});

test('NombreItem se recorta a 80 caracteres', () => {
  const largo = 'X'.repeat(120);
  const ecf = armar({ lineas: [gravado(`  ${largo}  `, 1, 100)] });
  assert.equal(ecf.DetallesItems.Item[0].NombreItem.length, 80);
});

test('Fechas con formato inválido no se arman', () => {
  const r = armarEcf(datos({ fechaEmision: '30/10/2026' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /fecha/i);
});

test('fechaLocal: pasada la medianoche UTC sigue siendo el día anterior en Santo Domingo', () => {
  assert.equal(fechaLocal('2026-10-31T03:30:00Z', 'America/Santo_Domingo'), '2026-10-30');
  assert.equal(fechaLocal('2026-10-31T04:30:00Z', 'America/Santo_Domingo'), '2026-10-31');
  assert.equal(fechaLocal('2026-10-31T03:30:00Z', 'UTC'), '2026-10-31');
});

test('aFechaDgii pasa de YYYY-MM-DD a DD-MM-YYYY', () => {
  assert.equal(aFechaDgii('2026-10-30'), '30-10-2026');
  assert.throws(() => aFechaDgii('30-10-2026'));
});

test('lineasDesdeItems usa custom_price cuando existe', () => {
  const [l] = lineasDesdeItems([
    { product_name: 'Cable', quantity: 2, price: 500, custom_price: 450, itbis: true },
  ]);
  assert.deepEqual(l, { nombre: 'Cable', cantidad: 2, precio: 450, itbis: true, servicio: false });
});

test('lineasDesdeItems: custom_price null usa price; es_servicio null es falso', () => {
  const ls = lineasDesdeItems([
    { product_name: 'A', quantity: 1, price: 500, custom_price: null, itbis: false, es_servicio: null },
    { product_name: 'B', quantity: 1, price: 80, custom_price: null, itbis: true, es_servicio: true },
  ]);
  assert.equal(ls[0].precio, 500);
  assert.equal(ls[0].servicio, false);
  assert.equal(ls[1].servicio, true);
});

test('Una venta de 2 x 450 con ITBIS aparte (desde sale_items) cuadra con 1062', () => {
  const lineas = lineasDesdeItems([
    { product_name: 'Cable', quantity: 2, price: 500, custom_price: 450, itbis: true },
  ]);
  const r = armarEcf(datos({ lineas, totalGuardado: 1062, itbisGuardado: 162 }));
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  assert.equal(r.json.ECF.Encabezado.Totales.MontoTotal, 1062);
});
