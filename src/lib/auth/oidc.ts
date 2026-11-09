import * as client from 'openid-client';
import { AuthConfigError, type AuthConfig } from '@/lib/auth/config';
import { saveUserDriveOAuthTokens } from '@/lib/projects/drive-doc-writer';

export type VerifiedGoogleIdentity = {
  issuer: string;
  subject: string;
  email: string;
  name: string | null;
};

export class LoginRejected extends Error {
  constructor(readonly code: 'auth_failed' | 'email_unverified' | 'domain_not_allowed') {
    super(code);
  }
}

let configuration: { promise: Promise<client.Configuration>; loadedAt: number; key: string } | undefined;
let fetchOverride: client.CustomFetch | undefined;

/** Tests route discovery/JWKS/token requests to an in-process fake provider. */
export function __setOidcFetchForTests(fn: client.CustomFetch | undefined): void {
  fetchOverride = fn;
  configuration = undefined;
}

export class GoogleNotConfigured extends AuthConfigError {}

async function getConfiguration(cfg: AuthConfig): Promise<client.Configuration> {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new GoogleNotConfigured('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
  }
  const clientId = cfg.clientId;
  const clientSecret = cfg.clientSecret;
  const key = `${cfg.issuer.href}|${clientId}`;
  const fresh = configuration && configuration.key === key && Date.now() - configuration.loadedAt < 3600_000;
  if (!fresh) {
    const promise = client
      .discovery(cfg.issuer, clientId, undefined, client.ClientSecretPost(clientSecret), {
        timeout: 10,
        ...(fetchOverride ? { [client.customFetch]: fetchOverride } : {}),
      })
      .then((config) => {
        if (fetchOverride) config[client.customFetch] = fetchOverride;
        // Verify the ID token signature against the provider's JWKS as well,
        // not only the TLS channel to the token endpoint.
        client.enableNonRepudiationChecks(config);
        return config;
      });
    configuration = { promise, loadedAt: Date.now(), key };
    promise.catch(() => {
      if (configuration?.promise === promise) configuration = undefined;
    });
  }
  return configuration!.promise;
}

export type LoginChecks = { state: string; nonce: string; codeVerifier: string };

export type AuthorizeOptions = {
  loginHint?: string;
  prompt?: 'select_account' | 'none' | 'consent' | 'omit';
};

export async function buildAuthorizationUrl(
  cfg: AuthConfig,
  checks: LoginChecks,
  opts?: AuthorizeOptions
): Promise<URL> {
  const config = await getConfiguration(cfg);
  const promptVal = opts?.prompt ?? 'select_account';
  return client.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: 'openid email profile https://www.googleapis.com/auth/drive',
    state: checks.state,
    nonce: checks.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(checks.codeVerifier),
    code_challenge_method: 'S256',
    ...(promptVal !== 'omit' ? { prompt: promptVal } : {}),
    ...(opts?.loginHint ? { login_hint: opts.loginHint } : {}),
    access_type: 'offline',
    include_granted_scopes: 'true',
    // Only a hint for Google's account chooser; the hd claim is verified below.
    hd: cfg.allowedDomains.length === 1 ? cfg.allowedDomains[0] : '*',
  });
}

export function newLoginChecks(): LoginChecks {
  return {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier: client.randomPKCECodeVerifier(),
  };
}

/**
 * Exchanges the authorization code (PKCE) and returns the verified identity.
 * openid-client checks state, the ID token signature, iss, aud, exp/iat and
 * nonce; the Workspace-specific rules are enforced here.
 */
export async function exchangeCode(
  cfg: AuthConfig,
  callbackUrl: URL,
  checks: LoginChecks
): Promise<VerifiedGoogleIdentity> {
  const config = await getConfiguration(cfg);
  let claims: client.IDToken | undefined;
  let rawAccessToken: string | undefined;
  let rawRefreshToken: string | undefined;
  let rawExpiresIn: number | undefined;
  try {
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    claims = tokens.claims();
    rawAccessToken = typeof tokens.access_token === 'string' ? tokens.access_token : undefined;
    rawRefreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined;
    rawExpiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : undefined;
  } catch (err) {
    console.warn('[auth] authorization code exchange rejected:', err instanceof Error ? err.name : 'error');
    throw new LoginRejected('auth_failed');
  }
  if (!claims || typeof claims.sub !== 'string' || claims.sub === '') throw new LoginRejected('auth_failed');

  if (claims.email_verified !== true) throw new LoginRejected('email_unverified');
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const emailDomain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
  const hd = typeof claims.hd === 'string' ? claims.hd.toLowerCase() : '';
  // `hd` is only present for Workspace accounts; consumer Gmail never has it.
  if (!hd || !cfg.allowedDomains.includes(hd) || !cfg.allowedDomains.includes(emailDomain)) {
    throw new LoginRejected('domain_not_allowed');
  }

  if (rawAccessToken && rawAccessToken !== 'unused') {
    saveUserDriveOAuthTokens({
      email,
      accessToken: rawAccessToken,
      refreshToken: rawRefreshToken,
      expiresInSeconds: rawExpiresIn,
    });
  }

  return {
    issuer: claims.iss,
    subject: claims.sub,
    email,
    name: typeof claims.name === 'string' ? claims.name : null,
  };
}
