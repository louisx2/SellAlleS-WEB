import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Manejar preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Variables de entorno del servidor no configuradas." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cliente con service_role para realizar acciones administrativas
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Validar autorización del usuario que realiza la petición
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autorizado. Token no proporcionado." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(token);

    if (callerError || !caller) {
      return new Response(
        JSON.stringify({ error: "Token de usuario inválido o expirado." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Consultar el perfil del invocador y sus roles personalizados
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select(`
        role, is_super_admin, company_id,
        profile_roles(roles(id, name, key))
      `)
      .eq("id", caller.id)
      .single();

    if (profileError || !callerProfile) {
      return new Response(
        JSON.stringify({ error: "No se pudo verificar el perfil del administrador." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isSuperAdmin = !!callerProfile.is_super_admin;
    const isAdmin = callerProfile.role === "admin";
    
    // Verificar si el invocador tiene un rol personalizado de Gerente
    const customRoles = (callerProfile.profile_roles ?? [])
      .map((pr: any) => pr.roles)
      .filter(Boolean);
    const isManager = customRoles.some((r: any) => 
      r.key === "manager" || 
      r.name?.toLowerCase().includes("gerente") ||
      r.name?.toLowerCase().includes("manager")
    );

    const callerCompanyId = callerProfile.company_id;

    if (!isSuperAdmin && !isAdmin && !isManager) {
      return new Response(
        JSON.stringify({ error: "Permisos insuficientes. Debes ser Administrador, Gerente o Super Admin." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parsear payload
    const { action, userId, password, companyId, name, email, role, branchId, branchIds, roleIds } = await req.json();

    if (!action) {
      return new Response(
        JSON.stringify({ error: "Acción requerida (action)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACCIÓN: SET_PASSWORD ---
    if (action === "set_password") {
      if (!userId || !password) {
        return new Response(
          JSON.stringify({ error: "userId y password son obligatorios." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Si no es super admin, verificar que el usuario objetivo pertenezca a la misma empresa
      if (!isSuperAdmin) {
        const { data: targetProfile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .single();

        if (!targetProfile || targetProfile.company_id !== callerCompanyId) {
          return new Response(
            JSON.stringify({ error: "No tienes permiso para modificar usuarios de otras empresas." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: password,
      });

      if (updateError) {
        return new Response(
          JSON.stringify({ error: `Error al actualizar contraseña: ${updateError.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ message: "Contraseña actualizada correctamente." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACCIÓN: DELETE ---
    if (action === "delete") {
      if (!userId) {
        return new Response(
          JSON.stringify({ error: "userId es obligatorio." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (userId === caller.id) {
        return new Response(
          JSON.stringify({ error: "No puedes eliminar tu propio usuario." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Si no es super admin, verificar que el usuario pertenezca a la misma empresa
      if (!isSuperAdmin) {
        const { data: targetProfile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .single();

        if (!targetProfile || targetProfile.company_id !== callerCompanyId) {
          return new Response(
            JSON.stringify({ error: "No tienes permiso para eliminar usuarios de otras empresas." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Eliminar de auth.users (el cascade en base de datos debería limpiar profiles, etc.,
      // pero para estar seguros se limpia auth.users usando el admin API)
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (deleteError) {
        return new Response(
          JSON.stringify({ error: `Error al eliminar usuario: ${deleteError.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Limpiar perfil explícitamente si la base de datos no tiene delete cascade
      await supabaseAdmin.from("profiles").delete().eq("id", userId);

      return new Response(
        JSON.stringify({ message: "Usuario eliminado correctamente." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACCIÓN: CREATE ---
    if (action === "create") {
      if (!email || !password || !name || !role || !companyId) {
        return new Response(
          JSON.stringify({ error: "Datos incompletos para crear el usuario." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validar permisos de empresa
      if (!isSuperAdmin && companyId !== callerCompanyId) {
        return new Response(
          JSON.stringify({ error: "No tienes permiso para crear usuarios en otra empresa." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 1. Crear el usuario en auth.users con correo confirmado automáticamente
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { name: name },
      });

      if (authError || !authData.user) {
        return new Response(
          JSON.stringify({ error: `Error al crear usuario en Auth: ${authError?.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newUserId = authData.user.id;

      // 2. Registrar el perfil (upsert, por si el trigger handle_new_user ya insertó una fila vacía)
      const isManagerRole = role === 'manager';
      const dbRole = isManagerRole ? 'cashier' : role; // base role is cashier for managers

      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert({
          id: newUserId,
          email: email,
          name: name,
          role: dbRole,
          company_id: companyId,
          branch_id: branchId || null,
          email_confirmed_at: new Date().toISOString(),
        });

      if (profileError) {
        // Limpiar usuario creado en Auth si falla el perfil
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return new Response(
          JSON.stringify({ error: `Error al crear el perfil de usuario: ${profileError.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const finalRoleIds = [...(roleIds || [])];

      // 3. Si es rol 'manager', buscar o crear el rol personalizado "Gerente"
      if (isManagerRole) {
        // Buscar si ya existe un rol "Gerente" en la empresa
        const { data: existingGerente } = await supabaseAdmin
          .from("roles")
          .select("id")
          .eq("company_id", companyId)
          .ilike("name", "%gerente%")
          .maybeSingle();

        let gerenteRoleId = existingGerente?.id;

        if (!gerenteRoleId) {
          // Crear el rol "Gerente" con todos los permisos excepto company-profile y suscripcion
          const defaultPermissions = {
            pos: ["view", "create", "edit", "delete"],
            caja: ["view", "create", "edit", "delete"],
            quotes: ["view", "create", "edit", "delete"],
            services: ["view", "create", "edit", "delete"],
            sales: ["view", "create", "edit", "delete"],
            credit: ["view", "create", "edit", "delete"],
            financing: ["view", "create", "edit", "delete"],
            prestamos: ["view", "create", "edit", "delete"],
            expenses: ["view", "create", "edit", "delete"],
            products: ["view", "create", "edit", "delete"],
            customers: ["view", "create", "edit", "delete"],
            suppliers: ["view", "create", "edit", "delete"],
            reports: ["view", "create", "edit", "delete"],
            users: ["view", "create", "edit", "delete"]
          };

          const { data: newRole, error: createRoleError } = await supabaseAdmin
            .from("roles")
            .insert({
              company_id: companyId,
              name: "Gerente",
              key: "manager",
              description: "Acceso y gestión de la sucursal (caja, préstamos, ventas, inventario, usuarios).",
              permissions: defaultPermissions,
              is_system: false
            })
            .select("id")
            .single();

          if (createRoleError) {
            console.error("Error al auto-crear el rol de Gerente:", createRoleError.message);
          } else {
            gerenteRoleId = newRole.id;
          }
        }

        if (gerenteRoleId && !finalRoleIds.includes(gerenteRoleId)) {
          finalRoleIds.push(gerenteRoleId);
        }
      }

      // 4. Insertar sucursales asociadas en profile_branches
      if (branchIds && branchIds.length > 0) {
        const branchInserts = branchIds.map((bId: string) => ({
          profile_id: newUserId,
          branch_id: bId,
          company_id: companyId,
        }));
        const { error: pbError } = await supabaseAdmin.from("profile_branches").insert(branchInserts);
        if (pbError) console.error("Error al registrar sucursales del perfil:", pbError.message);
      }

      // 5. Registrar roles personalizados en profile_roles
      if (finalRoleIds.length > 0) {
        const roleInserts = finalRoleIds.map((rId: string) => ({
          profile_id: newUserId,
          role_id: rId,
        }));
        const { error: prError } = await supabaseAdmin.from("profile_roles").insert(roleInserts);
        if (prError) console.error("Error al registrar roles del perfil:", prError.message);
      }

      return new Response(
        JSON.stringify({ message: "Usuario creado exitosamente.", userId: newUserId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Acción no reconocida." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
