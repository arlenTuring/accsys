import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { formDefinitions } from '@/lib/db/schema';
import { abort, type Tx } from '@/lib/workflow/tx';

// A hard-coded form is retired once a published designer form names it in
// legacy_form_type: its "new" entry points at the designer form and its create
// service refuses new forms. Existing forms keep their pages, approvals and
// records. Archiving the designer form (or clearing legacy_form_type) reopens
// the hard-coded form.

/** Hard-coded form type -> key of the published designer form that replaced it. */
export type RetiredForms = Record<string, string>;

const replacing = (formType?: string) =>
  and(
    formType === undefined ? isNotNull(formDefinitions.legacyFormType) : eq(formDefinitions.legacyFormType, formType),
    eq(formDefinitions.status, 'published')
  );

export async function retiredLegacyForms(): Promise<RetiredForms> {
  const rows = await getDb()
    .select({ legacyFormType: formDefinitions.legacyFormType, key: formDefinitions.key })
    .from(formDefinitions)
    .where(replacing())
    .orderBy(asc(formDefinitions.key));
  const out: RetiredForms = {};
  for (const r of rows) if (r.legacyFormType && !(r.legacyFormType in out)) out[r.legacyFormType] = r.key;
  return out;
}

/** Key of the designer form that replaced `formType`, or null while the hard-coded form is still in use. */
export async function replacementFor(formType: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ key: formDefinitions.key })
    .from(formDefinitions)
    .where(replacing(formType))
    .orderBy(asc(formDefinitions.key))
    .limit(1);
  return row?.key ?? null;
}

/** Inside a create transaction: refuses new hard-coded forms once a designer form replaced them. */
export async function assertLegacyOpen(tx: Tx, formType: string, label: string): Promise<void> {
  const [row] = await tx.select({ key: formDefinitions.key }).from(formDefinitions).where(replacing(formType)).limit(1);
  if (row) abort('conflict', `${label}已改用新版表單，請重新開啟「新增」頁面填寫新版`);
}
