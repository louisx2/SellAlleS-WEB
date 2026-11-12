// dgii-rnc: consulta un RNC o una cédula en la página pública de la DGII para
// llenar el nombre en Clientes, Suplidores y el carrito.
//
// Cuerpo: { rnc } (con o sin guiones). Lo puede pedir cualquier usuario con
// sesión. Responde 200 con la respuesta de `consultarRnc` (_shared/dgii/consulta.ts):
//   { ok: true, encontrado: true, datos, consultadoAt, desactualizado }
//   { ok: true, encontrado: false }
//   { ok: false, motivo: 'documento_invalido' | 'dgii_no_responde' }
//
// Lo consultado se guarda en dgii_contribuyentes (solo con la service role) y se
// reutiliza 30 días; si la DGII no responde, se devuelve lo último guardado. Un
// fallo de la DGII nunca es un 500: la pantalla sigue y el nombre se escribe a mano.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { consultarDgii } from '../_shared/dgii/rnc.ts';
import type { DatosDgii } from '../_shared/dgii/rnc.ts';
import { consultarRnc } from '../_shared/dgii/consulta.ts';
import type { DepsConsulta, FilaMemoria } from '../_shared/dgii/consulta.ts';

// x-impersonate-company va en la lista porque el cliente la manda mientras el
// super admin está dentro de una empresa (ver lib/supabase/client.ts).
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-impersonate-company',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface FilaTabla {
  rnc: string;
  encontrado: boolean;
  razon_social: string | null;
  nombre_comercial: string | null;
  categoria: string | null;
  regimen_pagos: string | null;
  estado: string | null;
  actividad_economica: string | null;
  administracion_local: string | null;
  facturador_electronico: boolean | null;
  consultado_at: string;
}

function aTabla(f: FilaMemoria): FilaTabla {
  const d = f.datos;
  return {
    rnc: f.rnc,
    encontrado: f.encontrado,
    razon_social: d?.razonSocial ?? null,
    nombre_comercial: d?.nombreComercial ?? null,
    categoria: d?.categoria ?? null,
    regimen_pagos: d?.regimenPagos ?? null,
    estado: d?.estado ?? null,
    actividad_economica: d?.actividadEconomica ?? null,
    administracion_local: d?.administracionLocal ?? null,
    facturador_electronico: d?.facturadorElectronico ?? null,
    consultado_at: f.consultadoAt,
  };
}

function deTabla(t: FilaTabla): FilaMemoria {
  const datos: DatosDgii | null = t.encontrado
    ? {
        rnc: t.rnc,
        razonSocial: t.razon_social ?? '',
        nombreComercial: t.nombre_comercial ?? '',
        categoria: t.categoria ?? '',
        regimenPagos: t.regimen_pagos ?? '',
        estado: t.estado ?? '',
        actividadEconomica: t.actividad_economica ?? '',
        administracionLocal: t.administracion_local ?? '',
        facturadorElectronico: t.facturador_electronico === true,
      }
    : null;
  return { rnc: t.rnc, encontrado: t.encontrado, datos, consultadoAt: t.consultado_at };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Método no permitido.' });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { ok: false, error: 'No autorizado.' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    const { data: quien, error: quienErr } = await admin.auth.getUser(token);
    if (quienErr || !quien?.user) return json(401, { ok: false, error: 'Sesión inválida.' });

    const body = await req.json().catch(() => null);
    const rnc = typeof body?.rnc === 'string' ? body.rnc : '';
    if (!rnc.trim()) return json(400, { ok: false, error: 'Falta el RNC o la cédula.' });

    const deps: DepsConsulta = {
      leerMemoria: async (d) => {
        const { data, error } = await admin.from('dgii_contribuyentes').select('*').eq('rnc', d).maybeSingle();
        if (error) throw new Error(error.message);
        return data ? deTabla(data as FilaTabla) : null;
      },
      guardarMemoria: async (f) => {
        const { error } = await admin.from('dgii_contribuyentes').upsert(aTabla(f), { onConflict: 'rnc' });
        if (error) throw new Error(error.message);
      },
      consultarDgii: (d) => consultarDgii(d, fetch),
      ahora: () => new Date(),
      registrar: (texto) => console.error(texto),
    };

    return json(200, await consultarRnc(rnc, deps));
  } catch (e) {
    console.error('dgii-rnc:', mensajeDe(e));
    return json(500, { ok: false, motivo: 'dgii_no_responde' });
  }
});
