import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getRequiredEnv } from '@/lib/env';
import * as schema from '@/lib/db/schema';

const globalForDb = globalThis as unknown as {
  accsysSql?: ReturnType<typeof postgres>;
};

// date, time, timestamp, timestamptz and their arrays stay as the strings
// PostgreSQL sends. Drizzle installs the same parsers on the client it wraps;
// setting them up front keeps the legacy app-client (which shares this client)
// from returning Date objects until the first getDb() call.
const RAW_TEMPORAL_TYPES = [1082, 1083, 1114, 1184, 1182, 1183, 1115, 1185];
const passthrough = (value: string) => value;

function createSql() {
  return postgres(getRequiredEnv('DATABASE_URL'), {
    max: 10,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 60,
    max_lifetime: 60 * 30,
    connection: { application_name: 'accsys-web' },
    types: Object.fromEntries(
      RAW_TEMPORAL_TYPES.map((oid) => [
        `temporal_${oid}`,
        { to: oid, from: [oid], parse: passthrough, serialize: (v: unknown) => v },
      ])
    ),
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
