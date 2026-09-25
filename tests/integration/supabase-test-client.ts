import { createAppDb } from '@/lib/db/app-client';

export function hasIntegrationTestCredentials(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.RUN_DB_INTEGRATION === '1');
}

export function createServiceRoleTestClient() {
  return createAppDb();
}

export function createAnonTestClient() {
  return createAppDb();
}
