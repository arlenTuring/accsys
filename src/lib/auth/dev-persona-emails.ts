import type { DevPersonaId } from '@/lib/auth/dev-personas';

// Seeded Turing Drive real employee accounts for stage testing (db/seed-local-dev.sql & ensureStageTestAccounts).
// Only the /auth/dev route and server actions import this, so the addresses stay out of client bundles.
export const PERSONA_EMAILS: Record<DevPersonaId, string> = {
  staff: 'wayne@turing-drive.com',
  manager: 'nickyang@turing-drive.com',
  budget_owner: 'vic.c@turing-drive.com',
  new_custodian: 'jeter@turing-drive.com',
  new_manager: 'henry@turing-drive.com',
  general_affairs: 'ellen@turing-drive.com',
  finance: 'lucia@turing-drive.com',
  gm: 'david_shen@turing-drive.com',
  chairman: 'wlc@turing-drive.com',
  admin: 'ivan_wu@turing-drive.com',
};

export function getDevPersonaEmail(id: string | null | undefined): string | null {
  if (!id || !Object.hasOwn(PERSONA_EMAILS, id)) return null;
  return PERSONA_EMAILS[id as DevPersonaId];
}
