import { standardFlow } from '@/lib/approval/flow/presets';
import type { Condition } from '@/lib/approval/flow/types';
import type { MigratedForm } from './types';

// Batch 5: the procurement chain. Each form after the 請購單 continues the
// applicant's own approved form of the previous step (關聯單據) and joins its
// case; a case holds at most one form of each kind (withdrawn ones count).
// Flow: the standard chain (申請單位主管 → 預算負責人 → 總經理 → 董事長 above
// NT$100,000); the budget owner is the owner of the rows' budget codes, which
// must all have the same owner.

export const PURCHASE_REQUEST_KEY = 'purchase-request';
export const PURCHASE_ORDER_KEY = 'purchase-order';

export const PAYMENT_TERMS = ['預付款', '貨到付款', '月結30天', '月結45天', '月結60天', '其他'] as const;

const MAX_LINES = 100;
const MAX_DAYS = 3650;
const MAX_QUANTITY = 1_000_000;

const budgetColumn = { id: 'budgetCodeId', label: '預算編號', type: 'budget_code', required: true, sameOwner: true };
const descriptionColumn = { id: 'description', label: '說明', type: 'text', required: true, maxLength: 500 };
const quantityColumn = {
  id: 'quantity',
  label: '數量',
  type: 'number',
  required: true,
  decimals: 0,
  min: 1,
  rules: [{ check: { kind: 'max', value: MAX_QUANTITY }, message: `數量不可超過 ${MAX_QUANTITY.toLocaleString('en-US')}` }],
};

export const PURCHASE_REQUEST_FORM: MigratedForm = {
  key: PURCHASE_REQUEST_KEY,
  name: '請購單',
  description: '採購流程第一步（金額超過三萬元）：填寫預算來源、申請內容與預估金額；核准後可分批接續建立一張或多張採購單。',
  categoryKey: 'procurement',
  numberPrefix: 'PR',
  sortOrder: 1,
  legacyFormType: 'purchase_request',
  schema: {
    version: 1,
    sections: [
      {
        id: 'main',
        title: '請購內容',
        description: '',
        fields: [
          {
            id: 'neededWithinDays',
            type: 'number',
            label: '預計需求天數',
            help: '預計幾天內需要（0–3650）。',
            width: 1,
            min: 0,
            max: MAX_DAYS,
            decimals: 0,
            default: 30,
            showInHeader: true,
          },
          {
            id: 'items',
            type: 'table',
            label: '請購明細',
            help: '一張請購單的所有預算編號必須屬於同一位預算負責人。提醒：未稅金額達 80,000 以上、且非隨車出售者，項目應選「設備」類的預算編號。',
            required: true,
            width: 4,
            semantic: 'amount',
            minRows: 1,
            maxRows: MAX_LINES,
            totalColumn: 'estimatedAmount',
            columns: [
              budgetColumn,
              descriptionColumn,
              quantityColumn,
              { id: 'unitPrice', label: '單價', type: 'money', required: true, min: 0.01 },
              {
                id: 'estimatedAmount',
                label: '預估費用',
                type: 'money',
                required: false,
                formula: { op: 'multiply', of: ['quantity', 'unitPrice'] },
              },
            ],
          },
        ],
      },
    ],
  },
  flow: standardFlow({ amountField: 'items', budgetField: 'items.budgetCodeId' }),
};

/** 報價單家數門檻: 3 at NT$100,000 or more, 2 at NT$30,000 or more, otherwise 1. */
const BELOW_QUOTE_THRESHOLD: Condition = {
  any: [
    { all: [{ field: 'items', op: 'gte', value: 100_000 }, { field: 'quoteCount', op: 'lt', value: 3 }] },
    { all: [{ field: 'items', op: 'gte', value: 30_000 }, { field: 'quoteCount', op: 'lt', value: 2 }] },
    { field: 'quoteCount', op: 'lt', value: 1 },
  ],
};

