'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Flashlight, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

// Dos motores de lectura, en este orden:
//
// 1. `BarcodeDetector`, que el navegador trae de fábrica (Chrome en Android).
//    Lee en el proceso del navegador, no cuesta descarga y es el más rápido.
// 2. ZXing en JavaScript, para Safari/iOS, que no implementa el primero. Se
//    carga con `import()` solo cuando hace falta, así que un Android nunca
//    llega a descargar esos kilobytes.
//
// Los dos se envuelven en la misma forma (`Detector`) para que el resto del
// componente no sepa cuál está usando.

type CodigoDetectado = { rawValue: string };
type Detector = { detect(fuente: CanvasImageSource): Promise<CodigoDetectado[]> };

declare global {
  interface Window {
    BarcodeDetector?: new (opciones?: { formats?: string[] }) => Detector;
  }
}

// Los de retail primero. Los QR quedan fuera a propósito: en una caja, un QR
// pegado en el mostrador es publicidad, no un producto.
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

// Cada cuánto se mira un fotograma. Más rápido no lee mejor —solo calienta el
// teléfono— y más lento se siente trabado al pasar productos en fila. ZXing
// decodifica en JavaScript y bloquea el hilo mientras tanto, así que va más
// espaciado para que la imagen no se vea a tirones.
const INTERVALO_MS = { nativo: 120, zxing: 220 };

// Qué porción del alto del fotograma se decodifica, la franja que marca la mira
// en pantalla. Solo lo usa ZXing: recortar le ahorra la mayor parte del trabajo.
const FRANJA = 0.4;

// El detector devuelve el mismo código en cada fotograma mientras el producto
// siga delante de la cámara: sin esta ventana, un solo escaneo mete ocho
// unidades al carrito.
const REPETICION_MS = 1500;

type Estado = 'iniciando' | 'leyendo' | 'sin-soporte' | 'sin-permiso' | 'error';

export type ResultadoEscaneo = { ok: boolean; mensaje: string };

type Props = {
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  /** Se llama con cada código leído; lo que devuelva se muestra sobre la cámara. */
  onCodigo: (codigo: string) => ResultadoEscaneo;
};

type Motor = { detector: Detector; intervalo: number };

async function crearDetectorZXing(): Promise<Detector | null> {
  try {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);

    // Sin esta lista ZXing prueba todos los simbolismos que conoce en cada
    // fotograma, incluidos los que aquí no se venden.
    const pistas = new Map<number, unknown>();
    pistas.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
    ]);

    // `DecodeHintType` entra por `import()`, así que aquí es un valor y no un
    // tipo; el mapa se arma con números y se convierte al llamar.
    const lector = new BrowserMultiFormatReader(
      pistas as ConstructorParameters<typeof BrowserMultiFormatReader>[0]
    );
    const lienzo = document.createElement('canvas');
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    return {
      async detect(fuente) {
        const video = fuente as HTMLVideoElement;
        const ancho = video.videoWidth;
        const alto = video.videoHeight;
        if (!ancho || !alto) return [];

        const altoFranja = Math.max(1, Math.round(alto * FRANJA));
        const desde = Math.round((alto - altoFranja) / 2);
        if (lienzo.width !== ancho || lienzo.height !== altoFranja) {
          lienzo.width = ancho;
          lienzo.height = altoFranja;
        }
        ctx.drawImage(video, 0, desde, ancho, altoFranja, 0, 0, ancho, altoFranja);

        try {
          const valor = lector.decodeFromCanvas(lienzo)?.getText();
          return valor ? [{ rawValue: valor }] : [];
        } catch {
          // ZXing lanza NotFoundException en cada fotograma sin código, que es
          // la mayoría: aquí no encontrar nada es el caso normal, no un fallo.
          return [];
        }
      },
    };
  } catch {
    return null;
  }
}

