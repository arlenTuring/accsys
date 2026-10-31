import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { approvalSteps, employees, formDefinitions, formDefinitionVersions, formSubmissions } from '@/lib/db/schema';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { allFields, type FormSchema } from '@/lib/custom-forms/schema';
import { FORM_LABELS, FORM_TABLE, type FormType } from '@/lib/procurement/form-registry';

/**
 * What a reminder says about a form, read from the form itself so it can never
 * disagree with the record. No model is involved: this keeps working when the
 * model does not.
 */

export type FormRef = { formType: string; formId: string };

export type FormFacts = {
  label: string;
  formNumber: string;
  applicantId: string | null;
  applicantName: string | null;
  filerId: string | null;
  status: string;
  what: string | null;
  when: string | null;
  where: string | null;
  amount: number | null;
};

type FieldMap = { what?: string[]; when?: string[]; where?: string[] };

const EXPENSE: FieldMap = { what: ['items', 'remark'], when: ['expectedPaymentDate'] };

/** Fields that identify each form to a person. Designer forms not listed fall back to `guessMap`. */
const FIELD_MAP: Record<string, FieldMap> = {
  'business-trip': { what: ['purpose'], when: ['tripStartAt', 'tripEndAt'], where: ['location'] },
  'travel-expense': { what: ['purpose'], when: ['tripStartDate', 'tripEndDate'] },
  'contract-seal': { what: ['subject'], when: ['expectedCompletionDate'], where: ['counterparty'] },
  'general-seal': { what: ['documentDescription', 'remark'], when: ['expectedCompletionDate'] },
  'invoice-seal': { what: ['customerName'] },
  'department-expense': EXPENSE,
  'minor-expense': EXPENSE,
  'project-expense': EXPENSE,
  'revenue-expense': EXPENSE,
  'procurement-payment': EXPENSE,
  'standalone-payment': EXPENSE,
  'asset-transfer': { what: ['items', 'remark'] },
  'purchase-request': { what: ['items'] },
  'purchase-order': { what: ['items'] },
  acceptance: { what: ['items'], when: ['acceptanceDate'] },
};

const WHAT_LABEL = /事由|目的|用途|主旨|標的|說明|名稱/;

