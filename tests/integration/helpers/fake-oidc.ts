import { createHash, randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload, type CryptoKey } from 'jose';
import type { CustomFetch } from 'openid-client';

/**
 * In-process stand-in for Google's OIDC endpoints, reached through
 * openid-client's customFetch hook (no network). It behaves like the real
 * provider where it matters for the tests: PKCE is verified, authorization
 * codes are single-use, and redirect_uri must match the registered value.
 */
export const FAKE_ISSUER = 'https://idp.test';
export const FAKE_CLIENT_ID = 'accsys-test-client';
export const FAKE_CLIENT_SECRET = 'accsys-test-secret';

type IssuedCode = {
  claims: JWTPayload;
  codeChallenge: string;
  redirectUri: string;
  signWith: 'provider' | 'attacker';
  used: boolean;
};

export class FakeOidcProvider {
  private providerKey!: CryptoKey;
  private attackerKey!: CryptoKey;
  private jwks!: { keys: object[] };
  private codes = new Map<string, IssuedCode>();
  readonly tokenRequests: URLSearchParams[] = [];

  static async create(): Promise<FakeOidcProvider> {
    const p = new FakeOidcProvider();
    const provider = await generateKeyPair('RS256');
    const attacker = await generateKeyPair('RS256');
    p.providerKey = provider.privateKey;
    p.attackerKey = attacker.privateKey;
    const jwk = await exportJWK(provider.publicKey);
    p.jwks = { keys: [{ ...jwk, kid: 'provider-key', alg: 'RS256', use: 'sig' }] };
    return p;
  }

  /** Simulates the user completing consent: returns a code bound to the auth request. */
  issueCode(
    authorizationUrl: URL,
    claims: JWTPayload,
    options: { signWith?: 'provider' | 'attacker'; redirectUri?: string } = {}
  ): string {
    const code = `code-${randomUUID()}`;
    this.codes.set(code, {
      claims,
      codeChallenge: authorizationUrl.searchParams.get('code_challenge')!,
      redirectUri: options.redirectUri ?? authorizationUrl.searchParams.get('redirect_uri')!,
      signWith: options.signWith ?? 'provider',
      used: false,
    });
    return code;
  }

  readonly fetch: CustomFetch = async (url, options) => {
    const u = new URL(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (u.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: FAKE_ISSUER,
        authorization_endpoint: `${FAKE_ISSUER}/authorize`,
        token_endpoint: `${FAKE_ISSUER}/token`,
        jwks_uri: `${FAKE_ISSUER}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      });
    }
    if (u.pathname === '/jwks') return json(this.jwks);
    if (u.pathname === '/token') {
      const raw = options.body;
      const body =
        raw instanceof URLSearchParams
          ? raw
          : new URLSearchParams(typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array));
      this.tokenRequests.push(body);
      const issued = this.codes.get(body.get('code') ?? '');
      const verifier = body.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (
        !issued ||
        issued.used ||
        body.get('client_id') !== FAKE_CLIENT_ID ||
        body.get('client_secret') !== FAKE_CLIENT_SECRET ||
        body.get('redirect_uri') !== issued.redirectUri ||
        challenge !== issued.codeChallenge
      ) {
        return json({ error: 'invalid_grant' }, 400);
      }
      issued.used = true;
      const idToken = await new SignJWT(issued.claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'provider-key' })
        .sign(issued.signWith === 'provider' ? this.providerKey : this.attackerKey);
      return json({ access_token: 'unused', token_type: 'Bearer', expires_in: 3600, id_token: idToken });
    }
    return json({ error: 'not_found' }, 404);
  };
}
