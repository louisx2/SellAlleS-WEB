'use client';

import { useEffect } from 'react';

// El ícono de la pestaña sigue el tema de la app: el oscuro con el tema oscuro y
// el claro con el claro. next-themes pone o quita la clase `dark` en <html> (también
// cuando el tema es "sistema"), así que basta con mirar esa clase; así responde al
// botón de tema al instante, sin depender de que la página tenga el ThemeProvider.
// Antes de que cargue esto, el navegador usa /favicon.ico, que es el oscuro.
const OSCURO = '/favicon.ico';
const CLARO = '/favicon-light.ico';

export function ThemeFavicon() {
  useEffect(() => {
    const html = document.documentElement;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-tema]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/x-icon';
      link.setAttribute('data-tema', '');
      document.head.appendChild(link);
    }
    const icono = link;
    const aplicar = () => {
      const href = html.classList.contains('dark') ? OSCURO : CLARO;
      if (icono.getAttribute('href') !== href) icono.setAttribute('href', href);
    };
    aplicar();
    const observador = new MutationObserver(aplicar);
    observador.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observador.disconnect();
  }, []);

  return null;
}
