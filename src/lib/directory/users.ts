/**
 * Google Workspace Directory users (read-only). Parses one `users.list` page
 * strictly: anything unexpected fails the page, and a failed page fails the
 * whole run, so a partial or foreign listing can never look like "these
 * people left".
 * https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list
 */

export type DirectoryUser = {
  /** Stable Google account ID; equals the OIDC `sub` of that account. */
  id: string;
  primaryEmail: string;
  fullName: string;
  suspended: boolean;
  archived: boolean;
  orgUnitPath: string | null;
  customerId: string | null;
  profile: DirectoryProfile;
};

/**
 * Descriptive attributes shown to an admin as suggestions. Malformed values
 * are dropped rather than failing the page: they never grant or revoke access.
 */
export type DirectoryProfile = {
  phone: string | null;
  title: string | null;
  department: string | null;
  employeeCode: string | null;
  managerEmail: string | null;
};

export type DirectoryScope = {
  /** Lower-cased domains of the company (ALLOWED_GOOGLE_DOMAINS). */
  allowedDomains: string[];
  /** The company's Workspace customer ID; null until the company confirms it. */
  customerId: string | null;
};

export type PageResult = { ok: true; users: DirectoryUser[]; nextPageToken: string | null } | { ok: false; error: string };

const ID = /^[0-9]{1,32}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUsersPage(body: unknown, scope: DirectoryScope): PageResult {
  if (!isObject(body)) return { ok: false, error: 'page is not a JSON object' };
  if (body.kind !== undefined && body.kind !== 'admin#directory#users') return { ok: false, error: 'unexpected response kind' };
  const token = body.nextPageToken;
  if (token !== undefined && (typeof token !== 'string' || token === '')) return { ok: false, error: 'invalid nextPageToken' };
  const raw = body.users ?? [];
  if (!Array.isArray(raw)) return { ok: false, error: 'users is not a list' };

  const users: DirectoryUser[] = [];
  for (const [i, u] of raw.entries()) {
    const at = `user #${i + 1}`;
    if (!isObject(u)) return { ok: false, error: `${at} is not an object` };
    if (typeof u.id !== 'string' || !ID.test(u.id)) return { ok: false, error: `${at} has no valid id` };
    if (typeof u.primaryEmail !== 'string') return { ok: false, error: `${at} has no primaryEmail` };
    const email = u.primaryEmail.trim().toLowerCase();
    const domain = email.split('@')[1] ?? '';
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !scope.allowedDomains.includes(domain)) {
      return { ok: false, error: `${at} is outside the company domains` };
    }
    if (scope.customerId !== null && u.customerId !== scope.customerId) return { ok: false, error: `${at} belongs to another customer` };
    if (u.suspended !== undefined && typeof u.suspended !== 'boolean') return { ok: false, error: `${at} has an invalid suspended flag` };
    if (u.archived !== undefined && typeof u.archived !== 'boolean') return { ok: false, error: `${at} has an invalid archived flag` };
    const name = isObject(u.name) && typeof u.name.fullName === 'string' ? u.name.fullName.trim() : '';
    users.push({
      id: u.id,
      primaryEmail: email,
      fullName: name,
      suspended: u.suspended === true,
      archived: u.archived === true,
      orgUnitPath: typeof u.orgUnitPath === 'string' ? u.orgUnitPath : null,
      customerId: typeof u.customerId === 'string' ? u.customerId : null,
      profile: parseProfile(u),
    });
  }
  return { ok: true, users, nextPageToken: typeof token === 'string' ? token : null };
}

const PROFILE_MAX = 200;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t.slice(0, PROFILE_MAX);
}

/** The primary entry of a Directory list attribute, else the first one of `preferredType`, else the first. */
function pick(list: unknown, preferredType?: string): Record<string, unknown> | null {
  if (!Array.isArray(list)) return null;
  const items = list.filter(isObject);
  return items.find((x) => x.primary === true) ?? items.find((x) => x.type === preferredType) ?? items[0] ?? null;
}

export function parseProfile(u: Record<string, unknown>): DirectoryProfile {
  const org = pick(u.organizations, 'work');
  const externalIds = Array.isArray(u.externalIds) ? u.externalIds.filter(isObject) : [];
  const manager = Array.isArray(u.relations) ? u.relations.filter(isObject).find((r) => r.type === 'manager') : undefined;
  const managerEmail = text(manager?.value)?.toLowerCase() ?? null;
  return {
    phone: text(pick(u.phones, 'work')?.value),
    title: text(org?.title),
    department: text(org?.department),
    employeeCode: text(externalIds.find((x) => x.type === 'organization')?.value),
    managerEmail: managerEmail && /^[^@\s]+@[^@\s]+$/.test(managerEmail) ? managerEmail : null,
  };
}

export type FetchPage = (pageToken: string | null) => Promise<{ status: number; body: unknown }>;
export type CollectResult = { ok: true; users: DirectoryUser[]; pages: number } | { ok: false; error: string };

const TRANSIENT = (status: number) => status === 429 || status >= 500;

/**
 * Reads every page. 429 / 5xx / network errors are retried a few times with
 * backoff; 401 / 403 and anything else stop the run. The result is complete or
 * an error, never a partial list.
 */
export async function collectDirectory(
  fetchPage: FetchPage,
  scope: DirectoryScope,
  options: { maxPages?: number; retries?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<CollectResult> {
  const maxPages = options.maxPages ?? 500;
  const retries = options.retries ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const byId = new Map<string, DirectoryUser>();
  const seenTokens = new Set<string>();
  let token: string | null = null;

  for (let page = 1; page <= maxPages; page++) {
    let response: { status: number; body: unknown } | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        response = await fetchPage(token);
      } catch {
        response = { status: 0, body: null };
      }
      if (response.status === 200 || !(response.status === 0 || TRANSIENT(response.status))) break;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
    if (!response || response.status !== 200) {
      const status = response?.status ?? 0;
      const kind = status === 401 || status === 403 ? 'not authorized' : status === 0 ? 'network error' : `HTTP ${status}`;
      return { ok: false, error: `page ${page}: ${kind}` };
    }
    const parsed = parseUsersPage(response.body, scope);
    if (!parsed.ok) return { ok: false, error: `page ${page}: ${parsed.error}` };
    for (const u of parsed.users) {
      if (byId.has(u.id)) return { ok: false, error: `page ${page}: account ${u.id} listed twice` };
      byId.set(u.id, u);
    }
    if (parsed.nextPageToken === null) return { ok: true, users: [...byId.values()], pages: page };
    if (seenTokens.has(parsed.nextPageToken)) return { ok: false, error: `page ${page}: page token repeats` };
    seenTokens.add(parsed.nextPageToken);
    token = parsed.nextPageToken;
  }
  return { ok: false, error: `more than ${maxPages} pages` };
}
