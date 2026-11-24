import ContratoClient from './contrato-client';

// Ruta estática (?tipo=venta|prestamo&id=): una sola página prerenderizada que
// funciona para cualquier venta o préstamo en el export estático.
export default function ContratoPage() {
  return <ContratoClient />;
}
