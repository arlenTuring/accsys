import { getSql } from '@/lib/db';
import { FORM_TABLE, FORM_TYPES, type FormType } from '@/lib/procurement/form-registry';

/**
 * Authorization rules for procurement forms (one place, used by every query,
 * action and API route that touches a form or its attachments):
 *
 *   read / attachments   applicant, any approver on that form, finance, admin
 *   approve / return     only the approver of the current step (checked in actions)
 *   edit / withdraw /    the applicant, in the states the business rules allow
 *     resubmit           (checked in actions)
 *   create a follow-up   the applicant of the approved source form
 *
 * Unauthorized and non-existent forms look the same to the caller (null /
 * not found), so IDs cannot be probed.
 */

export type Actor = { id: string; role: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isFormType(value: unknown): value is FormType {
  return typeof value === 'string' && (FORM_TYPES as readonly string[]).includes(value);
}

export function isFinanceOrAdmin(actor: Actor | null | undefined): boolean {
  return actor?.role === 'finance' || actor?.role === 'admin';
}

/** True when `actor` may read the form (and list/download its attachments). */
export async function canReadForm(actor: Actor | null | undefined, formType: unknown, formId: unknown): Promise<boolean> {
  if (!actor || !isFormType(formType) || !isUuid(formId)) return false;
  const table = FORM_TABLE[formType]; // identifier from a fixed allowlist
  const rows = await getSql().unsafe<{ ok: boolean }[]>(
    `select (f.applicant_employee_id = $2
             or $3::boolean
             or exists (select 1 from approval_steps s
                         where s.form_type = $4 and s.form_id = f.id and s.approver_employee_id = $2)) as ok
       from ${table} f
      where f.id = $1`,
    [formId, actor.id, isFinanceOrAdmin(actor), formType]
  );
  return rows[0]?.ok === true;
}

/** Keeps the last 4 characters of an account number visible. */
export function maskAccount(value: string | null): string | null {
  if (!value) return value;
  const tail = value.replace(/\s/g, '').slice(-4);
  return `****${tail}`;
}
