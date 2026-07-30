import { createClient } from 'jsr:@supabase/supabase-js@2';

// Acciones de admin sobre el portal público de un cliente (ver si activó su
// PIN, resetearlo). Mismo patrón que admin-user-actions: requiere JWT de una
// sesión real (admin de la empresa del cliente, o super admin).

// x-impersonate-company va en la lista porque el cliente la manda en TODAS sus
// peticiones mientras un super admin está dentro de una empresa (ver
// lib/supabase/client.ts). Si el preflight no la autoriza, el navegador bloquea
// la petición real: en el log se ve el OPTIONS y ningún POST, y al usuario le
// llega un "Failed to send a request to the Edge Function" que no dice nada.
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

function onlyDigits(s: string) {
  return (s || '').replace(/\D/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'No autorizado.' });

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !callerData?.user) return json(401, { error: 'Sesión inválida.' });
    const callerId = callerData.user.id;

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('is_super_admin, role, company_id')
      .eq('id', callerId)
      .single();
    if (!callerProfile) return json(403, { error: 'Perfil del solicitante no encontrado.' });

    const body = await req.json().catch(() => null);
    const action = body?.action;
    const customerId = body?.customerId;
    if (!customerId || (action !== 'status' && action !== 'reset_pin')) {
      return json(400, { error: 'Solicitud inválida.' });
    }

    const { data: customer, error: custErr } = await admin
      .from('customers')
      .select('id, company_id, rnc')
      .eq('id', customerId)
      .single();
    if (custErr || !customer) return json(404, { error: 'Cliente no encontrado.' });

    const isSuper = callerProfile.is_super_admin === true;
    const isCompanyAdmin =
      callerProfile.role === 'admin' &&
      !!callerProfile.company_id &&
      callerProfile.company_id === customer.company_id;
    if (!isSuper && !isCompanyAdmin) {
      return json(403, { error: 'No tienes permiso para esta acción.' });
    }

    const cedula = onlyDigits(customer.rnc ?? '');
    const cedulaValid = cedula.length === 11;

    if (action === 'status') {
      let hasPortalAccess = false;
      if (cedulaValid) {
        const { data: identity } = await admin
          .from('customer_portal_identities')
          .select('id')
          .eq('cedula', cedula)
          .maybeSingle();
        hasPortalAccess = !!identity;
      }
      return json(200, { cedulaValid, hasPortalAccess });
    }

    // action === 'reset_pin'
    if (!cedulaValid) {
      return json(400, { error: 'Este cliente no tiene una cédula válida (11 dígitos) cargada.' });
    }
    const newPin = String(body?.newPin ?? '').trim();
    if (!/^\d{6,}$/.test(newPin)) {
      return json(400, { error: 'El PIN debe tener al menos 6 dígitos.' });
    }

    const { error: upsertErr } = await admin.rpc('portal_upsert_pin', {
      p_cedula: cedula,
      p_pin: newPin,
    });
    if (upsertErr) return json(500, { error: 'No se pudo actualizar el PIN.' });

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
