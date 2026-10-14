import type { PayeeType } from '@/lib/expense-claims/constants';
import type { ExpenseClaimFormType } from '@/lib/procurement/form-registry';

/** 費用申請單 comes in editions that differ only in budget scope and 項目 list. */
export type ExpenseEdition = 'department' | 'project' | 'revenue' | 'minor';
export type ExpenseFormType = ExpenseClaimFormType;
/** projects.kind */
export type ProjectKind = 'product' | 'revenue';

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = { product: '產品專案', revenue: '營收專案' };

const MATERIAL = '材料 (單筆新臺幣10,000元以下)';
const EQUIPMENT = '設備 (單筆新臺幣10,000元以下)';
const SMALL_PURCHASE_MAX_CENTS = 1_000_000;
const MINOR_CATEGORIES = [
  '其他費用 (單筆新臺幣10,000元以下)',
  '設備 (單筆新臺幣10,000元以下)',
  '材料 (單筆新臺幣10,000元以下)',
  '軟體 (單筆新臺幣10,000元以下)',
  '辦公用品 (單筆新臺幣10,000元以下)',
] as const;

export type EditionConfig = {
  formType: ExpenseFormType;
  label: string;
  shortLabel: string;
  /** Budget codes of this scope are offered as 預算來源: department codes, or codes of projects of that kind. */
  budgetScope: 'department' | ProjectKind;
  budgetHint: string;
  categories: readonly string[];
  /** Per-line NT$ ceiling (in cents) for some 項目. */
  categoryMaxCents: Readonly<Record<string, number>>;
  defaultPayee: PayeeType;
};

export const EDITIONS: Record<ExpenseEdition, EditionConfig> = {
  department: {
    formType: 'department_expense',
    label: '費用申請單(部門版)',
    shortLabel: '部門版',
    budgetScope: 'department',
    budgetHint: '部門名稱+預算負責人',
    categories: [
      '職工福利',
      '交際費',
      '文具用品',
      '郵電費',
      '交通費',
      '運費',
      '修繕費',
      '廣告費',
      '水電瓦斯費',
      '保險費',
      '租金支出',
      '書報雜誌',
      '訓練費',
      '勞務費',
      '伙食費',
      '稅捐',
      '雜項購置',
      '雜費',
    ],
    categoryMaxCents: {},
    defaultPayee: 'applicant',
  },
  project: {
    formType: 'project_expense',
    label: '費用申請單(產品專案版)',
    shortLabel: '產品專案版',
    budgetScope: 'product',
    budgetHint: '專案名稱+預算負責人',
    categories: [
      MATERIAL,
      '加工費',
      '測試驗證費',
      '軟體授權費',
      '雲端服務費',
      '委外勞務費',
      '交通費',
      '運費',
      '郵電費',
      '交際費',
      '職工福利',
      '訓練費',
      '文具用品',
      '雜費',
    ],
    categoryMaxCents: { [MATERIAL]: SMALL_PURCHASE_MAX_CENTS },
    defaultPayee: 'supplier',
  },
  revenue: {
    formType: 'revenue_expense',
    label: '費用申請單(營收專案版)',
    shortLabel: '營收專案版',
    budgetScope: 'revenue',
    budgetHint: '專案名稱+預算負責人',
    categories: [
      EQUIPMENT,
      '材料',
      '加工費',
      '安裝施工費',
      '測試驗證費',
      '軟體授權費',
      '雲端服務費',
      '委外勞務費',
      '場地租金',
      '交通費',
      '運費',
      '郵電費',
      '交際費',
      '印刷費',
      '廣告費',
      '雜費',
    ],
    categoryMaxCents: { [EQUIPMENT]: SMALL_PURCHASE_MAX_CENTS },
    defaultPayee: 'supplier',
  },
  minor: {
    formType: 'minor_expense',
    label: '費用申請單(部門版_單筆一萬元以下)',
    shortLabel: '部門版_單筆一萬元以下',
    budgetScope: 'department',
    budgetHint: '部門名稱+預算負責人',
    categories: MINOR_CATEGORIES,
    categoryMaxCents: Object.fromEntries(MINOR_CATEGORIES.map((c) => [c, SMALL_PURCHASE_MAX_CENTS])),
    defaultPayee: 'supplier',
  },
};

export const EXPENSE_EDITIONS = Object.keys(EDITIONS) as ExpenseEdition[];

export function isExpenseEdition(value: unknown): value is ExpenseEdition {
  return typeof value === 'string' && (EXPENSE_EDITIONS as string[]).includes(value);
}

export const editionOfFormType = (formType: ExpenseFormType): ExpenseEdition =>
  EXPENSE_EDITIONS.find((e) => EDITIONS[e].formType === formType)!;

export function isProjectKind(value: unknown): value is ProjectKind {
  return value === 'product' || value === 'revenue';
}
