import type { FlowDef } from '@/lib/approval/flow/types';
import { standardFlow } from '@/lib/approval/flow/presets';
import {
  CONTRACT_DOCUMENT_TYPES,
  CONTRACT_SEAL_OPTIONS,
  LEGAL_REVIEW_DOCUMENT_TYPES,
  MOU_CHECKS,
  NDA_CHECKS,
  NDA_MOU_NOTES_URL,
} from '@/lib/contract-seals/constants';
import { GENERAL_DOCUMENT_TYPES, GENERAL_SEAL_OPTIONS } from '@/lib/general-seals/constants';
import { INVOICE_CURRENCIES, INVOICE_SEALS, INVOICE_TYPES, MAX_INVOICE_LINES } from '@/lib/invoice-seals/constants';
import { NORMAL_LEAD_DAYS, SEAL_URGENCIES } from '@/lib/seal-requests/constants';
import type { MigratedForm } from './types';

// Batch 1: the three 用印申請 forms as designer definitions. Option codes are
// the ones the hard-coded forms store, so reports can read both.

const opts = (list: readonly { code: string; label: string }[]) => list.map((o) => ({ value: o.code, label: o.label }));

const ATTACHMENT_LABEL = '附件(一個檔案上限2MB，可上傳多個檔案)';

function timingFields() {
  return [
    {
      id: 'urgency',
      type: 'radio',
      label: '文件用印時效性',
      required: true,
      width: 2,
      showInHeader: true,
      options: opts(SEAL_URGENCIES),
    },
    {
      id: 'expectedCompletionDate',
      type: 'date',
      label: '期望用印完成日',
      required: true,
      width: 2,
      showInHeader: true,
      notBeforeToday: true,
      rules: [
        {
          when: { field: 'urgency', op: 'eq', value: 'normal' },
          check: { kind: 'min_days_from_today', days: NORMAL_LEAD_DAYS },
          message: `一般件需 2~3 天作業，期望用印完成日請選今天起 ${NORMAL_LEAD_DAYS} 天以後；趕件請改選急件`,
        },
      ],
    },
    {
      id: 'urgentReason',
      type: 'textarea',
      label: '急件原因與完成時間',
      required: true,
      width: 4,
      maxLength: 1000,
      rows: 2,
      visibleWhen: { field: 'urgency', op: 'eq', value: 'urgent' },
    },
    { id: 'remark', type: 'textarea', label: '備註', width: 4, maxLength: 1000, rows: 2 },
  ];
}

function sealFields(options: readonly { code: string; label: string }[]) {
  return { id: 'seals', type: 'checkboxes', label: '印鑑名稱', required: true, width: 2, options: opts(options), minSelected: 1 };
}

function lendingFields() {
  return [
    { id: 'lendSeal', type: 'boolean', label: '出借印鑑', width: 2, trueLabel: '是', falseLabel: '否' },
    {
      id: 'lendSealNote',
      type: 'textarea',
      label: '出借印鑑說明',
      help: '請說明出借原因、期間與歸還方式',
      required: true,
      width: 4,
      maxLength: 1000,
      rows: 2,
      visibleWhen: { field: 'lendSeal', op: 'eq', value: true },
    },
  ];
}

const reminder = (text: string) => ({ id: 'reminder', type: 'notice', label: '提醒', width: 4, text });

/** 申請單位主管 → 總經理 (no amount, so never the chairman). */
const MANAGER_THEN_GM: FlowDef = {
  version: 1,
  options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'auto_approve' },
  blocks: [
    { id: 'dept_manager', type: 'approver', label: '申請單位主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 }, onUnresolved: 'block' },
    { id: 'general_manager', type: 'approver', label: '總經理', source: { kind: 'job_role', jobRole: 'general_manager', scope: 'company' }, onUnresolved: 'block' },
  ],
};

