# Prompt: Roles por empresa/sucursal (multi-tenant real)

Pega esto en una sesión nueva de Claude Code dentro de este repo para retomar el trabajo.

---

## Contexto del problema

En SellAlleS-WEB (proyecto Supabase `qwpjclqinruhtxgkrxwr`, empresa de ejemplo `Inventar.IO`), el rol de un usuario (`admin`, `cajero`, etc.) vive en una sola columna `profiles.role`, ligada a una sola `profiles.company_id` ("empresa activa"). Esto se descubrió como limitación real al intentar mover a un usuario (`destroger1@gmail.com`) de una empresa a otra: era el único admin de su empresa de origen ("PRUEBAS Multi-Empresa"), y un trigger de seguridad (`prevent_last_admin_lockout`) bloqueó el cambio porque, al cambiar `company_id`, el sistema interpreta que "deja de ser admin" de la empresa vieja — aunque conceptualmente el usuario solo estaba cambiando cuál empresa está viendo en ese momento, no renunciando a nada.

El usuario mismo lo resumió así: **"la idea real de cómo debería funcionar es que se pueda ser admin en más de una sucursal o empresa."**

Ah(ahora) mismo eso no es posible: el rol no está por-empresa, está por-perfil.

## Esquema actual relevante (verificado en la BD real, no en el borrador de docs/03-MODELO-DE-DATOS.md)

```sql
-- Una fila por usuario. role y company_id son "la empresa/rol activos ahora mismo".
profiles (
  id uuid primary key references auth.users(id),
  company_id uuid references companies(id),   -- empresa "activa"
  branch_id uuid references branches(id),     -- sucursal "activa"
  role user_role not null default 'admin',    -- rol GLOBAL del perfil, no por empresa
  role_id uuid references roles(id),          -- FK a tabla roles (existe pero infrautilizada)
  is_super_admin boolean not null default false,
  is_active boolean not null default true,
  ...
)

-- Lista de empresas a las que un perfil TIENE acceso (multi-empresa)
profile_companies (profile_id uuid, company_id uuid, created_at)

-- Lista de sucursales a las que un perfil tiene acceso, con company_id denormalizado
profile_branches (profile_id uuid, branch_id uuid, company_id uuid default current_company_id(), created_at)

-- Roles personalizados POR EMPRESA (ya existe la tabla, pero profiles.role la ignora en la práctica)
roles (id uuid, company_id uuid default current_company_id(), name text, description text,
       permissions jsonb default '{}', is_system boolean default false, key text)

profile_roles (profile_id uuid, role_id uuid, created_at)
```

Funciones clave:
- `current_company_id()` → `coalesce(impersonated_company_id(), profiles.company_id)`. Para usuarios normales (no super admin), `impersonated_company_id()` nunca se usa de verdad — solo `profiles.company_id`.
- `is_company_admin()` — probablemente lee `profiles.role = 'admin' and current_company_id() = profiles.company_id` (revisar definición exacta con `select pg_get_functiondef(oid) from pg_proc where proname='is_company_admin'`).
- `user_branch_ids()` → `select branch_id from profile_branches where profile_id = auth.uid()`.

Triggers en `public.profiles` que dependen de este modelo:
- `trg_check_profile_company_access` (función `check_profile_company_access()`): valida que, al cambiar `company_id`, el usuario tenga ya una fila en `profile_companies` para la empresa destino (auto-servicio), o que quien ejecuta sea admin/super-admin de la empresa destino (alta de otro perfil).
- `trg_prevent_last_admin_lockout` (función `prevent_last_admin_lockout()`): impide que un perfil deje de ser `role='admin' and is_active and company_id=X` (por cambio de rol, desactivación, o **cambio de `company_id`**) si es el único admin activo no-super-admin de esa empresa `X`.
- `trg_check_company_user_limit`, `trg_sync_profile_companies` — revisar también, probablemente relacionados (`sync_profile_companies()` sincroniza `profile_companies` cuando cambia `profiles.company_id`, hay que ver el detalle).

