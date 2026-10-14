import { maskRemittance } from '@/lib/expense-claims/mask';
import { allFields, type FormSchema } from './schema';

/** Applicant, filer, finance and admin read sensitive fields in full; everyone else (approvers included) sees them masked. */
export function canSeeSensitive(actor: { id: string; role: string }, parties: { applicantId: string; filerId: string }): boolean {
  return actor.id === parties.applicantId || actor.id === parties.filerId || actor.role === 'finance' || actor.role === 'admin';
}

/** Copy of the submission data with every sensitive text field masked down to its last four digits. */
export function maskSensitive(schema: FormSchema, data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const f of allFields(schema)) {
    if ((f.type === 'text' || f.type === 'textarea') && f.sensitive && typeof out[f.id] === 'string') {
      out[f.id] = maskRemittance(out[f.id] as string);
    }
  }
  return out;
}
