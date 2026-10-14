import { and, desc, eq, inArray, ne, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { isUuid } from '@/lib/authz/forms';
import { formDefinitions, formDefinitionVersions, formSubmissions } from '@/lib/db/schema';
import { abort, type Tx } from '@/lib/workflow/tx';
import { parseDefinition } from './definition';
import { allFields, SOURCE_ROW_KEY, type FieldDef, type FormSchema, type SourceRule } from './schema';
import { holds, sourceRowOf, type SubmissionData, type TableValue } from './validate';

/**
 * 關聯單據 (source documents): a submission continues one of the applicant's
 * own approved submissions, joins its case and may carry its rows over.
 * Lock order: the source submission first, then the submission itself.
 */

type SourceField = Extract<FieldDef, { type: 'source' }>;
/** A transaction, or the plain client for read-only lookups. */
type Reader = Pick<Tx, 'select'>;

export type LoadedSource = {
  id: string;
  caseId: string;
  formNumber: string;
  name: string;
  rule: SourceRule;
  schema: FormSchema;
  data: SubmissionData;
};

/** Values a source condition tests: the source's fields, tables reduced to their total. */
function headerValues(schema: FormSchema, data: SubmissionData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of allFields(schema)) {
    const v = data[f.id];
    out[f.id] = f.type === 'table' ? ((v as TableValue | undefined)?.total ?? null) : v;
  }
  return out;
}

export function ruleHolds(rule: SourceRule, schema: FormSchema, data: SubmissionData): boolean {
  return !rule.when || holds(rule.when, headerValues(schema, data));
}

function parsedSchema(schema: unknown, flow: unknown): FormSchema {
  const parsed = parseDefinition(schema, flow);
  if (!parsed.ok) abort('unavailable', '來源表單的定義有誤，請聯絡系統管理員');
  return (parsed as Extract<typeof parsed, { ok: true }>).schema;
}

async function caseHasApproved(tx: Reader, caseId: string, key: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: formSubmissions.id })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .where(and(eq(formSubmissions.procurementCaseId, caseId), eq(formDefinitions.key, key), eq(formSubmissions.status, 'approved')))
    .limit(1);
  return !!row;
}

/**
 * Locks the picked source and checks it: the applicant's own, approved, one
 * of the allowed forms (meeting its condition), and the case has no
 * submission of this form yet (withdrawn ones count). `own` skips the
 * submission being revised.
 */
export async function loadSource(
  tx: Tx,
  target: { definitionId: string; name: string },
  field: SourceField,
  sourceId: unknown,
  applicantId: string,
  own?: string
): Promise<LoadedSource> {
  if (typeof sourceId !== 'string' || !isUuid(sourceId)) abort('validation', `請選擇「${field.label}」`);
  const id = (sourceId as string).toLowerCase();
  const [locked] = await tx
    .select({ id: formSubmissions.id, applicant: formSubmissions.applicantEmployeeId })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, id))
    .for('update');
  if (!locked || locked.applicant !== applicantId) abort('not_found', `找不到選取的「${field.label}」`);
  const [row] = await tx
    .select({
      caseId: formSubmissions.procurementCaseId,
      formNumber: formSubmissions.formNumber,
      status: formSubmissions.status,
      data: formSubmissions.data,
      key: formDefinitions.key,
      name: formDefinitions.name,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formSubmissions.versionId))
    .where(eq(formSubmissions.id, id));
  const rule = field.sources.find((r) => r.form === row.key);
  if (!rule) abort('validation', `選取的單據不能作為「${field.label}」`);
  if (row.status !== 'approved') abort('conflict', `來源${row.name}尚未核准，無法建立${target.name}`);
  const schema = parsedSchema(row.schema, row.flow);
  const data = row.data as SubmissionData;
  if (!ruleHolds(rule!, schema, data)) abort('validation', `來源${row.name} ${row.formNumber} 不符合「${field.label}」的條件`);
  if (rule!.unlessCaseHas && (await caseHasApproved(tx, row.caseId, rule!.unlessCaseHas))) {
    abort('conflict', `此案件已有核准的後續單據，請改選該單據作為「${field.label}」`);
  }
  const [twin] = await tx
    .select({ id: formSubmissions.id })
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.definitionId, target.definitionId),
        eq(formSubmissions.procurementCaseId, row.caseId),
        own ? ne(formSubmissions.id, own) : undefined
      )
    )
    .limit(1);
  if (twin) abort('conflict', `此案件已建立過${target.name}`);
  return { id, caseId: row.caseId, formNumber: row.formNumber, name: row.name, rule: rule!, schema, data };
}

