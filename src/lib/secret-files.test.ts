import { describe, expect, it } from 'vitest';
import { loadSecretFiles, SecretFileError } from './secret-files';

const files: Record<string, string> = {
  '/run/secrets/session': 's'.repeat(40) + '\n',
  '/run/secrets/db': 'postgres://accsys_app:pw@db:5432/accsys\r\n',
  '/run/secrets/empty': '\n',
};
const read = (path: string) => {
  if (!(path in files)) throw new Error('ENOENT');
  return files[path];
};

describe('loadSecretFiles', () => {
  it('fills secrets from files and strips the trailing newline', () => {
    const env: Record<string, string | undefined> = {
      SESSION_SECRET_FILE: '/run/secrets/session',
      DATABASE_URL_FILE: '/run/secrets/db',
    };
    expect(loadSecretFiles(env, read).sort()).toEqual(['DATABASE_URL', 'SESSION_SECRET']);
    expect(env.SESSION_SECRET).toBe('s'.repeat(40));
    expect(env.DATABASE_URL).toBe('postgres://accsys_app:pw@db:5432/accsys');
  });

  it('leaves the environment alone when no *_FILE is set', () => {
    const env = { SESSION_SECRET: 'inline' };
    expect(loadSecretFiles(env, read)).toEqual([]);
    expect(env.SESSION_SECRET).toBe('inline');
  });

  it('refuses a secret set both inline and as a file', () => {
    expect(() =>
      loadSecretFiles({ SESSION_SECRET: 'inline', SESSION_SECRET_FILE: '/run/secrets/session' }, read),
    ).toThrow(SecretFileError);
  });

  it('refuses unreadable and empty files without echoing the path contents', () => {
    expect(() => loadSecretFiles({ SESSION_SECRET_FILE: '/missing' }, read)).toThrow('cannot be read');
    expect(() => loadSecretFiles({ SESSION_SECRET_FILE: '/run/secrets/empty' }, read)).toThrow('is empty');
  });

  it('ignores *_FILE for names outside the allowlist', () => {
    const env: Record<string, string | undefined> = { APP_ORIGIN_FILE: '/run/secrets/session' };
    expect(loadSecretFiles(env, read)).toEqual([]);
    expect(env.APP_ORIGIN).toBeUndefined();
  });
});
