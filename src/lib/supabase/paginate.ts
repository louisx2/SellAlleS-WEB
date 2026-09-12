// PostgREST corta en `max_rows` (1000, ver supabase/config.toml) sin avisar: la
// respuesta llega truncada y sin error. Cualquier consulta que sume o
// reconstruya saldos tiene que pedir el resto por páginas o el total sale mal.
const PAGE_SIZE = 1000;

// Un `in.(...)` viaja en la URL. Con muchos ids el servidor responde 414 y la
// consulta se pierde entera, así que se parte en lotes. 100 uuids son ~3,7 KB
// de query string: holgado frente al límite habitual de 8 KB por línea de
// petición, aun sumando el resto de filtros y un `select` largo.
const CHUNK_SIZE = 100;

/**
 * Trae todas las filas de una consulta, página por página.
 *
 * `build` recibe el rango y devuelve la consulta ya armada; se llama una vez
 * por página porque los builders de supabase-js no se pueden reutilizar. Ordena
 * siempre por una columna estable: sin `order` el motor puede repetir u omitir
 * filas entre páginas.
 *
 * Lanza si una página falla, en vez de devolver lo que alcanzó a traer: un
 * total parcial presentado como completo es peor que no mostrar nada.
 */
export async function fetchAllRows<T = any>(
  build: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGE_SIZE) {
    const { data, error } = await build(desde, desde + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data) break;
    filas.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return filas;
}

/**
 * Igual que `fetchAllRows`, pero para consultas filtradas por una lista de ids:
 * parte la lista en lotes y pagina cada uno.
 */
export async function fetchAllByIds<T = any>(
  ids: string[],
  build: (lote: string[], desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const filas: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const lote = ids.slice(i, i + CHUNK_SIZE);
    filas.push(...await fetchAllRows<T>((desde, hasta) => build(lote, desde, hasta)));
  }
  return filas;
}