/** Source rows the rule carries over, with their index in the source table. */
function eligibleRows(rule: SourceRule, data: SubmissionData): { row: Record<string, unknown>; index: number }[] {
  const map = rule.rows!;
  const rows = (data[map.from] as TableValue | undefined)?.rows ?? [];
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => !map.filter || row[map.filter.column] === map.filter.value);
}

/** One carried-over row: mapped columns from the source, the rest from `input`. */
function carried(rule: SourceRule, source: Record<string, unknown>, index: number, input: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const c of rule.rows!.columns) out[c.to] = source[c.from] ?? null;
  out[SOURCE_ROW_KEY] = index;
  return out;
}

/**
 * Rewrites the carried table of `raw` from the source: every eligible row
 * (all) or the ones the applicant kept (subset), mapped columns taken from
 * the source. Rows that did not come from the source are dropped.
 */
export function carryRows(source: LoadedSource, raw: unknown): Record<string, unknown> {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const map = source.rule.rows;
  if (!map) return input;
  const eligible = eligibleRows(source.rule, source.data);
  if (eligible.length === 0) abort('validation', `來源${source.name} ${source.formNumber} 沒有可帶入的明細`);
  const given = input[map.table];
  const list = given && typeof given === 'object' && Array.isArray((given as TableValue).rows) ? (given as TableValue).rows : Array.isArray(given) ? given : [];
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const r of list) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const index = sourceRowOf(r as Record<string, unknown>);
    if (index === null) continue;
    if (byIndex.has(index)) abort('validation', '同一筆來源明細只能出現一次');
    if (!eligible.some((e) => e.index === index)) abort('validation', `選取的明細不屬於來源${source.name}`);
    byIndex.set(index, r as Record<string, unknown>);
  }
  const chosen = map.mode === 'all' ? eligible : eligible.filter((e) => byIndex.has(e.index));
  input[map.table] = { rows: chosen.map((e) => carried(source.rule, e.row, e.index, byIndex.get(e.index))), total: null };
  return input;
}

/** On publish: every source form exists and still has the table, columns and options the rules use. */
export async function assertSourceForms(tx: Tx, schema: FormSchema) {
  const field = allFields(schema).find((f): f is SourceField => f.type === 'source');
  if (!field) return;
  const own = new Map(allFields(schema).map((f) => [f.id, f]));
  const keys = [...new Set(field.sources.flatMap((r) => [r.form, ...(r.unlessCaseHas ? [r.unlessCaseHas] : [])]))];
  const rows = await tx
    .select({ key: formDefinitions.key, name: formDefinitions.name, schema: formDefinitionVersions.schema, flow: formDefinitionVersions.flow })
    .from(formDefinitions)
    .leftJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
    .where(inArray(formDefinitions.key, keys));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const rule of field.sources) {
    const where = `關聯單據「${field.label}」`;
    const def = byKey.get(rule.form);
    if (!def?.schema) abort('validation', `${where}：來源表單 ${rule.form} 不存在或尚未發佈`);
    if (rule.unlessCaseHas && !byKey.has(rule.unlessCaseHas)) abort('validation', `${where}：表單 ${rule.unlessCaseHas} 不存在`);
    const parsed = parseDefinition(def!.schema, def!.flow);
    if (!parsed.ok) abort('validation', `${where}：來源表單「${def!.name}」的定義有誤`);
    const fields = new Map(allFields((parsed as Extract<typeof parsed, { ok: true }>).schema).map((f) => [f.id, f]));
    const fieldIds = (c: SourceRule['when']): string[] =>
      !c ? [] : 'all' in c ? c.all.flatMap(fieldIds) : 'any' in c ? c.any.flatMap(fieldIds) : 'not' in c ? fieldIds(c.not) : [c.field];
    if (fieldIds(rule.when).some((id) => !fields.has(id))) abort('validation', `${where}：來源條件參考的欄位不在「${def!.name}」中`);
    if (!rule.rows) continue;
    const from = fields.get(rule.rows.from);
    const into = own.get(rule.rows.table);
    if (from?.type !== 'table' || into?.type !== 'table') abort('validation', `${where}：「${def!.name}」沒有明細表 ${rule.rows.from}`);
    const fromTable = from as Extract<FieldDef, { type: 'table' }>;
    const intoTable = into as Extract<FieldDef, { type: 'table' }>;
    for (const m of rule.rows.columns) {
      const a = fromTable.columns.find((c) => c.id === m.from);
      const b = intoTable.columns.find((c) => c.id === m.to)!;
      if (!a || a.type !== b.type) abort('validation', `${where}：「${b.label}」需對應「${def!.name}」明細中同類型的欄位`);
      if (a!.type === 'select' && (a!.options ?? []).some((o) => !b.options?.some((x) => x.value === o.value))) {
        abort('validation', `${where}：「${b.label}」的選項需包含來源「${a!.label}」的所有選項`);
      }
    }
    if (rule.rows.filter) {
      const col = fromTable.columns.find((c) => c.id === rule.rows!.filter!.column);
      if (col?.type !== 'select' || !col.options?.some((o) => o.value === rule.rows!.filter!.value)) {
        abort('validation', `${where}：明細篩選需為「${def!.name}」明細中的下拉選單選項`);
      }
    }
  }
}

