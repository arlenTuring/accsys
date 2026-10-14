import { sql } from 'drizzle-orm';
import { getDb, getSql } from '@/lib/db';
import { FORM_TABLE, FORM_TYPES, type FormType } from '@/lib/procurement/form-registry';

/**
 * Authorization rules for procurement forms (one place, used by every query,
 * action and API route that touches a form or its attachments):
 *
 *   read / attachments   applicant, any approver on that form, finance, admin;
 *                        for seal requests and designer forms also the employee
 *                        who filed it (代為申請)
 *   add attachments      applicant / filer before the first approval or after a
 *                        return; finance, admin
 *   approve / return     only the approver of the current step (checked in actions)
 *   edit / withdraw /    the applicant (seal requests, designer forms: or the filer), in the
 *     resubmit           states the business rules allow (checked in actions)
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
  // Designer forms record their filer per submission (a case may hold several); seal forms use the case creator.
  const filer =
    formType === 'custom'
      ? `f.filed_by_employee_id = $2`
      : `exists (select 1 from procurement_cases c
                  where c.id = f.procurement_case_id and c.case_type in ('contract_seal', 'general_seal', 'invoice_seal')
                    and c.created_by_employee_id = $2)`;
  const rows = await getSql().unsafe<{ ok: boolean }[]>(
    `select (f.applicant_employee_id = $2
             or $3::boolean
             or exists (select 1 from approval_steps s
                         where s.form_type = $4 and s.form_id = f.id and s.approver_employee_id = $2)
             or ${filer}) as ok
       from ${table} f
      where f.id = $1`,
    [formId, actor.id, isFinanceOrAdmin(actor), formType]
  );
  return rows[0]?.ok === true;
}

/**
 * True when `actor` may add attachments: the applicant or the filer while the
 * form can still change before anyone relies on it (pending with no approval
 * yet in this round, returned, or approved without anyone signing, i.e.
 * right after an auto-approval); finance and admin at any time. Once someone
 * has approved, a new file would slip in under their signature, so the
 * applicant has to wait for a return. Approvers and other readers only read.
 *
 * Inside a transaction (`tx`) the form row is locked FOR UPDATE, the same lock
 * an approval takes, so an upload cannot interleave with the first approval.
 */
export async function canAttachToForm(
  actor: Actor | null | undefined,
  formType: unknown,
  formId: unknown,
  tx?: Pick<ReturnType<typeof getDb>, 'execute'>
): Promise<boolean> {
  if (!actor || !isFormType(formType) || !isUuid(formId)) return false;
  const table = sql.identifier(FORM_TABLE[formType]); // identifier from a fixed allowlist
  const lock = tx ? sql` for update of f` : sql``;
  if (isFinanceOrAdmin(actor)) {
    if (tx) await tx.execute(sql`select 1 from ${table} f where f.id = ${formId}${lock}`);
    return canReadForm(actor, formType, formId);
  }
  const filer = formType === 'custom' ? sql`f.filed_by_employee_id` : sql`c.created_by_employee_id`;
  const rows = await (tx ?? getDb()).execute<{ ok: boolean }>(sql`
    select ((f.applicant_employee_id = ${actor.id} or ${filer} = ${actor.id})
            and (f.status = 'returned'
                 or (f.status = 'pending_approval'
                     and not exists (select 1 from approval_steps s
                                      where s.form_type = ${formType} and s.form_id = f.id and s.status = 'approved'))
                 or (f.status = 'approved'
                     and not exists (select 1 from approval_steps s
                                      where s.form_type = ${formType} and s.form_id = f.id and s.status = 'approved')))) as ok
      from ${table} f
      join procurement_cases c on c.id = f.procurement_case_id
     where f.id = ${formId}${lock}`);
  return rows[0]?.ok === true;
}

/** Keeps the last 4 characters of an account number visible. */
export function maskAccount(value: string | null): string | null {
  if (!value) return value;
  const tail = value.replace(/\s/g, '').slice(-4);
  return `****${tail}`;
}
