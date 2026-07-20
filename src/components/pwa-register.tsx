'use client';

import { useEffect } from 'react';

export function PWARegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Cuando un Service Worker NUEVO (de un deploy nuevo) toma control de
      // la página, el JS que ya está corriendo en memoria queda desincronizado
      // del build activo — una navegación del lado del cliente puede pedir un
      // chunk que ya no coincide y explota con un client-side exception en
      // blanco. Recargar una sola vez apenas cambia el controller garantiza
      // que la pestaña siempre corre un build consistente de punta a punta.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });

      // Register the service worker after the page load
      const handleRegister = () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            console.log('[PWA] Service Worker registrado exitosamente con scope:', registration.scope);
          })
          .catch((error) => {
            console.error('[PWA] Error registrando el Service Worker:', error);
          });
      };

      if (document.readyState === 'complete') {
        handleRegister();
      } else {
        window.addEventListener('load', handleRegister);
        return () => window.removeEventListener('load', handleRegister);
      }
    }
  }, []);

  return null;
}
