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

/** Le pide al Service Worker en espera que tome el control. La recarga la hace
 *  pwa-register.tsx al detectar el relevo, no esta función. */
export function aplicarActualizacion() {
  registroEnEspera?.waiting?.postMessage('SKIP_WAITING');
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
