// Pone al día las imágenes que ya están en Storage.
//
// Los cambios del cliente (src/lib/image-optim.ts) solo afectan a lo que se
// suba de ahora en adelante. Las fotos que ya están arriba siguen pesando 1.5 MB
// de media y no tienen miniatura, así que el POS las sigue descargando enteras.
// Este script arregla lo ya subido, en dos fases independientes:
//
//   recomprimir  Reescribe cada foto a WebP 1280 px + miniatura de 400 px,
//                actualiza `products.image` y borra el original.
//   huerfanas    Borra los objetos que no referencia ningún producto ni logo.
//
// Es una herramienta de un solo uso, así que `sharp` no está en package.json:
// instálalo solo mientras la corras.
//
//   npm i --no-save sharp
//   export SUPABASE_URL=https://xxxx.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=...        # NUNCA la del navegador
//   node scripts/optimizar-storage.mjs recomprimir             # simulacro
//   node scripts/optimizar-storage.mjs recomprimir --aplicar   # de verdad
//
// Sin `--aplicar` no escribe nada: enseña lo que haría y cuánto ahorraría.
// Empieza siempre por el simulacro.
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'product-images';
const MAX_LADO = { full: 1280, thumb: 400 };
const CALIDAD = { full: 82, thumb: 72 };
const SUFIJO_THUMB = '.thumb';

const fase = process.argv[2];
const aplicar = process.argv.includes('--aplicar');

const URL_SUPABASE = process.env.SUPABASE_URL;
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!['recomprimir', 'huerfanas'].includes(fase)) {
  console.error('Uso: node scripts/optimizar-storage.mjs <recomprimir|huerfanas> [--aplicar]');
  process.exit(1);
}
if (!URL_SUPABASE || !CLAVE) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}

const supabase = createClient(URL_SUPABASE, CLAVE, { auth: { persistSession: false } });

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * Recorre el bucket entero. `list()` solo devuelve un nivel, y las carpetas
 * vienen con `id` nulo, que es lo que las distingue de los archivos.
 */
async function listarTodo(prefijo = '') {
  const encontrados = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefijo, { limit: 100, offset: desde });
    if (error) throw new Error(`No se pudo listar "${prefijo}": ${error.message}`);
    if (!data.length) break;

    for (const entrada of data) {
      const ruta = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
      if (entrada.id === null) encontrados.push(...(await listarTodo(ruta)));
      else encontrados.push({ ruta, tamano: entrada.metadata?.size ?? 0 });
    }
    if (data.length < 100) break;
    desde += 100;
  }
  return encontrados;
}

const urlPublica = (ruta) =>
  supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;

