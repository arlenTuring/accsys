import { standardFlow } from '@/lib/approval/flow/presets';
import {
  MAX_EXPENSE_CLAIM_LINES,
  NO_REMITTANCE,
  PAYEE_TYPE_LABELS,
  PAYEE_TYPES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
} from '@/lib/expense-claims/constants';
import { EDITIONS, type ExpenseEdition } from '@/lib/expense-claims/editions';
import { centsToNumber, type Cents } from '@/lib/money';
import { TRAVEL_CURRENCIES } from '@/lib/travel-expenses/constants';
import type { MigratedForm } from './types';

// Batch 3: the four 費用申請單 editions. Category, currency, payee and payment
// codes are the ones the hard-coded forms store; field ids follow their columns.

const NOTICES = [
  '發票或收據買受人需為台灣智慧駕駛股份有限公司、統一編號為50773141，國外INVOICE或RECEIPT買受人需為TURING DRIVE INC.。',
  '賣方名稱、統一編號、地址、電話應清晰可辨認；發票或收據若有書寫錯誤、塗改或模糊不清者均無效，需請賣方重新開立。',
  '數量乘以單價應等於總金額並應與中文大寫金額相同；發票和免用統一發票收據的總計中文大寫處，請寫"零壹貳參肆伍陸柒捌玖"。',
  '各式憑證請另外拿紙黏貼並附於費用申請單之後，憑證重要資訊請勿覆蓋。',
  '費用申請單每項填寫單一憑證資訊，並於原始憑證註記項次以便查詢，切勿合併填寫。',
];

const META: Record<ExpenseEdition, { key: string; prefix: string; sortOrder: number; description: string }> = {
  department: { key: 'department-expense', prefix: 'DE', sortOrder: 1, description: '以部門預算報支一般費用。' },
  minor: { key: 'minor-expense', prefix: 'ME', sortOrder: 2, description: '部門預算的小額支出，每筆 NT$10,000 以下。' },
  project: { key: 'project-expense', prefix: 'PE', sortOrder: 3, description: '以產品專案預算報支。' },
  revenue: { key: 'revenue-expense', prefix: 'RE', sortOrder: 4, description: '以營收（客戶）專案預算報支。' },
};

/** One max rule per distinct ceiling, applied to the rows whose 項目 has it. */
function capRules(edition: ExpenseEdition) {
  const byMax = new Map<number, string[]>();
  for (const [category, cents] of Object.entries(EDITIONS[edition].categoryMaxCents)) {
    byMax.set(cents, [...(byMax.get(cents) ?? []), category]);
  }
  return [...byMax].map(([cents, categories]) => {
    const max = centsToNumber(cents as Cents);
    return {
      check: { kind: 'max', value: max },
      when: { column: 'category', in: categories },
      message: `單筆不可超過新臺幣 ${max.toLocaleString('en-US')} 元，超過請走請購流程`,
    };
  });
}

