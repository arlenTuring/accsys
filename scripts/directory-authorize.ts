/**
 * One-time authorization of the directory sync (P6). A company Workspace
 * account with the least directory read privilege signs in once; the refresh
 * token is written to a secret file for the sync job. The token is never
 * printed.
 *
 *   GWS_DIRECTORY_CLIENT_ID=....apps.googleusercontent.com \
 *   GWS_DIRECTORY_CLIENT_SECRET_FILE=/etc/accsys/secrets/gws_directory_client_secret \
 *     npx tsx scripts/directory-authorize.ts --out /etc/accsys/secrets/gws_directory_refresh_token [--login-hint sync@company] [--force]
 *
 * Uses a "Desktop app" OAuth client: Google redirects to a one-shot listener
 * on 127.0.0.1 (open the printed URL in a browser on the same machine, or
 * forward the port over SSH). Only admin.directory.user.readonly is requested,
 * and a grant carrying anything more is refused.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { authorizationUrl, exchangeCode, pkcePair } from '../src/lib/directory/google';
import { loadSecretFiles } from '../src/lib/secret-files';

const WAIT_MS = 10 * 60 * 1000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadSecretFiles();
  const clientId = process.env.GWS_DIRECTORY_CLIENT_ID?.trim();
  const clientSecret = process.env.GWS_DIRECTORY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('GWS_DIRECTORY_CLIENT_ID and GWS_DIRECTORY_CLIENT_SECRET(_FILE) are required');
  const out = arg('out');
  if (!out) throw new Error('usage: directory-authorize.ts --out <secret file> [--port N] [--login-hint email] [--force]');
  const force = process.argv.includes('--force');
  if (existsSync(out) && !force) throw new Error(`${out} already exists; pass --force to replace it`);
  const port = Number(arg('port') ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be 0-65535');

  const state = randomBytes(24).toString('base64url');
  const { verifier, challenge } = pkcePair();

  const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let redirectUri = '';
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const done = (status: number, message: string) => {
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(message);
        clearTimeout(timer);
        server.close();
      };
      if (url.searchParams.get('state') !== state) {
        done(400, 'State mismatch; start again.');
        reject(new Error('the callback did not carry the expected state'));
        return;
      }
      const error = url.searchParams.get('error');
      const received = url.searchParams.get('code');
      if (error || !received) {
        done(400, 'Authorization was not granted.');
        reject(new Error(`authorization not granted (${error ?? 'no code'})`));
        return;
      }
      done(200, 'Authorization received. You can close this window.');
      resolve({ code: received, redirectUri });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('timed out waiting for the authorization'));
    }, WAIT_MS);
    server.listen(port, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
      console.log('Open this URL and sign in with the dedicated read-only Workspace account:\n');
      console.log(authorizationUrl({ clientId, redirectUri, state, codeChallenge: challenge, loginHint: arg('login-hint') }));
      console.log(`\nWaiting on ${redirectUri} (10 minutes)…`);
    });
  });

  const result = await exchangeCode(fetch, { clientId, clientSecret, code: code.code, redirectUri: code.redirectUri, codeVerifier: verifier });
  if (!result.ok) throw new Error(result.error);
  writeFileSync(out, `${result.refreshToken}\n`, { mode: 0o600, flag: force ? 'w' : 'wx' });
  chmodSync(out, 0o600);
  console.log(`Saved the refresh token to ${out} (mode 0600). Point GWS_DIRECTORY_REFRESH_TOKEN_FILE at it for the sync job.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
