'use client';

import { useEffect } from 'react';
import { marcarActualizacionDisponible } from '@/lib/pwa-update';

export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Cuando el Service Worker nuevo toma el control, el JS que ya está
    // corriendo en memoria queda desincronizado del build activo — una
    // navegación del lado del cliente puede pedir un chunk que ya no coincide y
    // explota con una pantalla en blanco. Recargar una vez apenas cambia el
    // controller garantiza que la pestaña corre un build consistente.
    //
    // Antes esto pasaba solo (el Service Worker se instalaba con skipWaiting) y
    // podía recargarle la pantalla a un cajero a mitad de un cobro. Ahora el
    // relevo solo ocurre cuando alguien acepta el aviso de versión nueva, así
    // que esta recarga es siempre algo que el usuario pidió.
    let recargado = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargado) return;
      recargado = true;
      window.location.reload();
    });

    // La tablet del mostrador se queda abierta horas sin navegar, y el
    // navegador solo comprueba si hay Service Worker nuevo al navegar o, por su
    // cuenta, como mucho cada 24 horas. Sin esto, el aviso de versión nueva
    // puede tardar un día en aparecer justo en el dispositivo donde más falta
    // hace, porque es el que nunca se recarga.
    let registroActual: ServiceWorkerRegistration | null = null;
    let ultimaComprobacion = 0;
    const MINIMO_ENTRE_COMPROBACIONES = 60_000;

    const alVolverAPrimerPlano = () => {
      if (document.visibilityState !== 'visible' || !registroActual) return;
      // Cambiar de app y volver dispara esto a cada rato; cada comprobación es
      // una petición de red. Una por minuto es de sobra.
      const ahora = Date.now();
      if (ahora - ultimaComprobacion < MINIMO_ENTRE_COMPROBACIONES) return;
      ultimaComprobacion = ahora;
      registroActual.update().catch(() => {
        // Sin conexión no hay nada que comprobar; se reintenta la próxima vez.
      });
    };

    const registrar = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registro) => {
          console.log('[PWA] Service Worker registrado con scope:', registro.scope);
          registroActual = registro;
          document.addEventListener('visibilitychange', alVolverAPrimerPlano);

          // Ya había uno esperando de una visita anterior.
          if (registro.waiting && navigator.serviceWorker.controller) {
            marcarActualizacionDisponible(registro);
          }

          registro.addEventListener('updatefound', () => {
            const entrante = registro.installing;
            if (!entrante) return;
            entrante.addEventListener('statechange', () => {
              // `controller` nulo = primera visita: el Service Worker se está
              // instalando por primera vez y no hay nada que actualizar.
              if (entrante.state === 'installed' && navigator.serviceWorker.controller) {
                marcarActualizacionDisponible(registro);
              }
            });
          });
        })
        .catch((error) => {
          console.error('[PWA] Error registrando el Service Worker:', error);
        });
    };

    if (document.readyState === 'complete') {
      registrar();
      return () => document.removeEventListener('visibilitychange', alVolverAPrimerPlano);
    }
    window.addEventListener('load', registrar);
    return () => {
      window.removeEventListener('load', registrar);
      document.removeEventListener('visibilitychange', alVolverAPrimerPlano);
    };
  }, []);

  return null;
}