export const CONTRACT_SEAL_FORM: MigratedForm = {
  key: 'contract-seal',
  name: '用印申請單(合約類)',
  description: '合約、協議書、NDA、LOI、MOU。',
  categoryKey: 'seal',
  numberPrefix: 'SC',
  sortOrder: 1,
  legacyFormType: 'contract_seal_request',
  schema: {
    version: 1,
    onBehalf: true,
    sections: [
      {
        id: 'notes',
        title: '',
        description: '',
        fields: [
          {
            id: 'notice1',
            type: 'notice',
            label: '注意事項1',
            width: 2,
            text: '1. 合約/協議書(NDA及MOU除外)之用印申請：需額外附上法律顧問確認完成信件。\n2. NDA及MOU：因無償金設定且爭議較小，故無需經法律顧問，申請人送申請前請確認下方各項須備事項。',
          },
          { id: 'notice2', type: 'notice', label: '注意事項2', width: 2, text: `NDA_MOU審閱注意事項（PDF）：${NDA_MOU_NOTES_URL}` },
        ],
      },
      { id: 'timing', title: '用印時效', description: '', fields: timingFields() },
      {
        id: 'document',
        title: '用印文件',
        description: '',
        fields: [
          { id: 'documentType', type: 'radio', label: '文件類別', required: true, width: 2, showInHeader: true, options: opts(CONTRACT_DOCUMENT_TYPES) },
          sealFields(CONTRACT_SEAL_OPTIONS),
          {
            id: 'legalReview',
            type: 'checkboxes',
            label: '法律顧問審閱',
            help: '合約、協議書與意向書須先經法律顧問審閱',
            required: true,
            width: 4,
            minSelected: 1,
            options: [{ value: 'confirmed', label: '已經管理部窗口轉法律顧問審閱，並於附件附上法律顧問確認完成信件' }],
            visibleWhen: { field: 'documentType', op: 'in', value: [...LEGAL_REVIEW_DOCUMENT_TYPES] },
          },
          { id: 'periodStart', type: 'date', label: '起始日', required: true, width: 1 },
          {
            id: 'periodEnd',
            type: 'date',
            label: '結束日',
            required: true,
            width: 1,
            rules: [{ check: { kind: 'compare', op: 'gte', field: 'periodStart' }, message: '結束日不可早於起始日' }],
          },
          {
            id: 'totalAmount',
            type: 'money',
            label: '總價',
            help: '新臺幣；無價金（如 NDA、MOU）請填 0',
            required: true,
            width: 2,
            showInHeader: true,
            semantic: 'amount',
          },
          { id: 'counterparty', type: 'text', label: '客戶/廠商名稱', required: true, width: 2, showInHeader: true, maxLength: 200 },
          { id: 'subject', type: 'text', label: '標的', required: true, width: 2, maxLength: 500 },
          {
            id: 'ndaChecks',
            type: 'checkboxes',
            label: '保密協議/NDA須備事項',
            help: `用印文件為保密協議/NDA，須完全符合 ${NDA_CHECKS.length} 個須備事項`,
            required: true,
            width: 4,
            options: opts(NDA_CHECKS),
            minSelected: NDA_CHECKS.length,
            visibleWhen: { field: 'documentType', op: 'eq', value: 'nda' },
          },
          {
            id: 'mouChecks',
            type: 'checkboxes',
            label: '合作備忘錄/MOU須備事項',
            help: `用印文件為合作備忘錄/MOU，須完全符合 ${MOU_CHECKS.length} 個須備事項`,
            required: true,
            width: 4,
            options: opts(MOU_CHECKS),
            minSelected: MOU_CHECKS.length,
            visibleWhen: { field: 'documentType', op: 'eq', value: 'mou' },
          },
        ],
      },
      { id: 'lending', title: '出借印鑑', description: '', fields: lendingFields() },
      {
        id: 'files',
        title: '附件',
        description: '',
        fields: [
          { id: 'attachments', type: 'attachments', label: ATTACHMENT_LABEL, help: '請上傳用印文件；合約、協議書、意向書另附法律顧問確認完成信件', required: true, width: 4 },
          reminder('完成線上簽核流程後，請印出核准之用印申請單，連同原始附件提供給相關單位用印/簽名，用印/簽名完成之文件，請交至管理部歸檔，謝謝。'),
        ],
      },
    ],
  },
  flow: standardFlow({ amountField: 'totalAmount' }),
};

