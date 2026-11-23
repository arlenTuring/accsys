import { CHAIRMAN_THRESHOLD } from '@/lib/approval/chain';
import { standardFlow } from '@/lib/approval/flow/presets';
import type { FlowDef } from '@/lib/approval/flow/types';
import { STANDARD_ACCOUNT_CATEGORIES } from '@/lib/budget-codes/constants';
import type { MigratedForm } from './types';

// Batch 7: 預算申請單與預算變更申請單（第 1 條：預算申請和預算變更的簽核要 e 化）
// 支援部門預算與專案預算之新增編列（核准後自動建立或更新預算編號）與額度變更／追加減（核准後自動調整年度預算金額）。

export const BUDGET_REQUEST_KEY = 'budget-request';
export const BUDGET_CHANGE_KEY = 'budget-change';

export const BUDGET_SCOPES_OPTIONS = [
  { value: 'department', label: '部門預算表（2027 年度部門預算表）' },
  { value: 'project', label: '專案預算表（2027 年度營收.產品專案預算表）' },
] as const;

export const BUDGET_CHANGE_TYPES = [
  { value: 'increase', label: '追加預算（調增）' },
  { value: 'decrease', label: '追減預算（調減）' },
  { value: 'reallocate', label: '預算流用／變更' },
] as const;

export const BUDGET_CATEGORIES = [
  ...STANDARD_ACCOUNT_CATEGORIES.map((c) => ({
    value: c.categoryName,
    label: `${c.itemCode}｜${c.accountNumber} ${c.categoryName}`,
  })),
  { value: '設備', label: '設備' },
  { value: '差旅費', label: '差旅費' },
  { value: '材料費', label: '材料費' },
  { value: '其他', label: '其他' },
] as const;

/**
 * 預算申請單簽核流程：申請單位主管 → 預算負責人（表單指定之預算負責人） → 總經理 → 超過 10 萬送董事長
 */
export const BUDGET_REQUEST_FLOW: FlowDef = {
  version: 1,
  options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'auto_approve' },
  blocks: [
    {
      id: 'dept_manager',
      type: 'approver',
      label: '申請單位主管',
      source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 },
      onUnresolved: 'block',
    },
    {
      id: 'budget_owner',
      type: 'approver',
      label: '預算負責人',
      source: { kind: 'form_party', party: 'field_employee', fieldId: 'ownerEmployeeId' },
      onUnresolved: 'block',
    },
    {
      id: 'general_manager',
      type: 'approver',
      label: '總經理',
      source: { kind: 'job_role', jobRole: 'general_manager', scope: 'company' },
      onUnresolved: 'block',
    },
    {
      id: 'amount_check',
      type: 'condition',
      label: '金額',
      branches: [
        {
          id: 'over_threshold',
          label: `合計超過 ${CHAIRMAN_THRESHOLD.toLocaleString('en-US')} 元`,
          when: { field: 'items', op: 'gt', value: CHAIRMAN_THRESHOLD },
          blocks: [
            {
              id: 'chairman',
              type: 'approver',
              label: '董事長',
              source: { kind: 'job_role', jobRole: 'chairman', scope: 'company' },
              onUnresolved: 'block',
            },
          ],
        },
      ],
      otherwise: { label: '其他', blocks: [] },
    },
  ],
};

