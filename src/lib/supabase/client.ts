import { createClient } from '@supabase/supabase-js';

// =============================================================================
// CLIENTE SUPABASE (scaffolding)
// -----------------------------------------------------------------------------
// Aún no se usa en la app: los providers funcionan con datos en memoria.
// Cuando creemos el proyecto Supabase y el esquema (con empresa_id + RLS):
//   1. Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local
//   2. Reemplaza el estado en memoria de los providers por consultas a este cliente.
//   3. Reemplaza la autenticación local (auth-provider.tsx) por supabase.auth.
// =============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
