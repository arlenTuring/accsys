'use client';

import { createBrowserClient } from '@supabase/ssr';

// Next.js only inlines NEXT_PUBLIC_* vars into the browser bundle when they are
// referenced via static dot notation. A dynamic lookup (process.env[name], as in
// getRequiredEnv) is left as undefined in the browser, so these two must be read
// directly here rather than through the getRequiredEnv helper used server-side.
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }
  return createBrowserClient(url, anonKey);
}
