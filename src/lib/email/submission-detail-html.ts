import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '@/lib/db';
import {
  approvalSteps,
  departments,
  employees,
  formDefinitions,
  formDefinitionVersions,
  formSubmissionAssetLines,
  formSubmissions,
  procurementCases,
} from '@/lib/db/schema';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { referenceLabels } from '@/lib/custom-forms/queries';
import { allFields, isDisplayOnly, type FieldDef, type TableColumn } from '@/lib/custom-forms/schema';
import { maskSensitive } from '@/lib/custom-forms/sensitive';
import type { TableValue } from '@/lib/custom-forms/validate';
import { FORM_LABELS, FORM_ROUTE_PREFIX, FORM_TABLE, type FormType } from '@/lib/procurement/form-registry';
import { buildEmailApprovalUrls } from './approval-token';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAmount(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '—');
  return Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoney(v: unknown, currency = 'NT$'): string {
  if (v === null || v === undefined || v === '') return '—';
  return `${currency} ${formatAmount(v)}`;
}

function currencyOfField(field: FieldDef, data: Record<string, unknown>): string {
  const code = field.currencyField ? data[field.currencyField] : undefined;
  return typeof code === 'string' && code ? code : 'NT$';
}

function formatDay(v: unknown): string {
  return typeof v === 'string' && v ? v.replaceAll('-', '/') : '—';
}

function formatTableCell(
  col: TableColumn,
  v: unknown,
  row: Record<string, unknown>,
  labels: Record<string, string>
): string {
  if (v === null || v === undefined || v === '') return '—';
  if (col.type === 'employee' || col.type === 'asset' || col.type === 'budget_code') {
    return labels[String(v)] ?? String(v);
  }
  if (col.type === 'money') {
    const code = col.currencyColumn ? row[col.currencyColumn] : undefined;
    return typeof code === 'string' && code ? `${code} ${formatAmount(v)}` : formatAmount(v);
  }
  if (col.type === 'date') return formatDay(v);
  if (col.type === 'select') return col.options?.find((o) => o.value === v)?.label ?? String(v);
  if (col.type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v);
  }
  return String(v);
}

function formatFieldValue(
  field: FieldDef,
  v: unknown,
  labels: Record<string, string>,
  data: Record<string, unknown>
): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (field.type) {
    case 'money':
      return formatMoney(v, currencyOfField(field, data));
    case 'date':
      return formatDay(v);
    case 'datetime':
      return typeof v === 'string' && v ? v.replace('T', ' ').replaceAll('-', '/') : '—';
    case 'select':
    case 'radio':
      return field.options.find((o) => o.value === v)?.label ?? String(v);
    case 'checkboxes': {
      const list = Array.isArray(v) ? v : [];
      return list.length
        ? list.map((x) => field.options.find((o) => o.value === x)?.label ?? String(x)).join('、')
        : '—';
    }
    case 'boolean':
      return v === true ? field.trueLabel : field.falseLabel;
    case 'employee':
    case 'department':
    case 'budget_code':
    case 'project':
    case 'supplier':
    case 'asset':
    case 'source':
      return typeof v === 'string' && v ? (labels[v] ?? v) : '—';
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v);
    }
    default:
      return typeof v === 'string' ? v : String(v);
  }
}

export type EmailDocumentFieldEntry = {
  label: string;
  value: string;
};

export type EmailDocumentTableEntry = {
  title: string;
  headers: Array<{ label: string; align: 'left' | 'right' }>;
  rows: string[][];
  totalLabel?: string;
  totalValue?: string;
};

export type EmailApprovalStepEntry = {
  stepOrder: number;
  stepLabel: string;
  approverId: string | null;
  approverName: string;
  status: string;
  isCurrent: boolean;
  comment: string | null;
  actedAt: Date | null;
};

export type EmailApprovalDocumentSummary = {
  formType: FormType;
  formId: string;
  formLabel: string;
  formNumber: string;
  caseNumber: string;
  status: string;
  version: number;
  currentStepOrder: number | null;
  currentStepLabel: string;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  totalAmountText: string | null;
  submittedAt: Date | null;
  fields: EmailDocumentFieldEntry[];
  tables: EmailDocumentTableEntry[];
  steps: EmailApprovalStepEntry[];
  detailUrl: string;
};

/**
 * Loads complete structured document details + approval chain for rendering
 * inside emails AND on the `/email-approval` confirmation dialog.
 */
