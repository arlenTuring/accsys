import { CHAIRMAN_THRESHOLD } from '@/lib/approval/chain';

/**
 * Definitions written in code (until the designer exists, and as fixtures):
 * the local seed publishes them and the tests use them.
 */

/** 行政採買申請單: line items with a formula and total, budget owner, conditional steps. */
export const PURCHASE_ADMIN_SAMPLE = {
  key: 'admin-purchase',
  name: '行政採買申請單',
  description: '辦公用品、文具等小額行政採買。',
  categoryKey: 'general',
  numberPrefix: 'GA',
  schema: {
    version: 1,
    sections: [
      {
        id: 'basic',
        title: '申請內容',
        fields: [
          { id: 'subject', type: 'text', label: '主旨', required: true, width: 4, maxLength: 100, showInHeader: true },
          {
            id: 'urgency',
            type: 'radio',
            label: '時效',
            required: true,
            width: 2,
            showInHeader: true,
            options: [
              { value: 'normal', label: '一般件（3 天）' },
              { value: 'urgent', label: '急件' },
            ],
          },
          { id: 'neededBy', type: 'date', label: '需求日期', required: true, width: 2, notBeforeToday: true },
          { id: 'budget', type: 'budget_code', label: '預算編號', required: true, width: 2, semantic: 'budget_code' },
          { id: 'handler', type: 'employee', label: '承辦人', help: '指定承辦人時，承辦人會在預算負責人之後簽核', width: 2 },
          { id: 'needsIt', type: 'boolean', label: '需要資訊部協助安裝', width: 2 },
          {
            id: 'itNote',
            type: 'textarea',
            label: '安裝需求說明',
            required: true,
            width: 4,
            visibleWhen: { field: 'needsIt', op: 'eq', value: true },
          },
        ],
      },
      {
        id: 'detail',
        title: '採買明細',
        fields: [
          {
            id: 'items',
            type: 'table',
            label: '明細',
            required: true,
            width: 4,
            semantic: 'amount',
            maxRows: 20,
            totalColumn: 'amount',
            columns: [
              { id: 'name', label: '品名', type: 'text', required: true },
              { id: 'qty', label: '數量', type: 'number', required: true },
              { id: 'unitPrice', label: '單價', type: 'money', required: true },
              { id: 'amount', label: '金額', type: 'money', formula: { op: 'multiply', of: ['qty', 'unitPrice'] } },
            ],
          },
          { id: 'files', type: 'attachments', label: '報價單', help: '請附廠商報價單（PDF／圖片）', maxFiles: 5 },
          { id: 'note', type: 'notice', label: '注意事項', text: '單筆超過 NT$100,000 需董事長核准。' },
        ],
      },
    ],
  },
  flow: {
    version: 1,
    blocks: [
      { id: 'dept_manager', type: 'approver', label: '申請單位主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 } },
      { id: 'budget_owner', type: 'approver', label: '預算負責人', source: { kind: 'form_party', party: 'budget_owner', fieldId: 'budget' } },
      {
        id: 'handler',
        type: 'approver',
        label: '承辦人',
        source: { kind: 'form_party', party: 'field_employee', fieldId: 'handler' },
        onUnresolved: 'skip',
      },
      { id: 'general_manager', type: 'approver', label: '總經理', source: { kind: 'job_role', jobRole: 'general_manager', scope: 'company' } },
      {
        id: 'amount_check',
        type: 'condition',
        label: '金額判斷',
        branches: [
          {
            id: 'over_threshold',
            label: `超過 NT$${CHAIRMAN_THRESHOLD.toLocaleString('en-US')}`,
            when: { field: 'items', op: 'gt', value: CHAIRMAN_THRESHOLD },
            blocks: [{ id: 'chairman', type: 'approver', label: '董事長', source: { kind: 'job_role', jobRole: 'chairman', scope: 'company' } }],
          },
        ],
        otherwise: { label: '其他', blocks: [] },
      },
    ],
    options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'auto_approve' },
  },
} as const;
