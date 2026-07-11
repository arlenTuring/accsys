import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createSupabaseServiceRoleClient', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { createSupabaseServiceRoleClient } = await import('./service-role');
    expect(() => createSupabaseServiceRoleClient()).toThrow(
      'Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY'
    );
  });

  it('returns a client when both env vars are set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    const { createSupabaseServiceRoleClient } = await import('./service-role');
    const client = createSupabaseServiceRoleClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });
});
