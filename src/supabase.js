import { createClient } from '@supabase/supabase-js'

// Solo la anon key va en el frontend. La seguridad real la dan las políticas RLS del SQL.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
