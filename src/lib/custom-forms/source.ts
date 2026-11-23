import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
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

export async function caseHasApproved(tx: Reader, caseId: string, key: string, sourceId?: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: formSubmissions.id })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .where(
      and(
        eq(formSubmissions.procurementCaseId, caseId),
        eq(formDefinitions.key, key),
        eq(formSubmissions.status, 'approved'),
        sourceId
          ? or(eq(formSubmissions.sourceSubmissionId, sourceId), isNull(formSubmissions.sourceSubmissionId))
          : undefined
      )
    )
    .limit(1);
  return !!row;
}

/**
 * Locks the picked source and checks it: the applicant's own, approved, one
 * of the allowed forms (meeting its condition). Unless `rule.allowMultiple`
 * is enabled (第 16 條：一張請購單對應多張採購、驗收、費用單), the case holds at most one
 * submission of this form. `own` skips the submission being revised.
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
  if (rule!.unlessCaseHas && (await caseHasApproved(tx, row.caseId, rule!.unlessCaseHas, id))) {
    abort('conflict', `此案件已有核准的後續單據，請改選該單據作為「${field.label}」`);
  }
  if (!rule!.allowMultiple) {
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
  }
  return { id, caseId: row.caseId, formNumber: row.formNumber, name: row.name, rule: rule!, schema, data };
}

/** Source rows the rule carries over, with their index in the source table. */
function eligibleRows(rule: SourceRule, data: SubmissionData): { row: Record<string, unknown>; index: number }[] {
  const map = rule.rows!;
  const rows = (data[map.from] as TableValue | undefined)?.rows ?? [];
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => !map.filter || row[map.filter.column] === map.filter.value);
}

/** One carried-over row: mapped columns from the source (or adjusted partial quantity/amount within source bounds), the rest from `input`. */
function carried(rule: SourceRule, source: Record<string, unknown>, index: number, input: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  const adjustable = new Set(rule.rows?.adjustableColumns ?? []);
  const srcQtyNum = Number(String(source.quantity ?? '').replace(/,/g, ''));
  let appliedQtyNum = srcQtyNum;

  for (const c of rule.rows!.columns) {
    const srcVal = source[c.from] ?? null;
    if (adjustable.has(c.to) && input[c.to] !== undefined && input[c.to] !== null && input[c.to] !== '') {
      const rawStr = String(input[c.to]).replace(/,/g, '').trim();
      const rawNum = Number(rawStr);
      const srcNum = Number(String(srcVal ?? '').replace(/,/g, ''));
      if (Number.isFinite(rawNum) && rawNum > 0) {
        if (c.to === 'quantity') {
          const maxQ = Number.isFinite(srcNum) && srcNum > 0 ? srcNum : rawNum;
          if (Number.isInteger(rawNum) && rawNum <= maxQ) {
            out[c.to] = rawNum;
            appliedQtyNum = rawNum;
            continue;
          }
        } else {
          const maxAmt = Number.isFinite(srcNum) && srcNum > 0 ? srcNum : rawNum;
          if (rawNum <= maxAmt && /^\d+(\.\d{1,2})?$/.test(rawStr)) {
            out[c.to] = rawStr;
            continue;
          }
        }
      }
    }
    out[c.to] = srcVal;
  }

  // If quantity was partially adjusted (e.g. partial acceptance) and amount comes from source without manual adjustment, scale amount proportionally
  const amountCol = rule.rows!.columns.find((c) => c.to === 'amount');
  if (
    amountCol &&
    !adjustable.has('amount') &&
    Number.isFinite(srcQtyNum) &&
    srcQtyNum > 0 &&
    Number.isFinite(appliedQtyNum) &&
    appliedQtyNum > 0 &&
    appliedQtyNum < srcQtyNum
  ) {
    const srcAmtNum = Number(String(source[amountCol.from] ?? '').replace(/,/g, ''));
    if (Number.isFinite(srcAmtNum) && srcAmtNum > 0) {
      out.amount = ((srcAmtNum * appliedQtyNum) / srcQtyNum).toFixed(2);
    }
  }

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
  /** 第 16 條：1 對多核銷追蹤資訊 */
  childCount?: number;
  sourceTotalAmount?: number | null;
  totalUsedAmount?: number;
  remainingAmount?: number | null;
};

/**
 * The applicant's approved submissions this form may continue: allowed form,
 * condition met, and (unless `rule.allowMultiple` is true) no submission of
 * this form in the case yet. `current` (editing) is always offered.
 */
