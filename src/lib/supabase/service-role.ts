import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getRequiredEnv } from '@/lib/env';

// Server-only. Uses the service-role key, which bypasses RLS — never import this
// from a 'use client' module. All approval-engine writes go through this client
// with authorization enforced in the calling server action.
export function createSupabaseServiceRoleClient(): SupabaseClient {
  return createClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
