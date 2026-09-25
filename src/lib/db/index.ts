import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getRequiredEnv } from '@/lib/env';
import * as schema from '@/lib/db/schema';

const globalForDb = globalThis as unknown as {
  accsysSql?: ReturnType<typeof postgres>;
};

function createSql() {
  return postgres(getRequiredEnv('DATABASE_URL'), {
    max: 10,
    prepare: false,
  });
}

export function getSql() {
  if (!globalForDb.accsysSql) {
    globalForDb.accsysSql = createSql();
  }
  return globalForDb.accsysSql;
}

export function getDb() {
  return drizzle(getSql(), { schema });
}

export type Db = ReturnType<typeof getDb>;
