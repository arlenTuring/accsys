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
  description: '採購流程第一步：列出需求與預估費用；核准後可接續建立採購單。',
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
              { id: 'estimatedAmount', label: '預估費用', type: 'money', required: true, min: 0.01 },
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
  description: '採購流程第二步：由已核准的請購單帶入明細，填寫供應商、單價與報價資訊。',
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
            help: '只能選自己申請、已核准且尚未建立採購單的請購單；明細會自動帶入。',
            required: true,
            width: 2,
            showInHeader: true,
            sources: [
              {
                form: PURCHASE_REQUEST_KEY,
                rows: {
                  table: 'items',
                  from: 'items',
                  columns: [
                    { to: 'budgetCodeId', from: 'budgetCodeId' },
                    { to: 'description', from: 'description' },
                    { to: 'quantity', from: 'quantity' },
                  ],
                  mode: 'all',
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
            help: '請為每一項請購明細填寫單價。',
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
            label: '付款條件',
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
        fields: [{ id: 'attachments', type: 'attachments', label: '報價單與其他附件', required: false, width: 4, maxFiles: null }],
      },
    ],
  },
  flow: standardFlow({ amountField: 'items', budgetField: 'items.budgetCodeId' }),
};

export const PROCUREMENT_FORMS: MigratedForm[] = [PURCHASE_REQUEST_FORM, PURCHASE_ORDER_FORM];