export const PURCHASE_ORDER_FORM: MigratedForm = {
  key: PURCHASE_ORDER_KEY,
  name: '採購單',
  description: '採購流程第二步：由已核准請購單帶入明細（支援一張請購單分批開立多張採購單），填寫供應商、付款條件並檢附合約或報價單 & 客供資料卡。',
  categoryKey: 'procurement',
  numberPrefix: 'PO',
  sortOrder: 2,
  legacyFormType: 'purchase_order',
  schema: {
    version: 1,
    sections: [
      {
        id: 'source',
        title: '來源請購單',
        description: '',
        fields: [
          {
            id: 'purchaseRequestId',
            type: 'source',
            label: '來源請購單',
            help: '選擇本人申請且已核准的請購單；支援一張請購單分批／分廠商開立多張採購單，系統自動追蹤已開立數量與剩餘額度。',
            required: true,
            width: 2,
            showInHeader: true,
            sources: [
              {
                form: PURCHASE_REQUEST_KEY,
                allowMultiple: true,
                rows: {
                  table: 'items',
                  from: 'items',
                  columns: [
                    { to: 'budgetCodeId', from: 'budgetCodeId' },
                    { to: 'description', from: 'description' },
                    { to: 'quantity', from: 'quantity' },
                  ],
                  mode: 'subset',
                  adjustableColumns: ['quantity'],
                },
              },
            ],
          },
        ],
      },
      {
        id: 'items',
        title: '採購明細',
        description: '',
        fields: [
          {
            id: 'items',
            type: 'table',
            label: '採購明細',
            help: '可保留本次要採購的項次並調整分批數量與實際採購單價。',
            required: true,
            width: 4,
            semantic: 'amount',
            minRows: 1,
            maxRows: MAX_LINES,
            totalColumn: 'totalPrice',
            columns: [
              budgetColumn,
              descriptionColumn,
              quantityColumn,
              { id: 'unitPrice', label: '單價', type: 'money', required: true, min: 0.01 },
              { id: 'totalPrice', label: '小計', type: 'money', required: false, formula: { op: 'multiply', of: ['quantity', 'unitPrice'] } },
            ],
          },
        ],
      },
      {
        id: 'terms',
        title: '供應商與付款',
        description: '',
        fields: [
          { id: 'supplierId', type: 'supplier', label: '供應商', required: true, width: 2, showInHeader: true },
          { id: 'paymentMethod', type: 'text', label: '付款方式', required: true, width: 1, maxLength: 100, format: 'plain', default: '匯款' },
          {
            id: 'paymentTerms',
            type: 'select',
            label: '付款條件（是否需預付款項才能出貨）',
            help: '若需預付款項才能出貨請選「預付款」（流程：2.採購單 → 4.費用申請單 → 3.驗收單）；非預付則為「2.採購單 → 3.驗收單 → 4.費用申請單」。',
            required: true,
            width: 1,
            options: PAYMENT_TERMS.map((t) => ({ value: t, label: t })),
            default: '貨到付款',
          },
          { id: 'expectedDeliveryDays', type: 'number', label: '預計交期天數', width: 1, min: 0, max: MAX_DAYS, decimals: 0, default: 14 },
          {
            id: 'quoteCount',
            type: 'number',
            label: '報價單家數',
            help: '合計 NT$100,000 以上需 3 家、NT$30,000 以上需 2 家，其餘 1 家。',
            required: true,
            width: 1,
            min: 0,
            max: 100,
            decimals: 0,
            default: 1,
          },
          {
            id: 'quoteCountReason',
            type: 'textarea',
            label: '未檢附其他報價單原因',
            help: '報價單家數未達門檻時必填。',
            width: 2,
            maxLength: 1000,
            rows: 3,
            requiredWhen: BELOW_QUOTE_THRESHOLD,
          },
        ],
      },
      {
        id: 'files',
        title: '附件',
        description: '',
        fields: [{ id: 'attachments', type: 'attachments', label: '合約或報價單 & 客供資料卡', required: false, width: 4, maxFiles: null }],
      },
    ],
  },
  flow: standardFlow({ amountField: 'items', budgetField: 'items.budgetCodeId' }),
};

export const ACCEPTANCE_KEY = 'acceptance';
export const PROCUREMENT_PAYMENT_KEY = 'procurement-payment';
export const STANDALONE_PAYMENT_KEY = 'standalone-payment';
/** 免走採購: the total must stay below this. */
export const STANDALONE_LIMIT = 10_000;
export const STANDALONE_LIMIT_MESSAGE = `免走採購流程的費用申請單總金額須低於 NT$ ${STANDALONE_LIMIT.toLocaleString('en-US')}，請改用一般採購流程建立`;

const attachmentsSection = (label: string) => ({
  id: 'files',
  title: '附件',
  description: '',
  fields: [{ id: 'attachments', type: 'attachments', label, required: false, width: 4, maxFiles: null }],
});