export const BUDGET_REQUEST_FORM: MigratedForm = {
  key: BUDGET_REQUEST_KEY,
  name: '預算申請單',
  description: '年度或新增部門／專案預算編列線上簽核申請；簽核完成後自動建立或更新預算編號。',
  categoryKey: 'procurement',
  numberPrefix: 'BA',
  sortOrder: 5,
  legacyFormType: 'budget_request',
  schema: {
    version: 1,
    onBehalf: true,
    sections: [
      {
        id: 'basic',
        title: '預算編列基本資料',
        description: '請選擇部門預算表或專案預算表，並指定預算負責人。核准後系統將依明細建立或更新對應預算編號。',
        fields: [
          {
            id: 'fiscalYear',
            type: 'text',
            label: '預算年度',
            help: '例如：116（2027 年度）',
            required: true,
            width: 1,
            maxLength: 20,
            format: 'plain',
            default: '116',
            showInHeader: true,
          },
          {
            id: 'budgetScope',
            type: 'radio',
            label: '預算歸屬類型',
            required: true,
            width: 1,
            showInHeader: true,
            options: [...BUDGET_SCOPES_OPTIONS],
            default: 'department',
          },
          {
            id: 'targetDepartmentId',
            type: 'department',
            label: '歸屬部門',
            required: false,
            requiredWhen: { field: 'budgetScope', op: 'eq', value: 'department' },
            visibleWhen: { field: 'budgetScope', op: 'eq', value: 'department' },
            width: 2,
            showInHeader: true,
          },
          {
            id: 'targetProjectId',
            type: 'project',
            label: '歸屬專案',
            required: false,
            requiredWhen: { field: 'budgetScope', op: 'eq', value: 'project' },
            visibleWhen: { field: 'budgetScope', op: 'eq', value: 'project' },
            width: 2,
            showInHeader: true,
            semantic: 'project',
          },
          {
            id: 'ownerEmployeeId',
            type: 'employee',
            label: '預算負責人',
            help: '負責管控該筆預算之主管或專案經理，將自動納入簽核流程。',
            required: true,
            width: 2,
            showInHeader: true,
          },
        ],
      },
      {
        id: 'itemsSection',
        title: '',
        description: '',
        fields: [
          {
            id: 'items',
            type: 'table',
            label: '預算編列明細',
            required: true,
            width: 4,
            semantic: 'amount',
            minRows: 1,
            maxRows: 50,
            totalColumn: 'annualBudgetAmount',
            columns: [
              { id: 'code', label: '預算編號', type: 'text', required: true, unique: true, maxLength: 50 },
              {
                id: 'category',
                label: '會計科目／預算類別',
                type: 'select',
                required: true,
                options: [...BUDGET_CATEGORIES],
                default: '雜項購置',
              },
              { id: 'itemCode', label: '科目代碼', type: 'text', required: false, maxLength: 20 },
              { id: 'accountNumber', label: '會計科目編號', type: 'text', required: false, maxLength: 20 },
              { id: 'prevApprovedBudget', label: '去年核定預算(A)', type: 'money', required: false, min: 0 },
              { id: 'prevActualAmount', label: '去年實際執行數(B)', type: 'money', required: false, min: 0 },
              { id: 'm1', label: '1月', type: 'money', required: false, min: 0 },
              { id: 'm2', label: '2月', type: 'money', required: false, min: 0 },
              { id: 'm3', label: '3月', type: 'money', required: false, min: 0 },
              { id: 'm4', label: '4月', type: 'money', required: false, min: 0 },
              { id: 'm5', label: '5月', type: 'money', required: false, min: 0 },
              { id: 'm6', label: '6月', type: 'money', required: false, min: 0 },
              { id: 'm7', label: '7月', type: 'money', required: false, min: 0 },
              { id: 'm8', label: '8月', type: 'money', required: false, min: 0 },
              { id: 'm9', label: '9月', type: 'money', required: false, min: 0 },
              { id: 'm10', label: '10月', type: 'money', required: false, min: 0 },
              { id: 'm11', label: '11月', type: 'money', required: false, min: 0 },
              { id: 'm12', label: '12月', type: 'money', required: false, min: 0 },
              { id: 'annualBudgetAmount', label: '全年預算合計(C)', type: 'money', required: true, min: 0 },
              { id: 'description', label: '編列說明／差異原因分析', type: 'text', required: true, maxLength: 500 },
              { id: 'rowOrigin', label: '科目來源', type: 'text', required: false, maxLength: 30 },
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
            label: '預算計畫書或相關附件',
            help: '如有預算試算表或專案計畫書請一併檢附',
            required: false,
            width: 4,
            maxFiles: 10,
          },
        ],
      },
    ],
  },
  flow: BUDGET_REQUEST_FLOW,
};

export const BUDGET_CHANGE_FORM: MigratedForm = {
  key: BUDGET_CHANGE_KEY,
  name: '預算變更申請單',
  description: '既有預算編號之追加、追減或流用變更線上簽核申請；簽核完成後自動更新預算額度並通知財會。',
  categoryKey: 'procurement',
  numberPrefix: 'BC',
  sortOrder: 6,
  legacyFormType: 'budget_change',
  schema: {
    version: 1,
    onBehalf: true,
    sections: [
      {
        id: 'changeInfo',
        title: '預算變更內容',
        description: '請選擇欲變更之預算編號與變更類別；若為預算流用，請一併選擇轉出（流用來源）預算編號。',
        fields: [
          {
            id: 'budgetCodeId',
            type: 'budget_code',
            label: '變更目標預算編號',
            help: '欲追加、追減或轉入額度之預算編號',
            required: true,
            width: 2,
            showInHeader: true,
            semantic: 'budget_code',
          },
          {
            id: 'changeType',
            type: 'radio',
            label: '變更類型',
            required: true,
            width: 2,
            showInHeader: true,
            options: [...BUDGET_CHANGE_TYPES],
            default: 'increase',
          },
          {
            id: 'sourceBudgetCodeId',
            type: 'budget_code',
            label: '流用來源預算編號（轉出）',
            help: '選擇「預算流用／變更」時必填，核准後將自此預算扣除相應金額並轉入目標預算',
            required: false,
            requiredWhen: { field: 'changeType', op: 'eq', value: 'reallocate' },
            visibleWhen: { field: 'changeType', op: 'eq', value: 'reallocate' },
            width: 2,
            showInHeader: true,
          },
          {
            id: 'currentBudgetAmount',
            type: 'money',
            label: '原核定預算金額',
            help: '變更前之年度預算金額（供簽核人參考）',
            required: true,
            width: 1,
          },
          {
            id: 'changeAmount',
            type: 'money',
            label: '本次變更（追加／追減／流用）金額',
            help: '請填寫正數變動金額；超過 NT$100,000 將自動加簽董事長',
            required: true,
            width: 1,
            showInHeader: true,
            semantic: 'amount',
          },
          {
            id: 'newBudgetAmount',
            type: 'money',
            label: '變更後預算總額',
            help: '核准後此預算編號將更新為此年度預算金額（須大於 0）',
            required: true,
            width: 2,
            showInHeader: true,
          },
          {
            id: 'reason',
            type: 'textarea',
            label: '變更原因與影響說明',
            required: true,
            width: 4,
            maxLength: 2000,
            rows: 3,
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
            label: '相關佐證附件',
            required: false,
            width: 4,
            maxFiles: 10,
          },
        ],
      },
    ],
  },
  flow: standardFlow({ amountField: 'changeAmount', budgetField: 'budgetCodeId' }),
};

export const BUDGET_FORMS: MigratedForm[] = [BUDGET_REQUEST_FORM, BUDGET_CHANGE_FORM];