export async function loadEmailApprovalDocumentSummary(
  formType: FormType,
  formId: string,
  appOrigin = process.env.APP_ORIGIN || 'http://localhost:3001'
): Promise<EmailApprovalDocumentSummary | null> {
  const db = getDb();
  const cleanOrigin = appOrigin.replace(/\/$/, '');
  const prefix = FORM_ROUTE_PREFIX[formType] ?? '/applications';
  const detailUrl = `${cleanOrigin}${prefix}/${formId}`;

  const stepApprover = alias(employees, 'step_approver');
  const rawSteps = await db
    .select({
      stepOrder: approvalSteps.stepOrder,
      stepLabel: approvalSteps.stepLabel,
      approverRole: approvalSteps.approverRole,
      approverId: approvalSteps.approverEmployeeId,
      approverName: stepApprover.name,
      status: approvalSteps.status,
      comment: approvalSteps.comment,
      actedAt: approvalSteps.actedAt,
    })
    .from(approvalSteps)
    .leftJoin(stepApprover, eq(stepApprover.id, approvalSteps.approverEmployeeId))
    .where(and(eq(approvalSteps.formType, formType), eq(approvalSteps.formId, formId)))
    .orderBy(asc(approvalSteps.stepOrder));

  if (formType === 'custom') {
    const [row] = await db
      .select({
        s: formSubmissions,
        defName: formDefinitions.name,
        caseNumber: procurementCases.caseNumber,
        applicantName: employees.name,
        departmentName: departments.name,
        departmentCode: departments.code,
        schema: formDefinitionVersions.schema,
        flow: formDefinitionVersions.flow,
      })
      .from(formSubmissions)
      .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
      .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formSubmissions.versionId))
      .leftJoin(procurementCases, eq(procurementCases.id, formSubmissions.procurementCaseId))
      .innerJoin(employees, eq(employees.id, formSubmissions.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, formSubmissions.departmentId))
      .where(eq(formSubmissions.id, formId));

    if (!row) return null;

    const s = row.s;
    const parsed = parseDefinition(row.schema, row.flow);
    const rawData = ((s.data ?? {}) as Record<string, unknown>);
    const safeData = parsed.ok ? maskSensitive(parsed.schema, rawData) : rawData;
    const labels = parsed.ok ? await referenceLabels(allFields(parsed.schema), safeData) : {};

    const fields: EmailDocumentFieldEntry[] = [];
    const tables: EmailDocumentTableEntry[] = [];

    if (parsed.ok) {
      for (const section of parsed.schema.sections) {
        for (const field of section.fields) {
          if (isDisplayOnly(field)) continue;
          const val = safeData[field.id];
          if (field.type === 'table') {
            const tv = val as TableValue | undefined;
            const tableRows = tv?.rows ?? [];
            if (tableRows.length === 0) continue;
            const visibleCols = field.columns.filter(
              (c) => !c.financeFill || tableRows.some((r) => r[c.id] !== undefined && r[c.id] !== null && r[c.id] !== '')
            );
            const headers = visibleCols.map((c) => ({
              label: c.label,
              align: (c.type === 'money' || c.type === 'number' ? 'right' : 'left') as 'left' | 'right',
            }));
            const formattedRows = tableRows.map((r) =>
              visibleCols.map((c) => formatTableCell(c, r[c.id], r, labels))
            );
            let totalValue: string | undefined;
            if (field.totalColumn && tv?.total !== undefined && tv?.total !== null) {
              const totalCol = field.columns.find((c) => c.id === field.totalColumn);
              const curr = currencyOfField(field, safeData);
              totalValue = totalCol?.type === 'money' ? formatMoney(tv.total, curr) : formatAmount(tv.total);
            }
            tables.push({
              title: field.label || section.title || '明細項目',
              headers,
              rows: formattedRows,
              totalLabel: totalValue ? '合計' : undefined,
              totalValue,
            });
          } else {
            if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
              continue;
            }
            const formatted = formatFieldValue(field, val, labels, safeData);
            if (formatted && formatted !== '—') {
              fields.push({ label: field.label, value: formatted });
            }
          }
        }
      }

      if (parsed.schema.assetRegister) {
        const origCustodian = alias(employees, 'orig_cust');
        const nextCustodian = alias(employees, 'next_cust');
        const assetLines = await db
          .select({
            line: formSubmissionAssetLines,
            origName: origCustodian.name,
            nextName: nextCustodian.name,
          })
          .from(formSubmissionAssetLines)
          .innerJoin(origCustodian, eq(origCustodian.id, formSubmissionAssetLines.originalCustodianEmployeeId))
          .innerJoin(nextCustodian, eq(nextCustodian.id, formSubmissionAssetLines.newCustodianEmployeeId))
          .where(eq(formSubmissionAssetLines.submissionId, s.id))
          .orderBy(asc(formSubmissionAssetLines.lineNo));

        if (assetLines.length > 0) {
          tables.push({
            title: '資產清冊異動明細',
            headers: [
              { label: '財產編號', align: 'left' },
              { label: '資產名稱', align: 'left' },
              { label: '原保管人／位置', align: 'left' },
              { label: '新保管人／位置', align: 'left' },
              { label: '異動事由', align: 'left' },
            ],
            rows: assetLines.map(({ line, origName, nextName }) => [
              line.assetTag,
              line.assetName,
              `${origName}（${line.originalLocation}）`,
              `${nextName}（${line.newLocation}）`,
              line.reason,
            ]),
          });
        }
      }
    }

    const steps: EmailApprovalStepEntry[] = rawSteps.map((st) => ({
      stepOrder: st.stepOrder,
      stepLabel: st.stepLabel || st.approverRole || `第 ${st.stepOrder} 關`,
      approverId: st.approverId,
      approverName: st.approverName ?? '系統自動核准',
      status: st.status,
      isCurrent: s.status === 'pending_approval' && st.stepOrder === s.currentStepOrder,
      comment: st.comment,
      actedAt: st.actedAt,
    }));

    const currentStep = steps.find((st) => st.stepOrder === s.currentStepOrder);
    const totalNum = s.totalAmount !== null ? Number(s.totalAmount) : NaN;
    const totalAmountText =
      Number.isFinite(totalNum) && totalNum > 0 ? `NT$ ${formatAmount(totalNum)}` : null;

    return {
      formType,
      formId: s.id,
      formLabel: row.defName,
      formNumber: s.formNumber,
      caseNumber: s.formNumber || row.caseNumber || '',
      status: s.status,
      version: s.version,
      currentStepOrder: s.currentStepOrder,
      currentStepLabel: currentStep?.stepLabel ?? '簽核關卡',
      applicantEmployeeId: s.applicantEmployeeId,
      applicantName: row.applicantName,
      departmentName: row.departmentCode ? `${row.departmentName} (${row.departmentCode})` : row.departmentName,
      totalAmountText,
      submittedAt: s.submittedAt,
      fields,
      tables,
      steps,
      detailUrl,
    };
  }

  // Fallback for legacy non-custom tables
  if (!(formType in FORM_TABLE)) return null;
  const table = FORM_TABLE[formType];
  const metaRows = await db.execute<{
    id: string;
    case_number: string | null;
    status: string;
    version: number;
    current_step_order: number | null;
    applicant_employee_id: string;
    applicant_name: string | null;
    dept_name: string | null;
    dept_code: string | null;
    total_amount: string | number | null;
    purpose: string | null;
    submitted_at: Date | string | null;
    raw_row: Record<string, unknown> | null;
  }>(sql`
    select
      f.id,
      coalesce(pc.case_number, to_jsonb(f) ->> 'form_number', to_jsonb(f) ->> 'case_number') as case_number,
      f.status,
      f.version,
      f.current_step_order,
      f.applicant_employee_id,
      e.name as applicant_name,
      d.name as dept_name,
      d.code as dept_code,
      coalesce(to_jsonb(f) ->> 'total_amount', to_jsonb(f) ->> 'estimated_total') as total_amount,
      coalesce(
        to_jsonb(f) ->> 'purpose',
        to_jsonb(f) ->> 'subject',
        to_jsonb(f) ->> 'document_description',
        to_jsonb(f) ->> 'remark',
        to_jsonb(f) ->> 'reason',
        to_jsonb(f) ->> 'notes'
      ) as purpose,
      f.created_at as submitted_at,
      to_jsonb(f) as raw_row
    from ${sql.identifier(table)} f
    left join procurement_cases pc on pc.id = f.procurement_case_id
    left join employees e on e.id = f.applicant_employee_id
    left join departments d on d.id = f.department_id
    where f.id = ${formId}
    limit 1
  `);
  const meta = metaRows[0];
  if (!meta) return null;

  const steps: EmailApprovalStepEntry[] = rawSteps.map((st) => ({
    stepOrder: st.stepOrder,
    stepLabel: st.stepLabel || st.approverRole || `第 ${st.stepOrder} 關`,
    approverId: st.approverId,
    approverName: st.approverName ?? '系統自動核准',
    status: st.status,
    isCurrent: meta.status === 'pending_approval' && st.stepOrder === meta.current_step_order,
    comment: st.comment,
    actedAt: st.actedAt,
  }));
  const currentStep = steps.find((st) => st.stepOrder === meta.current_step_order);
  const rawRow = (meta.raw_row ?? {}) as Record<string, unknown>;
  const currency = typeof rawRow.currency === 'string' && rawRow.currency ? rawRow.currency : 'NT$';
  const totalNum = meta.total_amount !== null ? Number(meta.total_amount) : NaN;
  const totalAmountText =
    Number.isFinite(totalNum) && totalNum > 0 ? `${currency} ${formatAmount(totalNum)}` : null;

  const fields: EmailDocumentFieldEntry[] = [];
  const pushIfPresent = (label: string, val: unknown) => {
    if (val === null || val === undefined || val === '') return;
    if (Array.isArray(val)) {
      if (val.length > 0) fields.push({ label, value: val.join('、') });
      return;
    }
    fields.push({ label, value: String(val) });
  };

  pushIfPresent('申請／建立日期', rawRow.request_date ?? rawRow.application_date ?? rawRow.acceptance_date ?? rawRow.form_date);
  if (meta.purpose) {
    fields.push({ label: '申請事由／說明', value: meta.purpose });
  }
  pushIfPresent('付款方式', rawRow.payment_method);
  pushIfPresent('付款條件', rawRow.payment_terms);
  pushIfPresent('預計付款日', rawRow.expected_payment_date);
  pushIfPresent('匯款資訊', rawRow.remittance_info);
  pushIfPresent('出差起訖日期', rawRow.trip_start_date && rawRow.trip_end_date ? `${rawRow.trip_start_date} ～ ${rawRow.trip_end_date}` : null);
  pushIfPresent('同行人員', rawRow.companions);
  pushIfPresent('出差單號', rawRow.trip_order_no);
  pushIfPresent('用印對象／客戶名稱', rawRow.counterparty ?? rawRow.customer_name);
  pushIfPresent('文件類型', rawRow.document_type ?? rawRow.invoice_type);
  pushIfPresent('用印種類', rawRow.seals ?? rawRow.seal);
  pushIfPresent('異動類型', rawRow.transfer_types);
  if (rawRow.remark && rawRow.remark !== meta.purpose) {
    pushIfPresent('備註說明', rawRow.remark);
  }
  if (totalAmountText) {
    fields.push({ label: '單據總金額', value: totalAmountText });
  }

  const tables: EmailDocumentTableEntry[] = [];
  try {
    if (formType === 'purchase_request') {
      const items = await db.execute<{ line_no: number; item_category: string; description: string; quantity: number; estimated_amount: number }>(
        sql`select line_no, item_category, description, quantity, estimated_amount from purchase_request_items where purchase_request_id = ${formId} order by line_no asc`
      );
      if (items.length > 0) {
        tables.push({
          title: '請購品項明細',
          headers: [
            { label: '品項類別', align: 'left' },
            { label: '品名與規格說明', align: 'left' },
            { label: '數量', align: 'right' },
            { label: '預估金額', align: 'right' },
          ],
          rows: items.map((it) => [it.item_category, it.description, String(it.quantity), `NT$ ${formatAmount(it.estimated_amount)}`]),
          totalLabel: '合計',
          totalValue: totalAmountText ?? undefined,
        });
      }
    } else if (formType === 'purchase_order') {
      const items = await db.execute<{ line_no: number; item_category: string; description: string; quantity: number; unit_price: number; total_price: number }>(
        sql`select line_no, item_category, description, quantity, unit_price, total_price from purchase_order_items where purchase_order_id = ${formId} order by line_no asc`
      );
      if (items.length > 0) {
        tables.push({
          title: '採購品項明細',
          headers: [
            { label: '品項類別', align: 'left' },
            { label: '品名與規格說明', align: 'left' },
            { label: '數量', align: 'right' },
            { label: '單價', align: 'right' },
            { label: '小計', align: 'right' },
          ],
          rows: items.map((it) => [
            it.item_category,
            it.description,
            String(it.quantity),
            `NT$ ${formatAmount(it.unit_price)}`,
            `NT$ ${formatAmount(it.total_price)}`,
          ]),
          totalLabel: '合計',
          totalValue: totalAmountText ?? undefined,
        });
      }
    } else if (formType === 'acceptance') {
      const items = await db.execute<{ line_no: number; description: string; quantity: number; amount: number; pass_fail: string; property_tag: string | null }>(
        sql`select line_no, description, quantity, amount, pass_fail, property_tag from acceptance_items where acceptance_id = ${formId} order by line_no asc`
      );
      if (items.length > 0) {
        tables.push({
          title: '驗收品項明細',
          headers: [
            { label: '驗收項目說明', align: 'left' },
            { label: '數量', align: 'right' },
            { label: '驗收結果', align: 'left' },
            { label: '財產編號', align: 'left' },
            { label: '驗收金額', align: 'right' },
          ],
          rows: items.map((it) => [
            it.description,
            String(it.quantity),
            it.pass_fail === 'pass' ? '合格' : '不合格',
            it.property_tag || '—',
            `NT$ ${formatAmount(it.amount)}`,
          ]),
          totalLabel: '合計',
          totalValue: totalAmountText ?? undefined,
        });
      }
    } else if (formType === 'expense_request') {
      const items = await db.execute<{ line_no: number; description: string; amount: number }>(
        sql`select line_no, description, amount from expense_request_items where expense_request_id = ${formId} order by line_no asc`
      );
      if (items.length > 0) {
        tables.push({
          title: '付款申請明細',
          headers: [
            { label: '付款項目說明', align: 'left' },
            { label: '請款金額', align: 'right' },
          ],
          rows: items.map((it) => [it.description, `NT$ ${formatAmount(it.amount)}`]),
          totalLabel: '合計',
          totalValue: totalAmountText ?? undefined,
        });
      }
    } else if (
      formType === 'department_expense' ||
      formType === 'project_expense' ||
      formType === 'revenue_expense' ||
      formType === 'minor_expense'
    ) {
      const itemTable = `${formType}_items`;
      const fkCol = `${formType}_id`;
      const items = await db.execute<{ line_no: number; category: string; description: string; currency: string; amount: number; twd_amount: number }>(
        sql`select line_no, category, description, currency, amount, twd_amount from ${sql.identifier(itemTable)} where ${sql.identifier(fkCol)} = ${formId} order by line_no asc`
      );
      if (items.length > 0) {
        tables.push({
          title: '費用報支明細',
          headers: [
            { label: '費用類別', align: 'left' },
            { label: '摘要說明', align: 'left' },
            { label: '原幣金額', align: 'right' },
            { label: '折合台幣', align: 'right' },
          ],
          rows: items.map((it) => [
            it.category,
            it.description,
            `${it.currency} ${formatAmount(it.amount)}`,
            `NT$ ${formatAmount(it.twd_amount)}`,
          ]),
          totalLabel: '合計',
          totalValue: totalAmountText ?? undefined,
        });
      }
    } else if (formType === 'travel_expense') {
      const items = await db.execute<{ line_no: number; expense_date: string; category: string; summary: string; currency: string; amount: number; twd_amount: number }>(
        sql`select line_no, expense_date, category, summary, currency, amount, twd_amount from travel_expense_cost_items where travel_expense_id = ${formId} order by line_no asc`
      );
      if (items.length > 0) {
        tables.push({
          title: '差旅費用明細',
          headers: [
            { label: '日期', align: 'left' },
            { label: '類別', align: 'left' },
            { label: '摘要說明', align: 'left' },
            { label: '原幣金額', align: 'right' },
            { label: '折合台幣', align: 'right' },
          ],
          rows: items.map((it) => [
            String(it.expense_date),
            it.category,
            it.summary,
            `${it.currency} ${formatAmount(it.amount)}`,
            `NT$ ${formatAmount(it.twd_amount)}`,
          ]),
          totalLabel: '合計',
          totalValue: totalAmountText ?? undefined,
        });
      }
    } else if (formType === 'invoice_seal_request') {
      const items = await db.execute<{ line_no: number; item_name: string; quantity: number; currency: string; unit_price: number; amount: number }>(
        sql`select line_no, item_name, quantity, currency, unit_price, amount from invoice_seal_request_items where invoice_seal_request_id = ${formId} order by line_no asc`
      );
      if (items.length > 0) {
        tables.push({
          title: '開立發票品項明細',
          headers: [
            { label: '品名', align: 'left' },
            { label: '數量', align: 'right' },
            { label: '單價', align: 'right' },
            { label: '未稅金額', align: 'right' },
          ],
          rows: items.map((it) => [
            it.item_name,
            String(it.quantity),
            `${it.currency} ${formatAmount(it.unit_price)}`,
            `${it.currency} ${formatAmount(it.amount)}`,
          ]),
          totalLabel: '含稅總計',
          totalValue: totalAmountText ?? undefined,
        });
      }
    } else if (formType === 'asset_transfer') {
      const items = await db.execute<{ line_no: number; asset_tag: string; asset_name: string; quantity: number; original_location: string; new_location: string; reason: string; orig_name: string | null; next_name: string | null }>(
        sql`
          select i.line_no, i.asset_tag, i.asset_name, i.quantity, i.original_location, i.new_location, i.reason,
                 e1.name as orig_name, e2.name as next_name
          from asset_transfer_items i
          left join employees e1 on e1.id = i.original_custodian_employee_id
          left join employees e2 on e2.id = i.new_custodian_employee_id
          where i.asset_transfer_id = ${formId}
          order by i.line_no asc
        `
      );
      if (items.length > 0) {
        tables.push({
          title: '資產異動明細',
          headers: [
            { label: '財產編號', align: 'left' },
            { label: '資產名稱', align: 'left' },
            { label: '原保管人／位置', align: 'left' },
            { label: '新保管人／位置', align: 'left' },
            { label: '異動事由', align: 'left' },
          ],
          rows: items.map((it) => [
            it.asset_tag,
            it.asset_name,
            `${it.orig_name ?? '—'}（${it.original_location}）`,
            `${it.next_name ?? '—'}（${it.new_location}）`,
            it.reason,
          ]),
        });
      }
    }
  } catch {
    // ignore item query error
  }

  return {
    formType,
    formId: meta.id,
    formLabel: FORM_LABELS[formType] ?? formType,
    formNumber: meta.case_number ?? meta.id,
    caseNumber: meta.case_number ?? meta.id,
    status: meta.status,
    version: Number(meta.version ?? 1),
    currentStepOrder: meta.current_step_order,
    currentStepLabel: currentStep?.stepLabel ?? '簽核關卡',
    applicantEmployeeId: meta.applicant_employee_id,
    applicantName: meta.applicant_name ?? '申請同仁',
    departmentName: meta.dept_name
      ? meta.dept_code
        ? `${meta.dept_name} (${meta.dept_code})`
        : meta.dept_name
      : '所屬部門',
    totalAmountText,
    submittedAt: meta.submitted_at ? new Date(meta.submitted_at) : null,
    fields,
    tables,
    steps,
    detailUrl,
  };
}

