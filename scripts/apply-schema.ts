import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });
config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (set in .env.local)');
  process.exit(1);
}
const DATABASE_URL: string = databaseUrl;

const schemaPath = resolve(process.cwd(), 'db/schema.sql');
const sqlText = readFileSync(schemaPath, 'utf8');

async function main() {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    await sql.unsafe(sqlText);
    console.log(`Applied schema from ${schemaPath}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
