import { sql } from 'drizzle-orm';
import { MAX_ATTACHMENTS_PER_FORM } from '@/lib/attachments/validate';
import type { Db } from '@/lib/db';
import { allFields, parseFormSchema } from './schema';

/**
 * How many files a designer-form submission may hold, from the definition
 * version it was filed with: the attachments field's own limit, or none when
 * the form has no attachments field.
 */
export async function customAttachmentLimit(db: Pick<Db, 'execute'>, submissionId: string): Promise<number> {
  const [row] = await db.execute<{ schema: unknown }>(sql`
    select v.schema from form_submissions s
      join form_definition_versions v on v.id = s.version_id
     where s.id = ${submissionId}`);
  const parsed = parseFormSchema(row?.schema);
  if (!parsed.ok) return 0;
  const field = allFields(parsed.schema).find((f) => f.type === 'attachments');
  if (field?.type !== 'attachments') return 0;
  return Math.min(field.maxFiles ?? MAX_ATTACHMENTS_PER_FORM, MAX_ATTACHMENTS_PER_FORM);
}
