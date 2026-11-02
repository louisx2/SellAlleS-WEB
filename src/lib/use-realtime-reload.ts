'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';

/**
 * Vuelve a cargar los datos de un provider cuando la tabla cambia en la base,
 * la haya cambiado quien la haya cambiado. Sirve para que el cajero de una
 * tablet vea el stock que acaba de bajar el de la otra.
 *
 * Se recarga entero en vez de aplicar el cambio que llega en el evento. Es una
 * consulta de mas, pero la alternativa —ir parcheando el estado local con cada
 * INSERT, UPDATE y DELETE— es donde viven los errores raros de "a mí me sale
 * otra cosa". Con el retardo de abajo, una venta de diez productos son diez
 * eventos y una sola consulta.
 */
const ESPERA_MS = 800;

/**
 * `tabla` puede ser una o varias: varias van en un solo canal y comparten la
 * espera, así un cambio que toca dos tablas (confirmar un comprobante crea el
 * pago) es una sola recarga.
 */
export function useRealtimeReload(
  tabla: string | string[],
  reload: () => void | Promise<void>,
  activo = true,
) {
  // El provider recrea `reload` cuando cambian sus dependencias; la suscripción
  // no debe rehacerse por eso, así que se lee siempre la última por referencia.
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);

  const tablas = (Array.isArray(tabla) ? tabla : [tabla]).join(',');

  useEffect(() => {
    if (!activo) return;
    let temporizador: ReturnType<typeof setTimeout> | null = null;

    const pedirRecarga = () => {
      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(() => { void reloadRef.current(); }, ESPERA_MS);
    };

    // Nombre único por suscripción: la misma tabla la puede escuchar más de una
    // pantalla a la vez (Cobros y el contador del menú), y supabase-js no deja
    // agregar escuchas a un canal ya suscrito con el mismo nombre.
    let canal = supabase.channel(`recargar:${tablas}:${Math.random().toString(36).slice(2)}`);
    for (const t of tablas.split(',')) {
      canal = canal.on('postgres_changes', { event: '*', schema: 'public', table: t }, pedirRecarga);
    }
    canal.subscribe();

    // El móvil corta la conexión cuando la app pasa a segundo plano, así que al
    // volver hay un hueco de eventos perdidos. Sin esto, el realtime deja de
    // servir justo en el aparato que más se deja en reposo.
    const alVolverAPrimerPlano = () => {
      if (document.visibilityState === 'visible') pedirRecarga();
    };
    document.addEventListener('visibilitychange', alVolverAPrimerPlano);

    return () => {
      if (temporizador) clearTimeout(temporizador);
      document.removeEventListener('visibilitychange', alVolverAPrimerPlano);
      supabase.removeChannel(canal);
    };
  }, [tablas, activo]);
}
