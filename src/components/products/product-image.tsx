'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PlaceHolderImages } from '@/lib/placeholder-images';

const FALLBACK = '/cardboard_box.png';

// Sufijo de la miniatura que `optimizarImagen` sube junto a la imagen grande.
// Va antes de la extensión ({uuid}.thumb.webp) para que la ruta siga empezando
// por el id de empresa, que es lo que exige la policy RLS del bucket.
export const SUFIJO_THUMB = '.thumb';

// Resuelve el valor guardado en product.image a una URL mostrable:
// - URL real (http/https/data) => se usa tal cual (subida a Storage o pegada).
// - id de placeholder de demo => se busca en la lista local.
// - vacío/'placeholder'/desconocido => imagen genérica.
export function resolveProductImageUrl(image?: string | null): string {
  if (image && /^(https?:|data:)/i.test(image)) return image;
  const ph = PlaceHolderImages.find((p) => p.id === image);
  return ph?.imageUrl ?? FALLBACK;
}

/**
 * Devuelve la URL de la miniatura de una imagen nuestra de Storage.
 *
 * Solo reescribe lo que subió esta app (rutas de `product-images` con
 * extensión conocida). Cualquier otra cosa — una URL pegada de un proveedor,
 * un data: URI, un placeholder — se devuelve intacta, porque no existe ningún
 * thumb que pedir. Para las fotos subidas antes de la optimización el thumb
 * tampoco existe todavía; de eso se encarga el fallback de `ProductImage`.
 */
export function thumbUrl(url: string): string {
  if (!/\/product-images\//.test(url)) return url;
  return url.replace(/(\.(?:webp|jpe?g|png))(\?.*)?$/i, `${SUFIJO_THUMB}$1$2`);
}

interface ProductImageProps {
  image?: string | null;
  alt: string;
  /** Ocupa el contenedor (usar dentro de un elemento `relative`). */
  fill?: boolean;
  className?: string;
  /**
   * `thumb` pide la miniatura de 400 px (~18 kB) en vez de la imagen de 1280 px
   * (~120 kB). Úsalo en cualquier sitio donde la imagen se vea pequeña —
   * grillas, listas, carrito — que es donde está el volumen de descargas.
   */
  variant?: 'full' | 'thumb';
  /** Se dispara cuando el peldaño actual carga (el carrito lo usa para su skeleton). */
  onLoad?: () => void;
}

// Usamos <img> normal (no next/image) para aceptar cualquier URL sin depender de
// la lista blanca de dominios de next.config.
//
// La carga baja por una escalera de tres peldaños: miniatura -> imagen grande ->
// placeholder. El peldaño del medio es el que sostiene las fotos subidas antes
// de que existieran las miniaturas: para ellas el thumb da 404 y caemos al
// original sin que el cajero vea un hueco.
export function ProductImage({ image, alt, fill, className, variant = 'full', onLoad }: ProductImageProps) {
  const original = resolveProductImageUrl(image);
  const preferida = variant === 'thumb' ? thumbUrl(original) : original;

  // Estado derivado de props: si la tarjeta se reutiliza para otro producto hay
  // que volver al primer peldaño, o arrastraríamos el fallback del anterior.
  const [imagenPrevia, setImagenPrevia] = useState(image);
  const [peldano, setPeldano] = useState(0);
  if (imagenPrevia !== image) {
    setImagenPrevia(image);
    setPeldano(0);
  }

  // Sin duplicados: con variant="full" la preferida ES la original, y si no se
  // filtra un 404 gastaría dos peticiones idénticas antes de caer al placeholder.
  const escalera = [...new Set([preferida, original, FALLBACK])];
  const src = escalera[Math.min(peldano, escalera.length - 1)];

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={onLoad}
      onError={() => setPeldano((n) => Math.min(n + 1, escalera.length - 1))}
      className={cn(fill && 'absolute inset-0 h-full w-full', 'object-cover', className)}
    />
  );
}
