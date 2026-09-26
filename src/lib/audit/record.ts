import { auditEvents } from '@/lib/db/schema';
import type { Db } from '@/lib/db';

type Tx = Pick<Db, 'insert'>;

export type AuditEvent = {
  actorEmployeeId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
};

// Keys whose values must never be stored in the audit trail.
const FORBIDDEN_KEY = /token|secret|password|verifier|nonce|cookie|bank_?account|authorization/i;

export function redactAuditDetails(details: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (FORBIDDEN_KEY.test(key)) {
      out[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactAuditDetails(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Appends one audit event. Call inside the same transaction as the change it describes. */
export async function recordAudit(tx: Tx, event: AuditEvent): Promise<void> {
  await tx.insert(auditEvents).values({
    actorType: event.actorEmployeeId ? 'employee' : 'system',
    actorEmployeeId: event.actorEmployeeId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    requestId: event.requestId ?? null,
    details: redactAuditDetails(event.details),
  });
}
