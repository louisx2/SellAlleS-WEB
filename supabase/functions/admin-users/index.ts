// Edge Function: admin-users
// -----------------------------------------------------------------------------
// Punto único para acciones privilegiadas sobre usuarios (Auth Admin API), que
// solo pueden ejecutarse con la service_role key en el servidor:
//   invite | set-active | delete | reset-password | assign-company
//
// Seguridad:
//  - verify_jwt = true: exige un JWT válido del llamante.
//  - El llamante debe ser super_admin o admin. Un admin normal solo puede operar
//    sobre usuarios de SU MISMA empresa; el super_admin sobre cualquiera.
// -----------------------------------------------------------------------------
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Admin client (service_role): salta RLS, acceso a Auth Admin API.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Profile = {
  id: string;
  company_id: string | null;
  role: "admin" | "cashier";
  is_super_admin: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const origin = req.headers.get("Origin") ?? new URL(req.url).origin;
    const redirectTo = `${origin}/login`;

    // 1. Identificar al llamante a partir de su JWT.
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "No autenticado." }, 401);
    const callerId = userData.user.id;

    // 2. Cargar el perfil del llamante y autorizar.
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("id, company_id, role, is_super_admin")
      .eq("id", callerId)
      .maybeSingle<Profile>();

    if (!callerProfile) return json({ error: "Perfil no encontrado." }, 403);
    const isSuper = !!callerProfile.is_super_admin;
    const isAdmin = isSuper || callerProfile.role === "admin";
    if (!isAdmin) return json({ error: "No tienes permiso para esta acción." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    if (!action) return json({ error: "Falta 'action'." }, 400);

    // Verifica que el usuario objetivo pertenezca a la empresa del llamante
    // (salvo super_admin). Devuelve el perfil objetivo.
    async function loadTarget(userId: string): Promise<Profile | null> {
      const { data } = await admin
        .from("profiles")
        .select("id, company_id, role, is_super_admin")
        .eq("id", userId)
        .maybeSingle<Profile>();
      return data ?? null;
    }
    function sameCompanyOrSuper(target: Profile | null): boolean {
      if (isSuper) return true;
      return !!target && target.company_id === callerProfile.company_id;
    }

    switch (action) {
      // ------------------------------------------------------------------ invite
      case "invite": {
        const { email, name, role, roleId, branchIds } = body;
        const defaultBranchId = Array.isArray(branchIds) && branchIds.length > 0 ? branchIds[0] : null;
        if (!email || !name) return json({ error: "Email y nombre son obligatorios." }, 400);
        const companyId = isSuper ? (body.companyId ?? callerProfile.company_id) : callerProfile.company_id;
        if (!companyId) return json({ error: "No hay empresa asignada." }, 400);
        const userRole = role === "admin" ? "admin" : "cashier";

        // Límite de usuarios según el plan de la empresa.
        const { count } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        const { data: sub } = await admin
          .from("subscriptions")
          .select("plan_id")
          .eq("company_id", companyId)
          .maybeSingle<{ plan_id: string | null }>();
        if (sub?.plan_id) {
          const { data: plan } = await admin
            .from("plans")
            .select("max_users")
            .eq("id", sub.plan_id)
            .maybeSingle<{ max_users: number | null }>();
          if (plan?.max_users != null && (count ?? 0) >= plan.max_users) {
            return json(
              { error: `Límite de usuarios del plan alcanzado (${plan.max_users}).` },
              409,
            );
          }
        }

        const { data: invited, error: invErr } = await admin.auth.admin
          .inviteUserByEmail(email, { data: { name }, redirectTo });
        if (invErr) return json({ error: invErr.message }, 400);

        // El trigger handle_new_user ya creó la fila; la completamos.
        const { error: upErr } = await admin
          .from("profiles")
          .update({
            name,
            email,
            role: userRole,
            role_id: roleId ?? null,
            company_id: companyId,
            branch_id: defaultBranchId,
            is_active: true,
          })
          .eq("id", invited.user.id);
        if (upErr) return json({ error: upErr.message }, 400);

        if (Array.isArray(branchIds) && branchIds.length > 0) {
          const profileBranches = branchIds.map(bId => ({
            profile_id: invited.user.id,
            branch_id: bId,
            company_id: companyId,
          }));
          const { error: pbErr } = await admin.from("profile_branches").insert(profileBranches);
          if (pbErr) return json({ error: pbErr.message }, 400);
        }

        return json({ ok: true, userId: invited.user.id });
      }

      // -------------------------------------------------------------- set-active
      case "set-active": {
        const { userId, isActive } = body;
        if (!userId || typeof isActive !== "boolean")
          return json({ error: "Faltan 'userId' o 'isActive'." }, 400);
        const target = await loadTarget(userId);
        if (!sameCompanyOrSuper(target)) return json({ error: "No autorizado." }, 403);
        if (userId === callerId && !isActive)
          return json({ error: "No puedes desactivarte a ti mismo." }, 400);

        const { error: upErr } = await admin
          .from("profiles").update({ is_active: isActive }).eq("id", userId);
        if (upErr) return json({ error: upErr.message }, 400);
        // Bloquea/desbloquea el login a nivel de Auth.
        await admin.auth.admin.updateUserById(userId, {
          ban_duration: isActive ? "none" : "876000h",
        });
        return json({ ok: true });
      }

      // ------------------------------------------------------------------ delete
      case "delete": {
        const { userId } = body;
        if (!userId) return json({ error: "Falta 'userId'." }, 400);
        if (userId === callerId) return json({ error: "No puedes eliminarte a ti mismo." }, 400);
        const target = await loadTarget(userId);
        if (!sameCompanyOrSuper(target)) return json({ error: "No autorizado." }, 403);

        // No borrar al único admin activo de la empresa.
        if (target?.role === "admin" && target.company_id) {
          const { count } = await admin
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("company_id", target.company_id)
            .eq("role", "admin")
            .eq("is_active", true);
          if ((count ?? 0) <= 1)
            return json({ error: "No puedes eliminar al único administrador de la empresa." }, 400);
        }

        const { error: delErr } = await admin.auth.admin.deleteUser(userId);
        if (delErr) return json({ error: delErr.message }, 400);
        return json({ ok: true });
      }

      // ---------------------------------------------------------- reset-password
      case "reset-password": {
        const { email } = body;
        if (!email) return json({ error: "Falta 'email'." }, 400);
        // El objetivo debe existir y (salvo super) ser de la misma empresa.
        const { data: target } = await admin
          .from("profiles")
          .select("id, company_id, role, is_super_admin")
          .eq("email", email)
          .maybeSingle<Profile>();
        if (!sameCompanyOrSuper(target)) return json({ error: "No autorizado." }, 403);

        const anon = createClient(SUPABASE_URL, ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error: resErr } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
        if (resErr) return json({ error: resErr.message }, 400);
        return json({ ok: true });
      }

      // ---------------------------------------------------------- assign-company
      case "assign-company": {
        if (!isSuper) return json({ error: "Solo el super administrador puede asignar empresas." }, 403);
        const { userId, companyId, branchIds, role, roleId } = body;
        if (!userId || !companyId) return json({ error: "Faltan 'userId' o 'companyId'." }, 400);
        const defaultBranchId = Array.isArray(branchIds) && branchIds.length > 0 ? branchIds[0] : null;
        const patch: Record<string, unknown> = { company_id: companyId };
        if (defaultBranchId !== null) patch.branch_id = defaultBranchId;
        if (roleId !== undefined) patch.role_id = roleId;
        if (role) patch.role = role === "admin" ? "admin" : "cashier";
        const { error: upErr } = await admin.from("profiles").update(patch).eq("id", userId);
        if (upErr) return json({ error: upErr.message }, 400);

        if (Array.isArray(branchIds) && branchIds.length > 0) {
          await admin.from("profile_branches").delete().eq("profile_id", userId);
          const profileBranches = branchIds.map((bId: string) => ({
            profile_id: userId,
            branch_id: bId,
            company_id: companyId,
          }));
          const { error: pbErr } = await admin.from("profile_branches").insert(profileBranches);
          if (pbErr) return json({ error: pbErr.message }, 400);
        }
        return json({ ok: true });
      }

      default:
        return json({ error: `Acción desconocida: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? "Error inesperado." }, 500);
  }
});
