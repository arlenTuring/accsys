import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveTestDatabaseUrl } from './test-database-url';

const resolved = resolveTestDatabaseUrl(process.env);
if (!resolved.ok) {
  throw new Error(resolved.error);
}

// App modules read DATABASE_URL; point them at the disposable test database.
process.env.DATABASE_URL = resolved.url;
// Integration tests must never send real mail.
delete process.env.SMTP_HOST;
// Attachment uploads go to a throwaway directory, never the real storage path.
process.env.STORAGE_LOCAL_PATH = mkdtempSync(path.join(tmpdir(), 'accsys-test-attachments-'));
