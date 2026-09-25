import { defineConfig } from 'drizzle-kit';

// Used only by `npm run db:generate` (schema.ts -> SQL files in drizzle/).
// Migrations are applied with `npm run db:migrate` (scripts/db-migrate.ts),
// which adds locking and checksum verification; do not use `drizzle-kit
// migrate` / `push` against a shared database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  strict: true,
});
