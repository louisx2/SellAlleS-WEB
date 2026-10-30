// Texto de la cantidad de una línea (carrito, cobro, recibo, financiamiento).
// Vive aparte de `presentations.ts` porque necesita `./units`, y las pruebas de
// node cargan `presentations.ts` directo, sin resolver imports de valores.
import type { LinePresentation } from './types';
import { formatQty, formatQtyCompact, getUnit } from './units';
import { presentationLabel } from './presentations';

// Sin presentación (líneas sueltas, carritos y ventas anteriores a las presentaciones):
// igual que siempre, "3" o "1.7 lb". Con presentación, `quantity` cuenta presentaciones
// y el texto dice cuáles: "2 Paquete x12", "1 Saco x125 lb".
export function formatLineQty(item: {
  quantity: number;
  presentation?: LinePresentation;
  product: { unit: string };
}): string {
  if (!item.presentation) return formatQtyCompact(item.quantity, item.product.unit);
  return `${formatQty(item.quantity)} ${presentationLabel(item.presentation, getUnit(item.product.unit).short)}`;
}