function guessMap(schema: FormSchema): FieldMap {
  const fields = allFields(schema);
  const texts = fields.filter((f) => f.type === 'text' || f.type === 'textarea');
  const named = texts.find((f) => WHAT_LABEL.test(f.label)) ?? texts[0] ?? fields.find((f) => f.type === 'table');
  const dates = fields.filter((f) => f.type === 'date' || f.type === 'datetime').slice(0, 2);
  return { what: named ? [named.id] : [], when: dates.map((f) => f.id) };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstRowText(schema: FormSchema, fieldId: string, value: unknown): string | null {
  const field = allFields(schema).find((f) => f.id === fieldId);
  if (field?.type !== 'table') return null;
  const rows = (value as { rows?: Record<string, unknown>[] } | null)?.rows ?? [];
  if (rows.length === 0) return null;
  const col = field.columns.find((c) => c.type === 'text' && textOf(rows[0][c.id]));
  const text = col ? textOf(rows[0][col.id]) : null;
  if (!text) return null;
  return rows.length > 1 ? `${text} 等 ${rows.length} 項` : text;
}

const displayDate = (s: string) => s.replace('T', ' ');

/** One date, or start ～ end; the same value twice is a single day. */
export function dateRange(values: (string | null)[]): string | null {
  const parts = [...new Set(values.filter((v): v is string => Boolean(v)).map(displayDate))];
  return parts.length ? parts.join(' ～ ') : null;
}

/** Pure mapping from a submission's data to its identifying facts. Sensitive fields are never used. */
export function factsFromData(
  key: string,
  schema: FormSchema,
  data: Record<string, unknown>
): Pick<FormFacts, 'what' | 'when' | 'where'> {
  const map = FIELD_MAP[key] ?? guessMap(schema);
  const byId = new Map(allFields(schema).map((f) => [f.id, f]));
  const readable = (id: string) => {
    const f = byId.get(id);
    return f && !('sensitive' in f && f.sensitive) ? data[id] : undefined;
  };
  const first = (ids: string[] | undefined) => {
    for (const id of ids ?? []) {
      const v = readable(id);
      const text = textOf(v) ?? firstRowText(schema, id, v);
      if (text) return clip(text, 60);
    }
    return null;
  };
  return {
    what: first(map.what),
    where: first(map.where),
    when: dateRange((map.when ?? []).map((id) => textOf(readable(id)))),
  };
}

/** `事由 · 地點 · 日期 · NT$ 金額`; absent facts are left out rather than guessed. */
export function factsLine(f: Pick<FormFacts, 'what' | 'when' | 'where' | 'amount'>): string {
  const money = f.amount === null ? null : `NT$ ${f.amount.toLocaleString('en-US')}`;
  return [f.what, f.where, f.when, money].filter(Boolean).join(' · ');
}

const toAmount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const refKey = (r: FormRef) => `${r.formType}:${r.formId}`;

async function customFacts(ids: string[], out: Map<string, FormFacts>) {
  if (ids.length === 0) return;
  const rows = await getDb()
    .select({
      id: formSubmissions.id,
      formNumber: formSubmissions.formNumber,
      status: formSubmissions.status,
      data: formSubmissions.data,
      totalAmount: formSubmissions.totalAmount,
      applicantId: formSubmissions.applicantEmployeeId,
      filerId: formSubmissions.filedByEmployeeId,
      applicantName: employees.name,
      key: formDefinitions.key,
      name: formDefinitions.name,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formSubmissions.versionId))
    .innerJoin(employees, eq(employees.id, formSubmissions.applicantEmployeeId))
    .where(inArray(formSubmissions.id, ids));
  for (const r of rows) {
    const parsed = parseDefinition(r.schema, r.flow);
    const facts = parsed.ok
      ? factsFromData(r.key, parsed.schema, (r.data ?? {}) as Record<string, unknown>)
      : { what: null, when: null, where: null };
    out.set(refKey({ formType: 'custom', formId: r.id }), {
      label: r.name,
      formNumber: r.formNumber,
      applicantId: r.applicantId,
      applicantName: r.applicantName,
      filerId: r.filerId ?? r.applicantId,
      status: r.status,
      amount: toAmount(r.totalAmount),
      ...facts,
    });
  }
}

/** Forms from before the designer: one table per type, so read what the row happens to have. */
async function legacyFacts(ref: FormRef, out: Map<string, FormFacts>) {
  const formType = ref.formType as FormType;
  if (!(formType in FORM_TABLE)) return;
  const [row] = await getDb().execute<{ row: Record<string, unknown>; applicant_name: string | null; case_number: string | null }>(sql`
    select to_jsonb(f) as row, e.name as applicant_name, pc.case_number
      from ${sql.identifier(FORM_TABLE[formType])} f
      left join employees e on e.id = f.applicant_employee_id
      left join procurement_cases pc on pc.id = f.procurement_case_id
     where f.id = ${ref.formId}
     limit 1`);
  if (!row) return;
  const r = row.row;
  out.set(refKey(ref), {
    label: FORM_LABELS[formType] ?? '單據',
    formNumber: row.case_number ?? '',
    applicantId: textOf(r.applicant_employee_id),
    applicantName: row.applicant_name,
    filerId: textOf(r.applicant_employee_id),
    status: String(r.status ?? ''),
    what: [r.purpose, r.subject, r.description, r.remark].map(textOf).find(Boolean) ?? null,
    when: null,
    where: null,
    amount: toAmount(r.total_amount),
  });
}

export async function loadFormFacts(refs: FormRef[]): Promise<Map<string, FormFacts>> {
  const out = new Map<string, FormFacts>();
  const unique = [...new Map(refs.map((r) => [refKey(r), r])).values()];
  await customFacts(unique.filter((r) => r.formType === 'custom').map((r) => r.formId), out);
  for (const r of unique.filter((x) => x.formType !== 'custom')) await legacyFacts(r, out);
  return out;
}

export const factsFor = (map: Map<string, FormFacts>, ref: FormRef) => map.get(refKey(ref)) ?? null;

/** The text the approver wrote when returning the form; null when none was recorded. */
export async function loadReturnReason(ref: FormRef): Promise<string | null> {
  const [row] = await getDb()
    .select({ comment: approvalSteps.comment })
    .from(approvalSteps)
    .where(and(eq(approvalSteps.formType, ref.formType), eq(approvalSteps.formId, ref.formId), eq(approvalSteps.status, 'returned')))
    .orderBy(desc(approvalSteps.actedAt))
    .limit(1);
  return textOf(row?.comment);
}
