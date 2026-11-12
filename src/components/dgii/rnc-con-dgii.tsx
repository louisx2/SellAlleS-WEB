'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCedulaOrRnc } from '@/lib/format';
import { consultarRncDgii } from '@/lib/dgii-client';
import { digitosDeDocumento, documentoValido, respuestaVigente, type DatosRnc, type RespuestaRnc } from '@/lib/rnc';
import { cn } from '@/lib/utils';

// Campo de RNC o cédula que consulta la DGII cuando el documento está completo
// (9 u 11 dígitos con su dígito verificador), una sola vez por documento y un
// momento después de la última tecla. Debajo dice qué encontró. Lo que hace cada
// pantalla con los datos (llenar el nombre, el tipo de comprobante) lo decide ella
// con `onDatos`. Nunca bloquea nada: si la DGII no responde, se escribe a mano.

const ESPERA_MS = 400;

type Estado =
  | { tipo: 'nada' }
  | { tipo: 'invalido' }
  | { tipo: 'buscando' }
  | { tipo: 'respuesta'; respuesta: RespuestaRnc };

interface RncConDgiiProps {
  id: string;
  value: string;
  onChange: (valor: string) => void;
  /** Lo que encontró la DGII, cuando lo encuentra. */
  onDatos?: (datos: DatosRnc) => void;
  /** Un nombre que la pantalla quiere ofrecer (no lo puso sola porque ya había otro). */
  ofrecerNombre?: string;
  onUsarNombre?: (nombre: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}

/** "SUSPENDIDO" -> "Suspendido", "DADO DE BAJA" -> "Dado de baja". */
function estadoLegible(estado: string): string {
  const e = estado.trim().toLowerCase();
  return e ? e[0].toUpperCase() + e.slice(1) : 'Sin estado';
}

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function RncConDgii({
  id,
  value,
  onChange,
  onDatos,
  ofrecerNombre,
  onUsarNombre,
  disabled,
  autoFocus,
  placeholder = '000-0000000-0',
  className,
}: RncConDgiiProps) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'nada' });
  // El último documento que se mandó a consultar: no se repite mientras el campo
  // siga teniendo ese mismo documento.
  const consultado = useRef('');
  const valorActual = useRef(value);
  valorActual.current = value;
  const onDatosRef = useRef(onDatos);
  onDatosRef.current = onDatos;

  useEffect(() => {
    const digitos = digitosDeDocumento(value);
    if (digitos.length !== 9 && digitos.length !== 11) {
      consultado.current = '';
      setEstado({ tipo: 'nada' });
      return;
    }
    if (!documentoValido(digitos)) {
      consultado.current = '';
      setEstado({ tipo: 'invalido' });
      return;
    }
    if (consultado.current === digitos) return;

    const espera = setTimeout(() => {
      consultado.current = digitos;
      setEstado({ tipo: 'buscando' });
      consultarRncDgii(digitos).then((respuesta) => {
        // El campo cambió mientras se consultaba: esta respuesta ya no le toca.
        if (!respuestaVigente(digitos, valorActual.current)) return;
        setEstado({ tipo: 'respuesta', respuesta });
        if (respuesta.ok && respuesta.encontrado) onDatosRef.current?.(respuesta.datos);
      });
    }, ESPERA_MS);
    return () => clearTimeout(espera);
  }, [value]);

  return (
    <div className={cn('space-y-1.5', className)}>
      <Input
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(formatCedulaOrRnc(e.target.value))}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <LineaDeEstado estado={estado} />
      {ofrecerNombre && onUsarNombre && (
        <Button type="button" size="sm" variant="outline" onClick={() => onUsarNombre(ofrecerNombre)}>
          Usar este nombre
        </Button>
      )}
    </div>
  );
}

function LineaDeEstado({ estado }: { estado: Estado }) {
  if (estado.tipo === 'nada') return null;

  if (estado.tipo === 'buscando') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando en la DGII…
      </p>
    );
  }

  const r = estado.tipo === 'invalido' ? ({ ok: false, motivo: 'documento_invalido' } as const) : estado.respuesta;

  if (!r.ok) {
    return r.motivo === 'documento_invalido' ? (
      <p className="text-xs text-amber-600 dark:text-amber-400">El RNC no es válido (dígito verificador)</p>
    ) : (
      <p className="text-xs text-muted-foreground">No se pudo consultar la DGII ahora</p>
    );
  }

  if (!r.encontrado) return <p className="text-xs text-muted-foreground">No aparece en la DGII</p>;

  const { datos } = r;
  const activo = datos.estado === 'ACTIVO';
  const fecha = r.desactualizado ? fechaCorta(r.consultadoAt) : '';
  return (
    <div className="space-y-0.5 text-xs">
      {activo ? (
        <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            {datos.razonSocial} · Activo{datos.facturadorElectronico ? ' · Facturador electrónico' : ''}
            {fecha && <span className="text-muted-foreground"> (dato del {fecha})</span>}
          </span>
        </p>
      ) : (
        <>
          <p className="font-medium text-amber-600 dark:text-amber-400">
            ⚠ {estadoLegible(datos.estado)} en la DGII: no conviene emitirle comprobante fiscal
          </p>
          <p className="text-muted-foreground">
            {datos.razonSocial}
            {fecha && ` (dato del ${fecha})`}
          </p>
        </>
      )}
      {datos.nombreComercial && datos.nombreComercial !== datos.razonSocial && (
        <p className="text-muted-foreground">Nombre comercial: {datos.nombreComercial}</p>
      )}
    </div>
  );
}
