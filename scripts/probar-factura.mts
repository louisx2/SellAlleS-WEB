// Prueba de humo de la factura compartida: se dibuja un pago de ejemplo con el módulo de
// supabase/functions/_shared y se revisa el texto del PDF (jsPDF no comprime el texto).
// Uso: node scripts/probar-factura.mts
import assert from 'node:assert/strict';
import {
  codigoDeFactura, crearFactura, nombreArchivoFactura, pagoDesdeFila, type ConstructorPdf,
} from '../supabase/functions/_shared/factura-suscripcion.ts';

const { jsPDF } = await import('jspdf');

const pago = pagoDesdeFila({
  id: 'abcdef12-3456-7890-abcd-ef1234567890',
  amount: '2300',
  paid_at: '2026-10-05',
  method: 'transfer',
  reference: 'REF123',
  period_start: '2026-10-05',
  period_end: '2026-11-04',
  plan_name: 'Anadsll',
  created_at: '2026-10-05T15:00:00Z',
  invoice_number: 7,
  invoice_issuer: { legal_name: 'SellAlleS', rnc: '131234567', notes: 'Gracias por su pago' },
  invoice_customer: { name: 'Anadsll Beauty Esthetic', phone: '8293224014' },
  invoice_itbis: 0,
});

assert.equal(codigoDeFactura(pago), 'ABCDEF12');
assert.equal(nombreArchivoFactura(pago), 'factura-sellalles-ABCDEF12.pdf');

const doc = crearFactura(jsPDF as unknown as ConstructorPdf, pago);
const pdf = Buffer.from(doc.output('datauristring').split(',')[1], 'base64').toString('latin1');
for (const esperado of ['FACTURA', 'No. ABCDEF12', 'Anadsll Beauty Esthetic', 'RD$ 2,300.00', 'PAGADA', '05/10/2026', 'REF123']) {
  assert.ok(pdf.includes(esperado), `falta "${esperado}" en el PDF`);
}
assert.throws(() => crearFactura(jsPDF as unknown as ConstructorPdf, { ...pago, invoiceNumber: undefined }), /no tiene factura/);

// con una ruta, guarda el PDF para compararlo con el de antes del cambio
if (process.argv[2]) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[2], Buffer.from(doc.output('arraybuffer')));
}
console.log('factura compartida: ok');
