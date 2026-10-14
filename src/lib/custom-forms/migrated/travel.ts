import { standardFlow } from '@/lib/approval/flow/presets';
import { MAX_TRAVEL_LINES, TRAVEL_COST_CATEGORIES, TRAVEL_CURRENCIES } from '@/lib/travel-expenses/constants';
import type { MigratedForm } from './types';

// Batch 2: 出差報告暨旅費報支單. Category and currency codes are the ones the
// hard-coded form stores; field ids follow its columns.

const IN_TRIP = '日期不在出差期間內';

export const TRAVEL_EXPENSE_FORM: MigratedForm = {
  key: 'travel-expense',
  name: '出差報告暨旅費報支單',
  description: '出差後填寫行程報告並報支旅費。',
  categoryKey: 'expense',
  numberPrefix: 'TR',
  sortOrder: 5,
  legacyFormType: 'travel_expense',
  schema: {
    version: 1,
    sections: [
      {
        id: 'trip',
        title: '出差資料',
        description: '',
        fields: [
          {
            id: 'budgetCodeId',
            type: 'budget_code',
            label: '預算來源',
            help: '專案(簡稱)/部門+預算負責人',
            required: true,
            width: 2,
            showInHeader: true,
            semantic: 'budget_code',
          },
          { id: 'advanceAmount', type: 'money', label: '預支金額', help: '如於出差前已先向公司暫借旅費，請填入暫借之金額', width: 2 },
          { id: 'tripStartDate', type: 'date', label: '出差起始日', required: true, width: 1, showInHeader: true },
          {
            id: 'tripEndDate',
            type: 'date',
            label: '出差結束日',
            required: true,
            width: 1,
            showInHeader: true,
            rules: [{ check: { kind: 'compare', op: 'gte', field: 'tripStartDate' }, message: '出差結束日不可早於起始日' }],
          },
          { id: 'purpose', type: 'text', label: '出差事由', required: true, width: 2, showInHeader: true, maxLength: 1000 },
          { id: 'tripOrderNo', type: 'text', label: '本人核准之公出差旅單編號', required: true, width: 2, maxLength: 100 },
          {
            id: 'companions',
            type: 'textarea',
            label: '同行者名字及核准之公出差旅單編號',
            help: '若沒有同行者，請填入「無」',
            required: true,
            width: 2,
            maxLength: 1000,
            rows: 3,
          },
        ],
      },
      {
        id: 'report',
        title: '出差報告',
        description: '',
        fields: [
          {
            id: 'reportItems',
            type: 'table',
            label: '出差報告',
            required: true,
            width: 4,
            minRows: 1,
            maxRows: MAX_TRAVEL_LINES,
            totalColumn: null,
            columns: [
              {
                id: 'tripDate',
                label: '日期',
                type: 'date',
                required: true,
                rules: [
                  { check: { kind: 'compare', op: 'gte', field: 'tripStartDate' }, message: IN_TRIP },
                  { check: { kind: 'compare', op: 'lte', field: 'tripEndDate' }, message: IN_TRIP },
                ],
              },
              { id: 'location', label: '出差地', type: 'text', required: true, maxLength: 200 },
              { id: 'itinerary', label: '行程說明', type: 'text', required: true, maxLength: 1000 },
              { id: 'timeSlot', label: '出差時間區段', type: 'text', required: true, maxLength: 100 },
            ],
          },
        ],
      },
      {
        id: 'costs',
        title: '出差旅費結算',
        description: '',
        fields: [
          {
            id: 'costItems',
            type: 'table',
            label: '出差旅費結算',
            help: '交通費請填起訖站（自行開車請填里程）；國外出差以實際支付的幣別填寫並填入匯率，系統自動換算新臺幣金額。',
            required: true,
            width: 4,
            semantic: 'amount',
            minRows: 1,
            maxRows: MAX_TRAVEL_LINES,
            totalColumn: 'twdAmount',
            columns: [
              { id: 'expenseDate', label: '日期', type: 'date', required: true },
              {
                id: 'category',
                label: '類別',
                type: 'select',
                required: true,
                options: TRAVEL_COST_CATEGORIES.map((c) => ({ value: c, label: c })),
                default: '交通費',
              },
              { id: 'fromStation', label: '起站', type: 'text', required: false, maxLength: 100 },
              { id: 'toStation', label: '迄站', type: 'text', required: false, maxLength: 100 },
              { id: 'mileage', label: '里程', type: 'number', required: false, decimals: 1, min: 0 },
              { id: 'summary', label: '摘要', type: 'text', required: true, maxLength: 500 },
              {
                id: 'currency',
                label: '幣別',
                type: 'select',
                required: true,
                options: TRAVEL_CURRENCIES.map((c) => ({ value: c.code, label: c.label })),
                default: 'TWD',
              },
              { id: 'amount', label: '金額', type: 'money', required: true, min: 0.01, currencyColumn: 'currency' },
              { id: 'exchangeRate', label: '匯率', type: 'number', required: false, decimals: 6, rateFor: 'currency' },
              { id: 'twdAmount', label: '新臺幣金額', type: 'money', required: false, min: 0.01, formula: { op: 'multiply', of: ['amount', 'exchangeRate'] } },
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
            help: '請上傳相關費用報支附件（以悠遊卡等搭乘大眾交通工具者，請檢附購票證明；國外差旅請附上機票、登機證、購票證明/收據）',
            required: true,
            width: 4,
          },
          {
            id: 'reminder',
            type: 'notice',
            label: '提醒',
            width: 4,
            text: '完成線上簽核流程後，請印出核准之出差報告暨旅費報支單，連同原始附件繳交給會計做帳，謝謝。',
          },
        ],
      },
    ],
  },
  flow: standardFlow({ amountField: 'costItems', budgetField: 'budgetCodeId' }),
};