function expenseClaimForm(edition: ExpenseEdition): MigratedForm {
  const config = EDITIONS[edition];
  const meta = META[edition];
  const caps = capRules(edition);
  return {
    key: meta.key,
    name: config.label,
    description: meta.description,
    categoryKey: 'expense',
    numberPrefix: meta.prefix,
    sortOrder: meta.sortOrder,
    legacyFormType: config.formType,
    schema: {
      version: 1,
      sections: [
        {
          id: 'claim',
          title: '請款內容',
          description: '',
          fields: [
            {
              id: 'budgetCodeId',
              type: 'budget_code',
              label: '預算來源',
              help: config.budgetHint,
              required: true,
              width: 2,
              showInHeader: true,
              semantic: 'budget_code',
              budgetScope: config.budgetScope,
            },
            {
              id: 'items',
              type: 'table',
              label: '請款內容',
              help: '外幣請以實際支付的幣別填寫並填入匯率，系統自動換算新臺幣小計。',
              required: true,
              width: 4,
              semantic: 'amount',
              minRows: 1,
              maxRows: MAX_EXPENSE_CLAIM_LINES,
              totalColumn: 'twdAmount',
              columns: [
                {
                  id: 'category',
                  label: '項目',
                  type: 'select',
                  required: true,
                  options: config.categories.map((c) => ({ value: c, label: c })),
                  default: config.categories[0],
                },
                { id: 'description', label: '內容或說明', type: 'text', required: true, maxLength: 500 },
                {
                  id: 'currency',
                  label: '幣別',
                  type: 'select',
                  required: true,
                  options: TRAVEL_CURRENCIES.map((c) => ({ value: c.code, label: c.label })),
                  default: 'TWD',
                },
                { id: 'exchangeRate', label: '匯率', type: 'number', required: false, decimals: 6, rateFor: 'currency' },
                { id: 'amount', label: '金額', type: 'money', required: true, min: 0.01, currencyColumn: 'currency' },
                {
                  id: 'twdAmount',
                  label: '小計',
                  type: 'money',
                  required: false,
                  min: 0.01,
                  formula: { op: 'multiply', of: ['amount', 'exchangeRate'] },
                  ...(caps.length > 0 ? { rules: caps } : {}),
                },
              ],
            },
            { id: 'remark', type: 'textarea', label: '備註', width: 4, maxLength: 1000, rows: 3 },
          ],
        },
        {
          id: 'payment',
          title: '付款資訊',
          description: '',
          fields: [
            {
              id: 'payeeType',
              type: 'select',
              label: '付款對象',
              required: true,
              width: 2,
              options: PAYEE_TYPES.map((p) => ({ value: p, label: PAYEE_TYPE_LABELS[p] })),
              default: config.defaultPayee,
            },
            {
              id: 'payeeSupplierId',
              type: 'supplier',
              label: '付款廠商',
              required: true,
              width: 2,
              visibleWhen: { field: 'payeeType', op: 'eq', value: 'supplier' },
            },
            {
              id: 'expectedPaymentDate',
              type: 'date',
              label: '期望付款日',
              help: '1.員工代墊付款日為每月15號與30號、廠商付款日為次月25號。 2.收件截止日為付款前5個工作日。',
              required: true,
              width: 2,
              showInHeader: true,
              notBeforeToday: true,
            },
            {
              id: 'paymentMethod',
              type: 'select',
              label: '付款方式',
              required: true,
              width: 2,
              options: PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })),
              default: 'transfer',
            },
            {
              id: 'remittanceInfo',
              type: 'textarea',
              label: '匯款資訊',
              help: '請填入"銀行名稱+銀行戶名+銀行帳號"；若不是選擇匯款，請填入"無"',
              required: true,
              width: 4,
              maxLength: 500,
              rows: 3,
              sensitive: true,
              rules: [
                {
                  when: { field: 'paymentMethod', op: 'eq', value: 'transfer' },
                  check: { kind: 'not_equal', value: NO_REMITTANCE },
                  message: '付款方式為匯款時，請填入「銀行名稱+銀行戶名+銀行帳號」',
                },
              ],
            },
          ],
        },
        {
          id: 'files',
          title: '附件',
          description: '',
          fields: [
            {
              id: 'attachments',
              type: 'attachments',
              label: '附件(一個檔案上限2MB，可上傳多個檔案)',
              help: '請上傳相關費用報支附件',
              required: true,
              width: 4,
            },
            { id: 'notices', type: 'notice', label: '注意事項', width: 4, text: NOTICES.map((n, i) => `${i + 1}. ${n}`).join('\n') },
            {
              id: 'reminder',
              type: 'notice',
              label: '提醒',
              width: 4,
              text: '完成線上簽核流程後，請印出核准之費用申請單，連同原始附件繳交給會計做帳，謝謝。',
            },
          ],
        },
      ],
    },
    flow: standardFlow({ amountField: 'items', budgetField: 'budgetCodeId' }),
  };
}

export const EXPENSE_CLAIM_FORMS: MigratedForm[] = (['department', 'minor', 'project', 'revenue'] as const).map(expenseClaimForm);