export type SourceOption = {
  id: string;
  label: string;
  /** Rows carried into `table` when picked (read-only columns filled, `_src` set). */
  table: string | null;
  rows: Record<string, unknown>[];
  /** The applicant may drop carried rows (subset) or must keep them all. */
  subset: boolean;
};

/**
 * The applicant's approved submissions this form may continue: allowed form,
 * condition met, and no submission of this form in the case yet. `current`
 * (editing) is always offered.
 */
export async function sourceOptions(
  db: Reader,
  target: { definitionId: string },
  field: SourceField,
  applicantId: string,
  current?: string
): Promise<SourceOption[]> {
  const other = alias(formSubmissions, 'other_submission');
  const keys = field.sources.map((r) => r.form);
  const rows = await db
    .select({
      id: formSubmissions.id,
      caseId: formSubmissions.procurementCaseId,
      formNumber: formSubmissions.formNumber,
      totalAmount: formSubmissions.totalAmount,
      data: formSubmissions.data,
      key: formDefinitions.key,
      name: formDefinitions.name,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formSubmissions.versionId))
    .where(
      current
        ? eq(formSubmissions.id, current)
        : and(
            eq(formSubmissions.applicantEmployeeId, applicantId),
            eq(formSubmissions.status, 'approved'),
            inArray(formDefinitions.key, keys),
            notExists(
              db
                .select({ one: sql`1` })
                .from(other)
                .where(and(eq(other.definitionId, target.definitionId), eq(other.procurementCaseId, formSubmissions.procurementCaseId)))
            )
          )
    )
    .orderBy(desc(formSubmissions.submittedAt))
    .limit(200);
  const out: SourceOption[] = [];
  for (const r of rows) {
    const rule = field.sources.find((x) => x.form === r.key);
    const parsed = parseDefinition(r.schema, r.flow);
    if (!rule || !parsed.ok) continue;
    const data = r.data as SubmissionData;
    if (!current && !ruleHolds(rule, parsed.schema, data)) continue;
    if (!current && rule.unlessCaseHas && (await caseHasApproved(db, r.caseId, rule.unlessCaseHas))) continue;
    const total = r.totalAmount === null ? '' : `｜合計 NT$ ${Number(r.totalAmount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    out.push({
      id: r.id,
      label: `${r.formNumber}｜${r.name}${total}`,
      table: rule.rows?.table ?? null,
      rows: rule.rows ? eligibleRows(rule, data).map((e) => carried(rule, e.row, e.index)) : [],
      subset: rule.rows?.mode === 'subset',
    });
  }
  return out;
}