export const ACCEPTANCE_FORM: MigratedForm = {
  key: ACCEPTANCE_KEY,
  name: '驗收單',
  description: '採購流程驗收（入庫、貼財編）：由已核准採購單帶入明細（支援分批驗收；預付款案件於預付費用申請單後補辦驗收）。',
  categoryKey: 'procurement',
  numberPrefix: 'AC',
  sortOrder: 3,
  legacyFormType: 'acceptance',
  schema: {
    version: 1,
    sections: [
      {
        id: 'source',
        title: '來源採購單',
        description: '',
        fields: [
          {
            id: 'purchaseOrderId',
            type: 'source',
            label: '來源採購單',
            help: '選擇本人申請且已核准的採購單（含非預付直接驗收，或預付款先開費用申請單後到貨補驗收）；支援分批開立多張驗收單。',
            required: true,
            width: 2,
            showInHeader: true,
            sources: [
              {
                form: PURCHASE_ORDER_KEY,
                allowMultiple: true,
                rows: {
                  table: 'items',
                  from: 'items',
                  columns: [
                    { to: 'budgetCodeId', from: 'budgetCodeId' },
                    { to: 'description', from: 'description' },
                    { to: 'quantity', from: 'quantity' },
                    { to: 'amount', from: 'totalPrice' },
                  ],
                  mode: 'subset',
                  adjustableColumns: ['quantity'],
                },
              },
            ],
          },
        ],
      },
      {
        id: 'main',
        title: '驗收資料',
        description: '',
        fields: [
          { id: 'contractorSupplierId', type: 'supplier', label: '驗收廠商', required: true, width: 2, showInHeader: true },
          { id: 'acceptanceDate', type: 'date', label: '驗收日期', required: true, width: 1, notBeforeToday: false, showInHeader: true },
          {
            id: 'items',
            type: 'table',
            label: '驗收明細',
            help: '請逐項填寫驗收結果；財產編號於核准後由財會填寫。',
            required: true,
            width: 4,
            semantic: 'amount',
            minRows: 1,
            maxRows: MAX_LINES,
            totalColumn: 'amount',
            columns: [
              budgetColumn,
              descriptionColumn,
              quantityColumn,
              { id: 'amount', label: '金額', type: 'money', required: true },
              {
                id: 'passFail',
                label: '驗收結果',
                type: 'select',
                required: true,
                options: [
                  { value: 'pass', label: '合格' },
                  { value: 'fail', label: '不合格' },
                ],
                default: 'pass',
              },
              { id: 'propertyTag', label: '財產編號', type: 'text', required: false, maxLength: 100, financeFill: true },
            ],
          },
        ],
      },
      attachmentsSection('驗收照片與其他附件'),
    ],
  },
  flow: standardFlow({ amountField: 'items', budgetField: 'items.budgetCodeId' }),
};

const EMPLOYEE_PAYEE = { field: 'payeeType', op: 'eq', value: 'employee' } as const;

/** 付款對象 and the payment schedule fields shared by both payment forms. */
const payeeSection = {
  id: 'payee',
  title: '付款資訊',
  description: '',
  fields: [
    {
      id: 'payeeType',
      type: 'select',
      label: '付款對象',
      required: true,
      width: 1,
      options: [
        { value: 'supplier', label: '廠商' },
        { value: 'employee', label: '員工代墊（本人）' },
      ],
      default: 'supplier',
      showInHeader: true,
    },
    {
      id: 'payeeSupplierId',
      type: 'supplier',
      label: '付款廠商',
      required: true,
      width: 2,
      visibleWhen: { field: 'payeeType', op: 'eq', value: 'supplier' },
    },
    { id: 'bankName', type: 'text', label: '銀行名稱', required: false, width: 1, maxLength: 100, format: 'plain', visibleWhen: EMPLOYEE_PAYEE },
    {
      id: 'bankAccount',
      type: 'text',
      label: '銀行帳號',
      required: true,
      width: 1,
      maxLength: 30,
      format: 'bank_account',
      sensitive: true,
      visibleWhen: EMPLOYEE_PAYEE,
    },
    { id: 'accountName', type: 'text', label: '戶名', required: false, width: 1, maxLength: 100, format: 'plain', visibleWhen: EMPLOYEE_PAYEE },
    { id: 'paymentMethod', type: 'text', label: '付款方式', required: true, width: 1, maxLength: 100, format: 'plain', default: '匯款' },
    { id: 'invoiceMonth', type: 'text', label: '發票月份', help: '格式 YYYY-MM，例如 2026-07。', required: false, width: 1, maxLength: 7, format: 'year_month' },
    {
      id: 'expectedPaymentDate',
      type: 'date',
      label: '期望付款日',
      help: '留空時依發票月份帶入次月 25 日；送出時依付款對象排入撥款批次。',
      required: false,
      width: 1,
      notBeforeToday: false,
    },
  ],
};

const paymentLink = { payeeType: 'payeeType', invoiceMonth: 'invoiceMonth', expectedPaymentDate: 'expectedPaymentDate' };