async function crearMotor(): Promise<Motor | null> {
  if (typeof window === 'undefined') return null;

  if (window.BarcodeDetector) {
    try {
      return { detector: new window.BarcodeDetector({ formats: FORMATOS }), intervalo: INTERVALO_MS.nativo };
    } catch {
      // Algunos navegadores exponen el constructor pero revientan con esta
      // lista de formatos. Que caiga a ZXing en vez de quedarse sin escáner.
    }
  }

  const zxing = await crearDetectorZXing();
  return zxing ? { detector: zxing, intervalo: INTERVALO_MS.zxing } : null;
}

export function puedeEscanearConCamara(): boolean {
  if (typeof window === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  // Puntero grueso = teléfono o tableta. En un mostrador con lector láser el
  // botón solo estorbaría al lado de la barra de búsqueda.
  return window.matchMedia('(pointer: coarse)').matches;
}

export function BarcodeScannerDialog({ open, onOpenChange, onCodigo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const ultimoRef = useRef<{ codigo: string; ts: number } | null>(null);
  // El callback vive en un ref para que el efecto de la cámara dependa solo de
  // `open`: si dependiera de la función, cada render del padre apagaría y
  // volvería a encender la cámara.
  const onCodigoRef = useRef(onCodigo);
  onCodigoRef.current = onCodigo;

  const [estado, setEstado] = useState<Estado>('iniciando');
  const [tieneLinterna, setTieneLinterna] = useState(false);
  const [linternaEncendida, setLinternaEncendida] = useState(false);
  const [ultimo, setUltimo] = useState<(ResultadoEscaneo & { codigo: string; id: number }) | null>(null);

  const pitar = useCallback((ok: boolean) => {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioRef.current ?? (audioRef.current = new Ctx());
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gan = ctx.createGain();
      osc.frequency.value = ok ? 1760 : 220;
      gan.gain.setValueAtTime(0.0001, ctx.currentTime);
      gan.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
      gan.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      osc.connect(gan).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch {
      // Sin sonido se sigue viendo el aviso en pantalla; no vale abortar por esto.
    }
  }, []);

  const manejarLectura = useCallback(
    (valor: string) => {
      const codigo = valor.trim();
      if (!codigo) return;
      const ahora = Date.now();
      const previo = ultimoRef.current;
      if (previo && previo.codigo === codigo && ahora - previo.ts < REPETICION_MS) return;
      ultimoRef.current = { codigo, ts: ahora };

      const resultado = onCodigoRef.current(codigo);
      setUltimo({ ...resultado, codigo, id: ahora });
      pitar(resultado.ok);
      if (resultado.ok) navigator.vibrate?.(60);
    },
    [pitar]
  );

  useEffect(() => {
    if (!open) return;

    let vivo = true;
    let temporizador: number | undefined;

    setEstado('iniciando');
    setUltimo(null);
    setLinternaEncendida(false);
    setTieneLinterna(false);
    ultimoRef.current = null;

    const arrancar = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setEstado('sin-soporte');
        return;
      }
      // Antes de pedir la cámara: si no hay con qué decodificar, encenderla
      // sería prender el LED para nada.
      const motor = await crearMotor();
      if (!vivo) return;
      if (!motor) {
        setEstado('sin-soporte');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // `ideal` y no `exact`: en una tableta sin cámara trasera, `exact`
          // falla en vez de caer a la frontal.
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e) {
        if (!vivo) return;
        const nombre = (e as DOMException)?.name;
        setEstado(nombre === 'NotAllowedError' || nombre === 'SecurityError' ? 'sin-permiso' : 'error');
        return;
      }

      const video = videoRef.current;
      if (!vivo || !video) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Safari rechaza el play() si la pestaña pierde el foco justo aquí; el
        // fotograma llega igual cuando vuelve.
      }

      const pista = stream.getVideoTracks()[0];
      const capacidades = pista?.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined;
      if (vivo) {
        setTieneLinterna(Boolean(capacidades?.torch));
        setEstado('leyendo');
      }

      const leer = async () => {
        if (!vivo) return;
        // readyState < 2 es un fotograma que todavía no existe: detectarlo tira.
        if (video.readyState >= 2) {
          try {
            const codigos = await motor.detector.detect(video);
            if (vivo && codigos.length > 0) manejarLectura(codigos[0].rawValue);
          } catch {
            // Un fotograma borroso o movido hace fallar al detector. Es lo
            // normal mientras se busca el código; se reintenta en el siguiente.
          }
        }
        if (vivo) temporizador = window.setTimeout(leer, motor.intervalo);
      };
      void leer();
    };

    void arrancar();

    return () => {
      vivo = false;
      window.clearTimeout(temporizador);
      // Sin esto la cámara se queda encendida al cerrar el diálogo, con el LED
      // de la linterna prendido si estaba en uso.
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [open, manejarLectura]);

  useEffect(() => {
    return () => {
      void audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);

  const alternarLinterna = async () => {
    const pista = streamRef.current?.getVideoTracks()[0];
    if (!pista) return;
    const siguiente = !linternaEncendida;
    try {
      // `torch` no está en los tipos del DOM todavía, pero es como se enciende
      // la linterna en Android.
      await pista.applyConstraints({ advanced: [{ torch: siguiente }] } as unknown as MediaTrackConstraints);
      setLinternaEncendida(siguiente);
    } catch {
      setTieneLinterna(false);
    }
  };

  const mostrandoCamara = estado === 'iniciando' || estado === 'leyendo';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-w-lg sm:rounded-lg">
        <DialogHeader className="space-y-1 p-4 pr-12 text-left">
          <DialogTitle>Escanear producto</DialogTitle>
          <DialogDescription>
            Apunta la cámara al código de barras. Puedes escanear varios seguidos.
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex-1 overflow-hidden bg-black sm:aspect-[3/4] sm:flex-none">
          <video
            ref={videoRef}
            // `playsInline` es obligatorio: sin él iOS abre el video a pantalla
            // completa y se lleva por delante el diálogo.
            playsInline
            muted
            autoPlay
            className={cn('h-full w-full object-cover', !mostrandoCamara && 'hidden')}
          />

          {estado === 'leyendo' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-36 w-4/5 rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
            </div>
          )}

          {estado === 'iniciando' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-white">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Encendiendo la cámara...</p>
            </div>
          )}

          {!mostrandoCamara && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
              <TriangleAlert className="h-8 w-8 text-amber-400" />
              <p className="text-base font-medium">
                {estado === 'sin-permiso' && 'No hay permiso para usar la cámara'}
                {estado === 'sin-soporte' && 'No se pudo preparar el lector'}
                {estado === 'error' && 'No se pudo abrir la cámara'}
              </p>
              <p className="max-w-xs text-sm text-white/80">
                {estado === 'sin-permiso' &&
                  'Actívalo en los ajustes del navegador para este sitio y vuelve a intentarlo. Mientras tanto puedes escribir el código a mano.'}
                {estado === 'sin-soporte' &&
                  'La primera vez que se escanea en este dispositivo hace falta conexión para descargar el lector. Conéctate y vuelve a intentarlo, o escribe el código a mano.'}
                {estado === 'error' &&
                  'Puede estar en uso por otra aplicación. Ciérrala y vuelve a intentarlo.'}
              </p>
            </div>
          )}

          {ultimo && (
            <div
              key={ultimo.id}
              className={cn(
                'absolute inset-x-0 bottom-0 p-3 text-center text-sm font-medium text-white',
                ultimo.ok ? 'bg-emerald-600/90' : 'bg-destructive/90'
              )}
            >
              {ultimo.mensaje}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t bg-background p-4">
          {tieneLinterna && (
            <Button
              type="button"
              variant={linternaEncendida ? 'secondary' : 'outline'}
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={alternarLinterna}
            >
              <Flashlight className="h-5 w-5" />
              <span className="sr-only">
                {linternaEncendida ? 'Apagar la linterna' : 'Encender la linterna'}
              </span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1"
            onClick={() => onOpenChange(false)}
          >
            Listo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
