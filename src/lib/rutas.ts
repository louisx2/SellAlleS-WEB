/**
 * El ítem del menú que gobierna una página: el de href más largo que la
 * contiene. Con el primero que coincida, /motos/cobranza caería en /motos
 * (Vehículos) y pediría su permiso en vez del de Cobranza.
 */
export function itemDeRuta<T extends { href: string }>(items: T[], pathname: string): T | undefined {
  let mejor: T | undefined;
  for (const item of items) {
    const coincide = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (coincide && (!mejor || item.href.length > mejor.href.length)) mejor = item;
  }
  return mejor;
}