export const PROCUREMENT_PAYMENT_FORM: MigratedForm = {
  key: PROCUREMENT_PAYMENT_KEY,
  name: '費用申請單(採購付款)',
  description: '採購流程請款：非預付於 3.驗收單核准後申請付款；預付款於 2.採購單核准後先申請付款（到貨後再補開 3.驗收單）。支援分批請款。',
  categoryKey: 'procurement',
  numberPrefix: 'PP',
  sortOrder: 4,
  legacyFormType: 'expense_request',
  schema: {
    version: 1,
    sections: [
      {
        id: 'source',
        title: '來源單據',
        description: '',
        fields: [
          {
            id: 'sourceId',
            type: 'source',
            label: '來源單據',
            help: '非預付：選已核准的「3. 驗收單」（帶入合格項目）；預付款：選付款條件為「預付款」且尚未驗收的「2. 採購單」（先請款出貨，後續再補開 3. 驗收單）。支援分批開立多張請款單。',
            required: true,
            width: 2,
            showInHeader: true,
            sources: [
              {
                form: ACCEPTANCE_KEY,
                allowMultiple: true,
                rows: {
                  table: 'items',
                  from: 'items',
                  columns: [
                    { to: 'budgetCodeId', from: 'budgetCodeId' },
                    { to: 'description', from: 'description' },
                    { to: 'quantity', from: 'quantity' },
                    { to: 'amount', from: 'amount' },
                  ],
                  filter: { column: 'passFail', value: 'pass' },
                  mode: 'subset',
                  adjustableColumns: ['quantity', 'amount'],
                },
              },
              {
                form: PURCHASE_ORDER_KEY,
                when: { field: 'paymentTerms', op: 'eq', value: '預付款' },
                unlessCaseHas: ACCEPTANCE_KEY,
                allowMultiple: true,
                rows: {
                  table: 'items',
                  from: 'items',
                  columns: [
                    { to: 'budgetCodeId', from: 'budgetCodeId' },
                    { to: 'description', from: 'description' },
                    { to: 'quantity', from: 'quantity' },
                    { to: 'amount', from: 'totalPrice' },
                  ],
                  mode: 'subset',
                  adjustableColumns: ['quantity', 'amount'],
                },
              },
            ],
          },
        ],
      },
      {
        id: 'items',
        title: '付款明細',
        description: '',
        fields: [
          {
            id: 'items',
            type: 'table',
            label: '付款明細',
            help: '可移除本次不付款的項目，至少保留一項。',
            required: true,
            width: 4,
            semantic: 'amount',
            minRows: 1,
            maxRows: MAX_LINES,
            totalColumn: 'amount',
            columns: [
              budgetColumn,
              descriptionColumn,
              { id: 'quantity', label: '數量', type: 'number', required: false, decimals: 0, min: 1, default: '1' },
              { id: 'amount', label: '金額', type: 'money', required: true },
            ],
          },
        ],
      },
      payeeSection,
      attachmentsSection('發票與其他附件'),
    ],
    payment: paymentLink,
  },
  flow: standardFlow({ amountField: 'items', budgetField: 'items.budgetCodeId' }),
};

export const STANDALONE_PAYMENT_FORM: MigratedForm = {
  key: STANDALONE_PAYMENT_KEY,
  name: '費用申請單(免走採購)',
  description: `總金額低於 NT$${STANDALONE_LIMIT.toLocaleString('en-US')}、免走請購／採購流程的付款申請。`,
  categoryKey: 'expense',
  numberPrefix: 'SE',
  sortOrder: 6,
  legacyFormType: 'standalone_expense_request',
  schema: {
    version: 1,
    sections: [
      {
        id: 'main',
        title: '費用明細',
        description: '',
        fields: [
          {
            id: 'budgetCodeId',
            type: 'budget_code',
            label: '預算編號',
            help: '需為已設定預算負責人的預算編號。',
            required: true,
            width: 2,
            semantic: 'budget_code',
            showInHeader: true,
          },
          {
            id: 'items',
            type: 'table',
            label: '費用明細',
            help: `總金額須低於 NT$${STANDALONE_LIMIT.toLocaleString('en-US')}。`,
            required: true,
            width: 4,
            semantic: 'amount',
            minRows: 1,
            maxRows: 50,
            totalColumn: 'amount',
            maxTotal: { value: STANDALONE_LIMIT - 0.01, message: STANDALONE_LIMIT_MESSAGE },
            columns: [
              descriptionColumn,
              { id: 'quantity', label: '數量', type: 'number', required: true, decimals: 0, min: 1, default: '1' },
              { id: 'amount', label: '金額', type: 'money', required: true, min: 0.01 },
            ],
          },
        ],
      },
      payeeSection,
      attachmentsSection('發票與其他附件'),
    ],
    payment: paymentLink,
  },
  flow: standardFlow({ amountField: 'items', budgetField: 'budgetCodeId' }),
};

export const PROCUREMENT_FORMS: MigratedForm[] = [
  PURCHASE_REQUEST_FORM,
  PURCHASE_ORDER_FORM,
  ACCEPTANCE_FORM,
  PROCUREMENT_PAYMENT_FORM,
  STANDALONE_PAYMENT_FORM,
];
