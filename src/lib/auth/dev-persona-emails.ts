import type { DevPersonaId } from '@/lib/auth/dev-personas';

// Seeded local-development accounts (db/seed-local-dev.sql). Only the
// /auth/dev route imports this, so the addresses stay out of client bundles.
const PERSONA_EMAILS: Record<DevPersonaId, string> = {
  staff: 'staff@turing-drive.com',
  manager: 'mgr@turing-drive.com',
  finance: 'finance@turing-drive.com',
  admin: 'dev@turing-drive.com',
};

export function getDevPersonaEmail(id: string | null | undefined): string | null {
  if (!id || !Object.hasOwn(PERSONA_EMAILS, id)) return null;
  return PERSONA_EMAILS[id as DevPersonaId];
}