export const GENERAL_SEAL_FORM: MigratedForm = {
  key: 'general-seal',
  name: '用印申請單(非合約類)',
  description: '報價單、公文、工商登記、銀行往來、報關等文件。',
  categoryKey: 'seal',
  numberPrefix: 'SG',
  sortOrder: 2,
  legacyFormType: 'general_seal_request',
  schema: {
    version: 1,
    onBehalf: true,
    sections: [
      { id: 'timing', title: '用印時效', description: '', fields: timingFields() },
      {
        id: 'document',
        title: '用印文件',
        description: '',
        fields: [
          { id: 'documentType', type: 'radio', label: '文件類別', required: true, width: 2, showInHeader: true, options: opts(GENERAL_DOCUMENT_TYPES) },
          sealFields(GENERAL_SEAL_OPTIONS),
          { id: 'documentDescription', type: 'textarea', label: '文件說明', required: true, width: 4, maxLength: 1000, rows: 3 },
        ],
      },
      { id: 'lending', title: '出借印鑑', description: '', fields: lendingFields() },
      {
        id: 'files',
        title: '附件',
        description: '',
        fields: [
          { id: 'attachments', type: 'attachments', label: ATTACHMENT_LABEL, help: '請上傳要用印的文件', required: true, width: 4 },
          reminder('完成線上簽核流程後，請印出核准之用印申請單，連同原始附件提供給相關單位用印/簽名，謝謝。'),
        ],
      },
    ],
  },
  flow: MANAGER_THEN_GM,
};

export const INVOICE_SEAL_FORM: MigratedForm = {
  key: 'invoice-seal',
  name: '用印申請單(開立發票/Invoice)',
  description: '開立給客戶的發票或 Invoice。',
  categoryKey: 'seal',
  numberPrefix: 'SI',
  sortOrder: 3,
  legacyFormType: 'invoice_seal_request',
  schema: {
    version: 1,
    onBehalf: true,
    sections: [
      {
        id: 'invoice',
        title: '發票資料',
        description: '',
        fields: [
          { id: 'invoiceType', type: 'radio', label: '發票形式', required: true, width: 2, showInHeader: true, options: opts(INVOICE_TYPES) },
          { id: 'seal', type: 'radio', label: '印鑑名稱', required: true, width: 2, options: opts(INVOICE_SEALS) },
          { id: 'customerName', type: 'text', label: '客戶名稱', required: true, width: 2, showInHeader: true, maxLength: 200 },
          {
            id: 'customerTaxId',
            type: 'text',
            label: '客戶統編',
            help: '三聯式發票必填；個人或國外客戶免填',
            width: 2,
            format: 'tax_id',
            maxLength: 8,
            requiredWhen: { field: 'invoiceType', op: 'eq', value: 'triplicate' },
          },
          { id: 'customerAddress', type: 'text', label: '客戶地址', required: true, width: 2, maxLength: 300 },
          { id: 'customerPhone', type: 'text', label: '客戶電話', required: true, width: 2, maxLength: 50 },
        ],
      },
      {
        id: 'items',
        title: '開立資訊',
        description: '',
        fields: [
          {
            id: 'currency',
            type: 'select',
            label: '幣別',
            required: true,
            width: 1,
            options: INVOICE_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} ${c.label}` })),
          },
          {
            id: 'lines',
            type: 'table',
            label: '開立明細',
            help: '數量 × 未稅單價 = 未稅金額',
            required: true,
            width: 4,
            minRows: 1,
            maxRows: MAX_INVOICE_LINES,
            totalColumn: 'amount',
            currencyField: 'currency',
            columns: [
              { id: 'itemName', label: '品名', type: 'text', required: true },
              { id: 'quantity', label: '數量', type: 'number', required: true, decimals: 0, min: 1 },
              { id: 'unitPrice', label: '未稅單價', type: 'money', required: true, min: 0.01 },
              { id: 'amount', label: '未稅金額', type: 'money', formula: { op: 'multiply', of: ['quantity', 'unitPrice'] } },
            ],
          },
          {
            id: 'totalWithTax',
            type: 'money',
            label: '含稅總計',
            help: '客戶為臺灣公司，請填含稅總額',
            required: true,
            width: 2,
            showInHeader: true,
            currencyField: 'currency',
            rules: [{ check: { kind: 'compare', op: 'gte', field: 'lines' }, message: '含稅總計不可小於未稅金額合計' }],
          },
        ],
      },
      {
        id: 'files',
        title: '附件',
        description: '',
        fields: [
          { id: 'attachments', type: 'attachments', label: '開立依據(一個檔案上限2MB，可上傳多個檔案)', help: '合約或報價單', required: true, width: 4 },
          reminder('完成線上簽核流程後，請印出核准之用印申請單，連同開立依據，提供給會計，謝謝。'),
        ],
      },
    ],
  },
  flow: MANAGER_THEN_GM,
};

export const SEAL_FORMS: MigratedForm[] = [CONTRACT_SEAL_FORM, GENERAL_SEAL_FORM, INVOICE_SEAL_FORM];