async function recomprimir() {
  const { default: sharp } = await import('sharp').catch(() => {
    console.error('Falta sharp. Instálalo con:  npm i --no-save sharp');
    process.exit(1);
  });

  const objetos = await listarTodo();
  // Los logos se saltan a propósito: son PNG en escala de grises pensados para
  // la impresora térmica, donde el sin-pérdida se nota, y entre todos no llegan
  // a 200 kB. No son el problema.
  const candidatos = objetos.filter(
    (o) => !o.ruta.includes('/logos/') && !o.ruta.includes(SUFIJO_THUMB + '.')
  );

  console.log(`${candidatos.length} imágenes a revisar (${mb(candidatos.reduce((a, o) => a + o.tamano, 0))} en total)`);
  if (!aplicar) console.log('SIMULACRO — no se escribe nada. Añade --aplicar para ejecutar.\n');

  let antes = 0;
  let despues = 0;
  let hechas = 0;
  let fallos = 0;

  for (const objeto of candidatos) {
    const base = objeto.ruta.replace(/\.[^./]+$/, '');
    const rutaFull = `${base}.webp`;
    const rutaThumb = `${base}${SUFIJO_THUMB}.webp`;

    try {
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(objeto.ruta);
      if (error) throw new Error(error.message);
      const original = Buffer.from(await blob.arrayBuffer());

      // .rotate() sin argumentos aplica la orientación EXIF. Sin esto las fotos
      // de teléfono salen giradas, porque al recomprimir se pierde el metadato.
      const procesar = (lado, calidad) =>
        sharp(original)
          .rotate()
          .resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: calidad })
          .toBuffer();

      const [full, thumb] = await Promise.all([
        procesar(MAX_LADO.full, CALIDAD.full),
        procesar(MAX_LADO.thumb, CALIDAD.thumb),
      ]);

      antes += objeto.tamano;
      despues += full.length + thumb.length;
      hechas++;
      console.log(`  ${objeto.ruta}: ${kb(objeto.tamano)} -> ${kb(full.length)} + ${kb(thumb.length)} miniatura`);

      if (!aplicar) continue;

      const opciones = { cacheControl: '31536000', upsert: true, contentType: 'image/webp' };
      for (const [ruta, cuerpo] of [[rutaFull, full], [rutaThumb, thumb]]) {
        const { error: errSubida } = await supabase.storage.from(BUCKET).upload(ruta, cuerpo, opciones);
        if (errSubida) throw new Error(`subiendo ${ruta}: ${errSubida.message}`);
      }

      // Repuntar el producto ANTES de borrar el original: si algo falla aquí,
      // la fila sigue apuntando a un archivo que existe. Al revés dejaríamos
      // productos con la foto rota.
      const { error: errUpdate } = await supabase
        .from('products')
        .update({ image: urlPublica(rutaFull) })
        .like('image', `%${objeto.ruta}`);
      if (errUpdate) throw new Error(`actualizando products: ${errUpdate.message}`);

      // Si el original ya era .webp, su ruta coincide con la nueva y el upload
      // con upsert ya lo reemplazó: borrarlo ahora se llevaría la buena.
      if (objeto.ruta !== rutaFull) {
        const { error: errBorrado } = await supabase.storage.from(BUCKET).remove([objeto.ruta]);
        if (errBorrado) throw new Error(`borrando ${objeto.ruta}: ${errBorrado.message}`);
      }
    } catch (err) {
      fallos++;
      console.error(`  FALLO en ${objeto.ruta}: ${err.message}`);
    }
  }

  console.log(`\n${hechas} imágenes procesadas, ${fallos} fallos.`);
  if (antes) {
    console.log(`Storage: ${mb(antes)} -> ${mb(despues)} (${(antes / despues).toFixed(1)}x menos).`);
    console.log(`La grilla del POS pasa a pedir solo las miniaturas: ${mb(antes)} -> ${mb(despues / 2)} por catálogo completo.`);
  }
}

async function huerfanas() {
  const objetos = await listarTodo();

  // Las tres tablas que pueden apuntar a este bucket. Si algún día se añade
  // otra columna de imagen, tiene que entrar aquí o el script borrará archivos
  // que sí se usan.
  const referencias = new Set();
  const fuentes = [
    ['products', ['image']],
    ['companies', ['logo_url', 'ticket_logo_url']],
    ['branches', ['logo_url', 'ticket_logo_url']],
  ];
  for (const [tabla, columnas] of fuentes) {
    const { data, error } = await supabase.from(tabla).select(columnas.join(','));
    if (error) throw new Error(`leyendo ${tabla}: ${error.message}`);
    for (const fila of data) {
      for (const col of columnas) {
        // Se guarda la URL pública completa, y los logos llevan además un ?v=.
        // Nos quedamos con la ruta dentro del bucket, que es la clave real.
        if (fila[col]) referencias.add(String(fila[col]).split('?')[0].split(`${BUCKET}/`).pop());
      }
    }
  }

  const sobrantes = objetos.filter((o) => !referencias.has(o.ruta));
  const peso = sobrantes.reduce((a, o) => a + o.tamano, 0);

  console.log(`${objetos.length} objetos en el bucket, ${referencias.size} referenciados.`);
  console.log(`${sobrantes.length} huérfanos ocupando ${mb(peso)}:`);
  for (const o of sobrantes) console.log(`  ${o.ruta} (${kb(o.tamano)})`);

  if (!sobrantes.length) return;
  if (!aplicar) {
    console.log('\nSIMULACRO — no se borró nada. Añade --aplicar para borrarlos.');
    return;
  }

  // remove() acepta como mucho unos cientos de rutas por llamada.
  for (let i = 0; i < sobrantes.length; i += 100) {
    const lote = sobrantes.slice(i, i + 100).map((o) => o.ruta);
    const { error } = await supabase.storage.from(BUCKET).remove(lote);
    if (error) throw new Error(`borrando lote: ${error.message}`);
  }
  console.log(`\nBorrados ${sobrantes.length} objetos, ${mb(peso)} liberados.`);
}

await (fase === 'recomprimir' ? recomprimir() : huerfanas());
