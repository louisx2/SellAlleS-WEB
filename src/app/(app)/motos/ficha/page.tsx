import FichaVehiculoClient from './ficha-client';

// Ruta estática (el vehículo se identifica por ?id=): una sola página prerenderizada
// que funciona para cualquier id en el export estático.
export default function FichaVehiculoPage() {
  return <FichaVehiculoClient />;
}