Frontend (repo `SellAlleS-WEB/src`):
- `src/context/auth-provider.tsx` — `setImpersonatedCompany()` (líneas ~338-396): para usuarios multi-empresa NO super-admin, hace `UPDATE profiles SET company_id=..., branch_id=null` directo (no es impersonación real, es cambio de fila). Redirige a `/admin/empresas` si `appUser.companies.length > 1` tras login (líneas ~313-333). `loadProfile` (líneas ~99-113) arma `appUser.branches` combinando `profiles.branch_id` + `profile_branches`.
- `src/app/(app)/admin/empresas/page.tsx` — página "Mis Empresas", tabla `CompaniesDataTable` con botón "Entrar" que llama `setImpersonatedCompany`.
- `src/context/branch-provider.tsx` — `useBranches()` consulta `branches` filtrado solo por `company_id = appUser?.impersonatedCompanyId || appUser?.companyId`, sin usar `profile_branches` — es decir, la lista de sucursales de la página de administración NO está restringida por sucursal, solo por empresa (cualquier usuario de la empresa ve todas sus sucursales ahí). El selector de sucursal de trabajo al iniciar sesión sí usa `profile_branches`.

## Qué se rompe hoy, concretamente

1. Un usuario que administra dos empresas no puede tener rol distinto en cada una (ej. admin en la A, cajero en la B) — el rol es uno solo, global.
2. Cambiar de "empresa activa" (el único mecanismo de multi-empresa que existe) puede fallar con `prevent_last_admin_lockout` si eras el único admin de la empresa que dejas — incluso si tu intención es solo "estoy viendo otra empresa ahora", no abandonarla.
3. No hay forma de ver/gestionar, desde la UI, "en qué empresas soy admin vs. en cuáles soy solo cajero" — todo se infiere de una sola fila.

## Objetivo de este trabajo

Rediseñar el modelo para que **rol y permisos sean por relación perfil↔empresa (y opcionalmente perfil↔sucursal), no por perfil global**. Concretamente:

1. Decidir dónde vive el rol por-empresa: ¿ampliar `profile_companies` con una columna `role`/`role_id`, o depender de `profile_roles` + `roles` (que ya son company-scoped) y dejar de usar `profiles.role` como fuente de verdad?
2. `profiles.company_id` / `profiles.branch_id` deberían pasar a ser puramente **"cuál es la empresa/sucursal que estoy viendo ahora"** (preferencia de sesión/UI), completamente desacoplado de si soy o no admin ahí — el rol se consulta contra `profile_companies`/`profile_roles` para la empresa que sea, no contra el rol "activo".
3. Reescribir `is_company_admin()` y cualquier política RLS que use `profiles.role` para que resuelvan el rol correcto según la empresa que se está consultando (probablemente vía `current_company_id()` + join a la nueva tabla de rol-por-empresa), no según `profiles.role` a secas.
4. Reescribir `prevent_last_admin_lockout()` para que la validación de "no dejar una empresa sin admin" se dispare sobre cambios reales de rol/pertenencia (INSERT/UPDATE/DELETE en la tabla de rol-por-empresa), no sobre el cambio de `profiles.company_id` (que ya no debería significar nada sobre el rol).
5. Actualizar `check_profile_company_access()` en consecuencia (probablemente se simplifica mucho, o se elimina, si `company_id` deja de tener implicaciones de permisos).
6. Frontend: `setImpersonatedCompany` deja de tocar nada relacionado a rol; sigue actualizando `company_id`/`branch_id` como preferencia de sesión. Cualquier lugar que lea `appUser.role` para decidir permisos necesita resolverlo contra la empresa actualmente vista, no contra un campo plano.
7. Migración de datos: por cada fila existente en `profiles`, crear la fila equivalente en la nueva tabla de rol-por-empresa usando su `(company_id, role)` actual como semilla, para no perder permisos de nadie en el cambio.

## Cómo abordarlo

Esto toca RLS, triggers, y frontend a la vez — alto riesgo de romper acceso si se hace a ciegas. Sugerido:
1. Empezar en modo **plan** (no implementar directo): mapear TODAS las políticas RLS y funciones que referencian `profiles.role` o `is_company_admin()` en el proyecto Supabase (`qwpjclqinruhtxgkrxwr`) antes de tocar nada — `select * from pg_policies` filtrando por definiciones que mencionen `role` o `is_company_admin`.
2. Diseñar el esquema nuevo y las funciones nuevas primero, con los nombres de función actuales conservados si es posible (para no tener que tocar cada política RLS una por una) — es decir, cambiar el *cuerpo* de `is_company_admin()` para que lea la tabla nueva, en vez de renombrar todo.
3. Aplicar como migración de Supabase (`apply_migration`), con backfill de datos incluido en la misma migración.
4. Actualizar el frontend después, y probar el flujo completo de cambio de empresa con un usuario multi-empresa real (ej. `destroger1@gmail.com`, que ya tiene acceso a 4 empresas: Inventar.IO, SellAlleS Store DEMO, PRUEBAS Multi-Empresa, Pujols Group EIRL).