export async function sourceOptions(
  db: Reader,
  target: { definitionId: string },
  field: SourceField,
  applicantId: string,
  current?: string
): Promise<SourceOption[]> {
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
            inArray(formDefinitions.key, keys)
          )
    )
    .orderBy(desc(formSubmissions.submittedAt))
    .limit(200);

  if (rows.length === 0) return [];

  // Query existing downstream submissions in these cases for this target definitionId
  const caseIds = [...new Set(rows.map((r) => r.caseId))];
  const existingChildren = await db
    .select({
      id: formSubmissions.id,
      caseId: formSubmissions.procurementCaseId,
      sourceSubmissionId: formSubmissions.sourceSubmissionId,
      status: formSubmissions.status,
      totalAmount: formSubmissions.totalAmount,
      data: formSubmissions.data,
    })
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.definitionId, target.definitionId),
        inArray(formSubmissions.procurementCaseId, caseIds)
      )
    );

  const out: SourceOption[] = [];
  for (const r of rows) {
    const rule = field.sources.find((x) => x.form === r.key);
    const parsed = parseDefinition(r.schema, r.flow);
    if (!rule || !parsed.ok) continue;
    const data = r.data as SubmissionData;
    if (!current && !ruleHolds(rule, parsed.schema, data)) continue;
    if (!current && rule.unlessCaseHas && (await caseHasApproved(db, r.caseId, rule.unlessCaseHas, r.id))) continue;

    // Legacy 1-to-1 check when allowMultiple is not enabled
    if (!current && !rule.allowMultiple) {
      const hasInCase = existingChildren.some((c) => c.caseId === r.caseId);
      if (hasInCase) continue;
    }

    // Active (non-withdrawn) downstream submissions linked to this source
    const activeChildren = existingChildren.filter(
      (c) => (c.sourceSubmissionId === r.id || (!c.sourceSubmissionId && c.caseId === r.caseId)) && c.status !== 'withdrawn'
    );
    const childCount = activeChildren.length;
    const totalUsedAmount = activeChildren.reduce((sum, c) => sum + (c.totalAmount !== null ? Number(c.totalAmount) : 0), 0);
    const sourceTotalAmount = r.totalAmount === null ? null : Number(r.totalAmount);
    const remainingAmount =
      sourceTotalAmount === null ? null : Math.max(0, Math.round((sourceTotalAmount - totalUsedAmount) * 100) / 100);

    // Track per-row used quantity and amount across active child submissions
    const usedQtyByRow = new Map<number, number>();
    const usedAmtByRow = new Map<number, number>();
    if (rule.rows) {
      const targetTable = rule.rows.table;
      for (const child of activeChildren) {
        const childData = (child.data ?? {}) as Record<string, unknown>;
        const childRows = ((childData[targetTable] as TableValue | undefined)?.rows ?? []) as Record<string, unknown>[];
        for (const cr of childRows) {
          const srcIdx = sourceRowOf(cr);
          if (srcIdx === null) continue;
          const q = Number(String(cr.quantity ?? '0').replace(/,/g, ''));
          if (Number.isFinite(q) && q > 0) usedQtyByRow.set(srcIdx, (usedQtyByRow.get(srcIdx) ?? 0) + q);
          const amtRaw = cr.totalPrice ?? cr.amount ?? cr.twdAmount ?? '0';
          const amt = Number(String(amtRaw).replace(/,/g, ''));
          if (Number.isFinite(amt) && amt > 0) usedAmtByRow.set(srcIdx, (usedAmtByRow.get(srcIdx) ?? 0) + amt);
        }
      }
    }

    const carriedRows = rule.rows
      ? eligibleRows(rule, data).map((e) => {
          const base = carried(rule, e.row, e.index);
          if (!rule.allowMultiple) return base;
          const srcQty = Number(String(e.row.quantity ?? '0').replace(/,/g, ''));
          const usedQty = usedQtyByRow.get(e.index) ?? 0;
          const remQty = Number.isFinite(srcQty) && srcQty > 0 ? Math.max(0, srcQty - usedQty) : null;
          const srcAmtRaw = e.row.estimatedAmount ?? e.row.totalPrice ?? e.row.amount ?? null;
          const srcAmt = srcAmtRaw !== null ? Number(String(srcAmtRaw).replace(/,/g, '')) : null;
          const usedAmt = Math.round((usedAmtByRow.get(e.index) ?? 0) * 100) / 100;
          const remAmt = srcAmt !== null && Number.isFinite(srcAmt) ? Math.max(0, Math.round((srcAmt - usedAmt) * 100) / 100) : null;

          const adjustable = new Set(rule.rows?.adjustableColumns ?? []);
          if (adjustable.has('quantity') && remQty !== null && remQty > 0) {
            base.quantity = remQty;
          }
          if (adjustable.has('amount') && remAmt !== null && remAmt > 0 && usedAmt > 0) {
            base.amount = remAmt.toFixed(2);
          }
          return {
            ...base,
            ...(Number.isFinite(srcQty) && srcQty > 0
              ? { _maxQty: srcQty, _usedQty: usedQty, _remainingQty: remQty }
              : {}),
            ...(srcAmt !== null && Number.isFinite(srcAmt)
              ? { _sourceAmount: srcAmt, _usedAmount: usedAmt, _remainingAmount: remAmt }
              : {}),
          };
        })
      : [];

    const total =
      sourceTotalAmount === null
        ? ''
        : `｜合計 NT$ ${sourceTotalAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    const balanceTag =
      rule.allowMultiple && childCount > 0 && remainingAmount !== null
        ? `（已開 ${childCount} 張｜剩餘 NT$ ${remainingAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}）`
        : '';

    out.push({
      id: r.id,
      label: `${r.formNumber}｜${r.name}${total}${balanceTag}`,
      table: rule.rows?.table ?? null,
      rows: carriedRows,
      subset: rule.rows?.mode === 'subset',
      childCount,
      sourceTotalAmount,
      totalUsedAmount,
      remainingAmount,
    });
  }
  return out;
}
