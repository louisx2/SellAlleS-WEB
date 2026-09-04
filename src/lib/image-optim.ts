// Optimización de imágenes en el navegador, antes de subirlas a Storage.
//
// Por qué existe este archivo: hasta ahora `product-dialog` subía el `File` tal
// cual salía del teléfono — 1.5 MB de media, hasta 4 MB — y esa misma foto se
// servía después dentro de un recuadro de 200 px en la grilla del POS. El
// resultado medido en producción fueron 5 GB de transferencia en 24 horas, el
// cupo mensual entero del plan gratuito, con una sola imagen descargada 39
// veces en un día.
//
// La cura es no subir nunca el original: se redimensiona y recomprime aquí, y
// se generan DOS variantes, porque las dos pantallas tienen necesidades
// distintas:
//
//   - `full`  (1280 px) para el detalle del producto y la edición.
//   - `thumb` (400 px)  para la grilla del POS y el carrito, que es lo que se
//                       abre decenas de veces al día en cada caja.
//
// Servir el thumb donde toca es la palanca grande: ~18 kB en vez de ~1.5 MB.

/** Lado mayor, en píxeles, de cada variante. */
const MAX_LADO = { full: 1280, thumb: 400 } as const;

/** Calidad de compresión. El thumb se ve a 200 px: aguanta más pérdida. */
const CALIDAD = { full: 0.82, thumb: 0.72 } as const;

export type Variante = keyof typeof MAX_LADO;

export interface ImagenOptimizada {
  full: Blob;
  thumb: Blob;
  /** Extensión real conseguida: 'webp' salvo navegador antiguo, que cae a 'jpg'. */
  ext: 'webp' | 'jpg';
  /** Tipo MIME correspondiente, para pasárselo a Storage. */
  mime: string;
}

/**
 * Decodifica el archivo respetando la orientación EXIF.
 *
 * Sin `imageOrientation: 'from-image'` las fotos de teléfono se suben giradas:
 * el sensor guarda el píxel en horizontal y deja la rotación en un metadato que
 * el canvas ignora. Al recomprimir perdemos ese metadato, así que la rotación
 * hay que aplicarla ahora o se pierde para siempre.
 */
async function decodificar(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari viejo no acepta las opciones: seguimos por el camino del <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.src = url;
    });
  } finally {
    // Revocar aquí es seguro: la imagen ya está decodificada en memoria.
    URL.revokeObjectURL(url);
  }
}

/** Dibuja la fuente escalada a `maxLado` y devuelve el canvas resultante. */
function escalar(
  fuente: ImageBitmap | HTMLImageElement,
  anchoOrig: number,
  altoOrig: number,
  maxLado: number
): HTMLCanvasElement {
  // Nunca ampliamos: una foto de 300 px no mejora estirándola a 1280, solo pesa.
  const factor = Math.min(1, maxLado / Math.max(anchoOrig, altoOrig));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(anchoOrig * factor));
  canvas.height = Math.max(1, Math.round(altoOrig * factor));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo obtener el contexto del Canvas');
  // El suavizado alto importa al reducir 4000 px a 400: sin él aparece aliasing.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Exporta el canvas al mejor formato disponible.
 *
 * `toBlob` con un tipo no soportado no falla: devuelve PNG en silencio, que
 * para una foto pesa más que el JPEG original. Por eso comprobamos el `type`
 * que salió de verdad en vez de fiarnos de lo que pedimos.
 */
async function exportar(
  canvas: HTMLCanvasElement,
  calidad: number
): Promise<{ blob: Blob; ext: 'webp' | 'jpg'; mime: string }> {
  const aBlob = (mime: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, calidad));

  const webp = await aBlob('image/webp');
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', mime: 'image/webp' };

  const jpeg = await aBlob('image/jpeg');
  if (jpeg) return { blob: jpeg, ext: 'jpg', mime: 'image/jpeg' };

  throw new Error('El navegador no pudo comprimir la imagen');
}

/**
 * Convierte el archivo elegido por el usuario en las dos variantes que la app
 * sirve. Devuelve siempre ambas, aunque la original ya fuese pequeña: el
 * beneficio real no está en el tamaño del archivo sino en que la grilla deje de
 * pedir la imagen grande.
 */
export async function optimizarImagen(file: File): Promise<ImagenOptimizada> {
  const fuente = await decodificar(file);
  const ancho = 'width' in fuente ? fuente.width : (fuente as HTMLImageElement).naturalWidth;
  const alto = 'height' in fuente ? fuente.height : (fuente as HTMLImageElement).naturalHeight;
  if (!ancho || !alto) throw new Error('La imagen no tiene dimensiones válidas');

  try {
    const full = await exportar(escalar(fuente, ancho, alto, MAX_LADO.full), CALIDAD.full);
    const thumb = await exportar(escalar(fuente, ancho, alto, MAX_LADO.thumb), CALIDAD.thumb);
    // Las dos salen del mismo navegador, así que comparten formato.
    return { full: full.blob, thumb: thumb.blob, ext: full.ext, mime: full.mime };
  } finally {
    // Un ImageBitmap retiene la imagen descomprimida (una foto de 12 MP son
    // ~48 MB en RAM). En una tablet de caja eso se nota si no se libera.
    if ('close' in fuente) fuente.close();
  }
}
