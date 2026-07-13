'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PlaceHolderImages } from '@/lib/placeholder-images';

const FALLBACK = 'https://picsum.photos/seed/placeholder/400/400';

// Resuelve el valor guardado en product.image a una URL mostrable:
// - URL real (http/https/data) => se usa tal cual (subida a Storage o pegada).
// - id de placeholder de demo => se busca en la lista local.
// - vacío/'placeholder'/desconocido => imagen genérica.
export function resolveProductImageUrl(image?: string | null): string {
  if (image && /^(https?:|data:)/i.test(image)) return image;
  const ph = PlaceHolderImages.find((p) => p.id === image);
  return ph?.imageUrl ?? FALLBACK;
}

interface ProductImageProps {
  image?: string | null;
  alt: string;
  /** Ocupa el contenedor (usar dentro de un elemento `relative`). */
  fill?: boolean;
  className?: string;
}

// Usamos <img> normal (no next/image) para aceptar cualquier URL sin depender de
// la lista blanca de dominios de next.config. Cae al placeholder si la URL falla.
export function ProductImage({ image, alt, fill, className }: ProductImageProps) {
  const [src, setSrc] = useState(() => resolveProductImageUrl(image));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => { if (src !== FALLBACK) setSrc(FALLBACK); }}
      className={cn(fill && 'absolute inset-0 h-full w-full', 'object-cover', className)}
    />
  );
}
