'use client';

import { useEffect, useState } from 'react';

/**
 * Estado compartido de "hay una versión nueva esperando".
 *
 * Lo detecta pwa-register.tsx y lo muestra el menú lateral, que son dos puntos
 * lejanos del árbol. Va en un módulo y no en un contexto porque el aviso llega
 * de un evento del Service Worker, fuera de React, y a veces antes de que el
 * componente que lo muestra se haya montado — el valor inicial tiene que estar
 * disponible en cualquier momento, no solo cuando alguien escuchaba.
 */
const EVENTO = 'sellalles:actualizacion-disponible';

let registroEnEspera: ServiceWorkerRegistration | null = null;

export function marcarActualizacionDisponible(registro: ServiceWorkerRegistration) {
  registroEnEspera = registro;
  window.dispatchEvent(new Event(EVENTO));
}

/** Cuánto se espera al relevo del Service Worker antes de recargar por las
 *  bravas. Da de sobra para un skipWaiting + activate, y es poco como para que
 *  nadie piense que el botón se colgó. */
const ESPERA_RELEVO_MS = 3000;

/**
 * Aplica la versión nueva. Termina SIEMPRE en una recarga.
 *
 * La versión anterior era una sola línea, `registroEnEspera?.waiting
 * ?.postMessage(...)`, y esos dos `?.` eran el problema: si el worker en espera
 * ya no estaba —otra pestaña lo activó, el navegador lo descartó, o entró una
 * actualización más nueva y `waiting` quedó nulo un instante— la llamada no
 * hacía nada y no se veía nada. El cajero pulsaba y la app se quedaba igual,
 * con el aviso todavía puesto.
 *
 * Ahora, si el relevo no llega, hacemos por dentro lo que el cajero acabó
 * haciendo a mano: vaciar la caché y recargar, que es lo que Ctrl+F5 consigue y
 * una recarga normal no.
 */
export async function aplicarActualizacion(): Promise<void> {
  // Releer el registro en vez de fiarse del que se guardó al aparecer el aviso:
  // entre una cosa y otra pueden haber pasado horas.
  let registro = registroEnEspera;
  try {
    registro = registro ?? (await navigator.serviceWorker?.getRegistration()) ?? null;
  } catch {
    // Sin Service Worker accesible seguimos: la recarga de abajo vale igual.
  }

  const enEspera = registro?.waiting;
  if (enEspera) {
    enEspera.postMessage('SKIP_WAITING');
    // Si el relevo llega, pwa-register.tsx recarga y esta espera nunca termina.
    await new Promise(resolve => setTimeout(resolve, ESPERA_RELEVO_MS));
  } else {
    console.warn('[PWA] No había Service Worker en espera al pulsar Actualizar; se recarga saltando la caché.');
  }

  // Una recarga normal se sirve de la caché del Service Worker, así que puede
  // devolver el mismo build viejo. Vaciarla primero es el equivalente al
  // Ctrl+F5 que hoy hay que hacer a mano.
  try {
    if ('caches' in window) {
      const nombres = await caches.keys();
      await Promise.all(nombres.map(nombre => caches.delete(nombre)));
    }
  } catch {
    // Si el navegador no deja tocar la caché, recargamos igual.
  }

  window.location.reload();
}

export function useActualizacionDisponible(): boolean {
  const [disponible, setDisponible] = useState(false);

  useEffect(() => {
    // Puede haberse detectado antes de montar este componente.
    if (registroEnEspera?.waiting) setDisponible(true);
    const alAvisar = () => setDisponible(!!registroEnEspera?.waiting);
    window.addEventListener(EVENTO, alAvisar);
    return () => window.removeEventListener(EVENTO, alAvisar);
  }, []);

  return disponible;
}

/** Versión horneada en el build. La muestra el menú lateral para saber, mirando
 *  la pantalla de alguien, qué build está usando de verdad. */
export const VERSION = process.env.NEXT_PUBLIC_VERSION ?? 'dev';
