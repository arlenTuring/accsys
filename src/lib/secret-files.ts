/**
 * Secrets may be mounted as files (Docker Compose secrets) instead of being
 * passed as environment values: `SESSION_SECRET_FILE=/run/secrets/session_secret`
 * fills `SESSION_SECRET` from that file at process start.
 */
import { readFileSync } from 'node:fs';

export const SECRET_NAMES = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'SESSION_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'SMTP_PASSWORD',
] as const;

type Env = Record<string, string | undefined>;

export class SecretFileError extends Error {}

export function loadSecretFiles(
  env: Env = process.env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string[] {
  const loaded: string[] = [];
  for (const name of SECRET_NAMES) {
    const path = env[`${name}_FILE`]?.trim();
    if (!path) continue;
    if (env[name]?.trim()) {
      throw new SecretFileError(`${name} and ${name}_FILE are both set; keep only one`);
    }
    let value: string;
    try {
      value = read(path).replace(/\r?\n$/, '');
    } catch {
      throw new SecretFileError(`${name}_FILE cannot be read`);
    }
    if (!value.trim()) throw new SecretFileError(`${name}_FILE is empty`);
    env[name] = value;
    loaded.push(name);
  }
  return loaded;
}