function stepStatusBadgeHtml(step: EmailApprovalStepEntry): string {
  if (step.status === 'approved' || step.status === 'auto_approved') {
    return `<span style="display: inline-block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap;">已核准</span>`;
  }
  if (step.status === 'returned') {
    return `<span style="display: inline-block; background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap;">已退回</span>`;
  }
  if (step.isCurrent) {
    return `<span style="display: inline-block; background: #dbeafe; color: #1d4ed8; border: 1px solid #93c5fd; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap;">目前關卡（待簽核）</span>`;
  }
  return `<span style="display: inline-block; background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; font-size: 11.5px; font-weight: 600; padding: 3px 10px; border-radius: 999px; white-space: nowrap;">待後續簽核</span>`;
}

/**
 * Renders the rich HTML & Plain-Text blocks for embedding inside email notifications,
 * including:
 * 1. Full document field values & line-item tables (`documentDetailsHtml` / `documentDetailsText`)
 * 2. Approval steps timeline
 * 3. Two-layer anti-misclick `<details>` collapsible quick approval action buttons (`approvalActionsHtml` / `approvalActionsText`)
 */
export function renderEmailDocumentAndActions(
  summary: EmailApprovalDocumentSummary,
  options: {
    appOrigin: string;
    recipientEmployeeId: string;
    includeApprovalActions: boolean;
  }
): {
  documentDetailsHtml: string;
  documentDetailsText: string;
  approvalActionsHtml: string;
  approvalActionsText: string;
  approveUrl?: string;
  returnUrl?: string;
} {
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  // 1. Document Fields Section
  if (summary.fields.length > 0 || summary.totalAmountText) {
    const fieldRowsHtml = [
      ...(summary.totalAmountText
        ? [
            `<tr>
              <td style="padding: 10px 16px; color: #64748b; width: 165px; white-space: nowrap; font-weight: 600; border-bottom: 1px solid #f1f5f9; font-size: 13.5px;">單據總金額</td>
              <td style="padding: 10px 16px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #f1f5f9; font-size: 14px; font-family: monospace; white-space: nowrap;">${escapeHtml(summary.totalAmountText)}</td>
            </tr>`,
          ]
        : []),
      ...summary.fields.map(
        (f) => `<tr>
          <td style="padding: 10px 16px; color: #64748b; width: 165px; white-space: nowrap; font-weight: 600; border-bottom: 1px solid #f1f5f9; font-size: 13.5px; vertical-align: top;">${escapeHtml(f.label)}</td>
          <td style="padding: 10px 16px; color: #1e293b; border-bottom: 1px solid #f1f5f9; font-size: 13.5px; white-space: pre-wrap;">${escapeHtml(f.value)}</td>
        </tr>`
      ),
    ].join('');

    htmlParts.push(`
      <div style="margin-top: 18px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
        <div style="background: #f8fafc; padding: 12px 16px; font-size: 13px; font-weight: 700; color: #334155; border-bottom: 1px solid #e2e8f0;">
          單據欄位明細
        </div>
        <table style="width: 100%; border-collapse: collapse; background: #ffffff;">
          ${fieldRowsHtml}
        </table>
      </div>
    `);

    textParts.push('【單據欄位明細】');
    if (summary.totalAmountText) {
      textParts.push(`・單據總金額：${summary.totalAmountText}`);
    }
    for (const f of summary.fields) {
      textParts.push(`・${f.label}：${f.value}`);
    }
  }

  // 2. Line Item Tables Section
  for (const table of summary.tables) {
    const ths = [
      `<th style="padding: 10px 12px; text-align: center; font-size: 12.5px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1; background: #f1f5f9; width: 38px; white-space: nowrap;">#</th>`,
      ...table.headers.map(
        (h) =>
          `<th style="padding: 10px 12px; text-align: ${h.align}; font-size: 12.5px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1; background: #f1f5f9; white-space: nowrap;">${escapeHtml(h.label)}</th>`
      ),
    ].join('');

    const trs = table.rows
      .map((row, idx) => {
        const tds = row
          .map((cell, cIdx) => {
            const align = table.headers[cIdx]?.align ?? 'left';
            const nowrapStyle = align === 'right' ? ' white-space: nowrap; font-family: monospace;' : '';
            return `<td style="padding: 10px 12px; text-align: ${align}; font-size: 13px; color: #1e293b; border-bottom: 1px solid #e2e8f0; vertical-align: top;${nowrapStyle}">${escapeHtml(cell)}</td>`;
          })
          .join('');
        return `<tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
          <td style="padding: 10px 12px; text-align: center; font-size: 12.5px; color: #64748b; border-bottom: 1px solid #e2e8f0; white-space: nowrap;">${idx + 1}</td>
          ${tds}
        </tr>`;
      })
      .join('');

    const totalRowHtml =
      table.totalValue !== undefined
        ? `<tr style="background: #f8fafc; font-weight: 700;">
            <td colspan="${table.headers.length}" style="padding: 10px 12px; text-align: right; font-size: 13px; color: #334155; border-top: 1px solid #cbd5e1; white-space: nowrap;">${escapeHtml(table.totalLabel ?? '合計')}</td>
            <td style="padding: 10px 12px; text-align: right; font-size: 13.5px; color: #0f172a; border-top: 1px solid #cbd5e1; font-family: monospace; white-space: nowrap;">${escapeHtml(table.totalValue)}</td>
          </tr>`
        : '';

    htmlParts.push(`
      <div style="margin-top: 16px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
        <div style="background: #f8fafc; padding: 12px 16px; font-size: 13px; font-weight: 700; color: #334155; border-bottom: 1px solid #e2e8f0;">
          ${escapeHtml(table.title)}（共 ${table.rows.length} 筆）
        </div>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; background: #ffffff;">
            <thead><tr>${ths}</tr></thead>
            <tbody>
              ${trs}
              ${totalRowHtml}
            </tbody>
          </table>
        </div>
      </div>
    `);

    textParts.push(`\n【${table.title}（共 ${table.rows.length} 筆）】`);
    table.rows.forEach((row, idx) => {
      const pairs = row.map((cell, cIdx) => `${table.headers[cIdx]?.label ?? ''}：${cell}`).join(' ｜ ');
      textParts.push(`  #${idx + 1} ${pairs}`);
    });
    if (table.totalValue) {
      textParts.push(`  ${table.totalLabel ?? '合計'}：${table.totalValue}`);
    }
  }

  // 3. Approval Chain Steps Timeline
  if (summary.steps.length > 0) {
    const stepRowsHtml = summary.steps
      .map(
        (st) => `<tr style="background: ${st.isCurrent ? '#eff6ff' : '#ffffff'};">
          <td style="padding: 10px 16px; font-size: 13px; color: #475569; border-bottom: 1px solid #f1f5f9; width: 90px; white-space: nowrap; font-weight: 600;">第 ${st.stepOrder} 關</td>
          <td style="padding: 10px 16px; font-size: 13px; font-weight: 600; color: #0f172a; border-bottom: 1px solid #f1f5f9; white-space: nowrap;">${escapeHtml(st.stepLabel)}</td>
          <td style="padding: 10px 16px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; white-space: nowrap;">${escapeHtml(st.approverName)}</td>
          <td style="padding: 10px 16px; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9; white-space: nowrap;">${stepStatusBadgeHtml(st)}</td>
        </tr>`
      )
      .join('');

    htmlParts.push(`
      <div style="margin-top: 16px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
        <div style="background: #f8fafc; padding: 12px 16px; font-size: 13px; font-weight: 700; color: #334155; border-bottom: 1px solid #e2e8f0;">
          簽核流程進度
        </div>
        <table style="width: 100%; border-collapse: collapse; background: #ffffff;">
          ${stepRowsHtml}
        </table>
      </div>
    `);

    textParts.push('\n【簽核流程進度】');
    for (const st of summary.steps) {
      const statusText =
        st.status === 'approved' || st.status === 'auto_approved'
          ? '已核准'
          : st.status === 'returned'
            ? '已退回'
            : st.isCurrent
              ? '待您簽核'
              : '待後續簽核';
      textParts.push(`  第 ${st.stepOrder} 關｜${st.stepLabel}（${st.approverName}）— ${statusText}`);
    }
  }

  let approvalActionsHtml = '';
  let approvalActionsText = '';
  let approveUrl: string | undefined;
  let returnUrl: string | undefined;

  // 4. Direct In-Email Approval Action Buttons (Symmetrical, perfectly aligned 2-button layout without icons)
  const activeStepOrder =
    summary.currentStepOrder ??
    summary.steps.find((s) => s.isCurrent)?.stepOrder ??
    null;
  const hasPendingCurrentStep =
    summary.status === 'pending_approval' ||
    summary.steps.some((s) => s.isCurrent);

  if (
    options.includeApprovalActions &&
    hasPendingCurrentStep &&
    activeStepOrder !== null
  ) {
    const urls = buildEmailApprovalUrls(options.appOrigin, {
      formType: summary.formType,
      formId: summary.formId,
      stepOrder: activeStepOrder,
      version: summary.version,
      approverEmployeeId: options.recipientEmployeeId,
    });
    approveUrl = urls.approveUrl;
    returnUrl = urls.returnUrl;

    approvalActionsHtml = `
      <div style="margin-top: 18px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; padding: 18px 20px;">
        <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 14px;">
          郵件直接簽核作業
        </div>
        <table role="presentation" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
          <tr>
            <td style="padding-right: 8px; width: 50%; vertical-align: middle;">
              <a href="${escapeHtml(approveUrl)}" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background-color: #059669; border: 1px solid #059669; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
                準許簽核
              </a>
            </td>
            <td style="padding-left: 8px; width: 50%; vertical-align: middle;">
              <a href="${escapeHtml(returnUrl)}" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background-color: #e11d48; border: 1px solid #e11d48; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
                簽核退回
              </a>
            </td>
          </tr>
        </table>
      </div>
    `;

    approvalActionsText = [
      '',
      `・準許簽核：${approveUrl}`,
      `・簽核退回：${returnUrl}`,
    ].join('\n');
  } else if (options.includeApprovalActions && summary.status === 'returned') {
    const listUrl = `${options.appOrigin.replace(/\/$/, '')}/applications?status=returned`;
    approvalActionsHtml = `
      <div style="margin-top: 16px;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
          <tr>
            <td style="padding-right: 8px; width: 50%; vertical-align: middle;">
              <a href="${escapeHtml(summary.detailUrl)}" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background: #e11d48; border: 1px solid #e11d48; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
                前往補件修改並重新送簽
              </a>
            </td>
            <td style="padding-left: 8px; width: 50%; vertical-align: middle;">
              <a href="${escapeHtml(listUrl)}" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
                查看我的退回申請單
              </a>
            </td>
          </tr>
        </table>
      </div>
    `;
    approvalActionsText = [
      '',
      `・前往補件修改並重新送簽：${summary.detailUrl}`,
      `・查看我的退回申請單：${listUrl}`,
    ].join('\n');
  } else if (options.includeApprovalActions && summary.status === 'approved') {
    const procUrl = `${options.appOrigin.replace(/\/$/, '')}/procurement`;
    approvalActionsHtml = `
      <div style="margin-top: 16px;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
          <tr>
            <td style="padding-right: 8px; width: 50%; vertical-align: middle;">
              <a href="${escapeHtml(summary.detailUrl)}" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background: #059669; border: 1px solid #059669; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
                查看核准單據與列印 PDF
              </a>
            </td>
            <td style="padding-left: 8px; width: 50%; vertical-align: middle;">
              <a href="${escapeHtml(procUrl)}" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
                前往採購工作台接續辦理
              </a>
            </td>
          </tr>
        </table>
      </div>
    `;
    approvalActionsText = [
      '',
      `・查看核准單據與列印 PDF：${summary.detailUrl}`,
      `・前往採購工作台接續辦理：${procUrl}`,
    ].join('\n');
  } else if (options.includeApprovalActions) {
    const notifUrl = `${options.appOrigin.replace(/\/$/, '')}/notifications`;
    approvalActionsHtml = `
      <div style="margin-top: 16px;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
          <tr>
            <td style="padding-right: 8px; width: 50%; vertical-align: middle;">
              <a href="${escapeHtml(summary.detailUrl)}" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background: #2563eb; border: 1px solid #2563eb; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
                立即開啟系統辦理此作業
              </a>
            </td>
            <td style="padding-left: 8px; width: 50%; vertical-align: middle;">
              <a href="${escapeHtml(notifUrl)}" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
                查看站內通知中心
              </a>
            </td>
          </tr>
        </table>
      </div>
    `;
    approvalActionsText = [
      '',
      `・立即開啟系統辦理此作業：${summary.detailUrl}`,
      `・查看站內通知中心：${notifUrl}`,
    ].join('\n');
  }

  return {
    documentDetailsHtml: htmlParts.join('\n'),
    documentDetailsText: textParts.join('\n'),
    approvalActionsHtml,
    approvalActionsText,
    approveUrl,
    returnUrl,
  };
}
