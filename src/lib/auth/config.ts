/**
 * Login configuration, validated once per process. Anything missing or unsafe
 * is a hard error: login is refused rather than silently falling back.
 */

export type AuthMode = 'manual';

export type AuthConfig = {
  /** Fixed public origin, e.g. https://accsys.example.com. Never taken from Host headers. */
  appOrigin: string;
  redirectUri: string;
  issuer: URL;
  /** Null until Google OAuth is configured; Google login then reports google_not_configured. */
  clientId: string | null;
  clientSecret: string | null;
  /** Lower-cased Google Workspace domains accepted in the `hd` claim and email. */
  allowedDomains: string[];
  mode: AuthMode;
  sessionTtlMs: number;
  loginStateTtlMs: number;
  /** Sensitive admin actions need a login at most this old. */
  recentAuthMs: number;
  secureCookies: boolean;
  sessionCookieName: string;
  loginCookieName: string;
  /** Header set by the trusted reverse proxy with the client IP (e.g. x-real-ip); unset = unknown. */
  clientIpHeader: string | null;
};

export class AuthConfigError extends Error {}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_SESSION_HOURS = 12;

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new AuthConfigError(`${name} is required`);
  return value;
}

export function parseAppOrigin(
  raw: string,
  nodeEnv: string | undefined,
  allowHttpLocalhost = false,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AuthConfigError('APP_ORIGIN must be an absolute URL');
  }
  if (url.origin !== raw.replace(/\/$/, '')) {
    throw new AuthConfigError('APP_ORIGIN must be an origin only (scheme://host[:port]), without path or query');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:') {
    // Plain http is only for localhost. Development always allows it; production
    // requires an explicit opt-in so `next start` can smoke-test on a laptop
    // before a real HTTPS deploy (never set ALLOW_HTTP_LOCALHOST on a shared host).
    const allowLocalHttp =
      url.protocol === 'http:' && local && (nodeEnv !== 'production' || allowHttpLocalhost);
    if (!allowLocalHttp) {
      throw new AuthConfigError('APP_ORIGIN must use https (plain http only for localhost during development)');
    }
  }
  return url;
}

function envFlag(env: Env, name: string): boolean {
  const v = env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function loadAuthConfig(env: Env = process.env): AuthConfig {
  const origin = parseAppOrigin(
    required(env, 'APP_ORIGIN'),
    env.NODE_ENV,
    envFlag(env, 'ALLOW_HTTP_LOCALHOST'),
  );

  const mode = required(env, 'AUTH_MODE');
  if (mode === 'directory') {
    throw new AuthConfigError('AUTH_MODE=directory needs the Workspace directory sync (P6); use AUTH_MODE=manual');
  }
  if (mode !== 'manual') throw new AuthConfigError(`AUTH_MODE must be "manual", got "${mode}"`);

  const domainsRaw = env.ALLOWED_GOOGLE_DOMAINS?.trim() || env.ALLOWED_GOOGLE_DOMAIN?.trim();
  if (!domainsRaw) throw new AuthConfigError('ALLOWED_GOOGLE_DOMAINS is required');
  const allowedDomains = domainsRaw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (allowedDomains.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) {
    throw new AuthConfigError('ALLOWED_GOOGLE_DOMAINS must be a comma-separated list of domain names');
  }

  const hours = Number(env.SESSION_TTL_HOURS?.trim() || '8');
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_SESSION_HOURS) {
    throw new AuthConfigError(`SESSION_TTL_HOURS must be between 0 and ${MAX_SESSION_HOURS}`);
  }

  const secret = required(env, 'SESSION_SECRET');
  if (secret.length < 32) throw new AuthConfigError('SESSION_SECRET must be at least 32 characters');

  const secure = origin.protocol === 'https:';
  const clientIpHeader = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase() || null;

  return {
    appOrigin: origin.origin,
    redirectUri: `${origin.origin}/auth/callback`,
    issuer: new URL(env.OIDC_ISSUER?.trim() || 'https://accounts.google.com'),
    clientId: env.GOOGLE_CLIENT_ID?.trim() || null,
    clientSecret: env.GOOGLE_CLIENT_SECRET?.trim() || null,
    allowedDomains,
    mode: 'manual',
    sessionTtlMs: hours * 3600_000,
    loginStateTtlMs: 10 * 60_000,
    recentAuthMs: 15 * 60_000,
    secureCookies: secure,
    // __Host- cookies are bound to this exact origin (Secure, Path=/, no Domain).
    sessionCookieName: secure ? '__Host-accsys_sid' : 'accsys_sid',
    loginCookieName: secure ? '__Host-accsys_login' : 'accsys_login',
    clientIpHeader,
  };
}

let cached: AuthConfig | undefined;

export function getAuthConfig(): AuthConfig {
  cached ??= loadAuthConfig();
  return cached;
}

/**
 * Cookie names without the rest of the config (src/proxy.ts runs before every
 * request). Over https only the __Host- cookie counts: a plain `accsys_sid`
 * can be planted from a sibling subdomain (cookie tossing).
 */
export function sessionCookieNames(env: Env = process.env): string[] {
  const https = env.APP_ORIGIN?.trim().toLowerCase().startsWith('https://') ?? false;
  return https ? ['__Host-accsys_sid'] : ['__Host-accsys_sid', 'accsys_sid'];
}

/** Pre-P2 iron-session cookie that carried only an email. Always discarded. */
export const LEGACY_SESSION_COOKIE = 'accsys_session';
