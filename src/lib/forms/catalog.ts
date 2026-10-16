import { FORM_LABELS } from '@/lib/procurement/form-registry';

// Single source for every "where do I file / find this form" entry point:
// the top nav menus, the /forms hub and the dashboard all render from here.

/** `legacyType`: form_type of a hard-coded form a designer form may replace (migration batches). */
export type FormEntry = { title: string; description: string; href: string; legacyType?: string };
export type RecordLink = { label: string; href: string };
export type FormCategory = {
  id: string;
  title: string;
  description: string;
  forms: FormEntry[];
  records: RecordLink[];
};

export const FORM_CATEGORIES: FormCategory[] = [
  {
    id: 'procurement',
    title: '採購流程',
    description: '請購 → 採購 → 驗收 → 付款，同一個案號串起整個採購。',
    forms: [
      { title: FORM_LABELS.purchase_request, description: '需要購買物品或服務時，先提出請購。', href: '/requests/new', legacyType: 'purchase_request' },
      { title: FORM_LABELS.purchase_order, description: '請購核准後，選擇供應商建立採購單。', href: '/purchase-orders/new', legacyType: 'purchase_order' },
      { title: FORM_LABELS.acceptance, description: '收到貨品或服務後辦理驗收。', href: '/acceptances/new', legacyType: 'acceptance' },
      { title: '費用申請單(採購付款)', description: '驗收完成或預付款時，向供應商申請付款。', href: '/expense-requests/new', legacyType: 'expense_request' },
    ],
    records: [
      { label: '我的請購單', href: '/requests' },
      { label: '我的採購單', href: '/purchase-orders' },
      { label: '我的驗收單', href: '/acceptances' },
      { label: '我的採購付款', href: '/expense-requests' },
    ],
  },
  {
    id: 'expense',
    title: '費用報支',
    description: '不需走採購的費用，依預算來源選擇對應版本；出差旅費另有專用表單。',
    forms: [
      { title: FORM_LABELS.department_expense, description: '以部門預算報支一般費用。', href: '/expense-claims/department/new', legacyType: 'department_expense' },
      { title: FORM_LABELS.minor_expense, description: '部門預算的小額支出，每筆 NT$10,000 以下。', href: '/expense-claims/minor/new', legacyType: 'minor_expense' },
      { title: FORM_LABELS.project_expense, description: '以產品專案預算報支。', href: '/expense-claims/project/new', legacyType: 'project_expense' },
      { title: FORM_LABELS.revenue_expense, description: '以營收（客戶）專案預算報支。', href: '/expense-claims/revenue/new', legacyType: 'revenue_expense' },
      { title: FORM_LABELS.travel_expense, description: '出差後填寫行程報告並報支旅費。', href: '/travel-expenses/new', legacyType: 'travel_expense' },
    ],
    records: [
      { label: '我的費用申請', href: '/expense-claims' },
      { label: '我的出差報支', href: '/travel-expenses' },
    ],
  },
  {
    id: 'seal',
    title: '用印申請',
    description: '文件需要蓋公司印章時申請，核准後印出申請單連同文件交付用印。',
    forms: [
      { title: FORM_LABELS.contract_seal_request, description: '合約、協議書、NDA、LOI、MOU。', href: '/seal-requests/contracts/new', legacyType: 'contract_seal_request' },
      {
        title: FORM_LABELS.general_seal_request,
        description: '報價單、公文、工商登記、銀行往來、報關等文件。',
        href: '/seal-requests/general/new',
        legacyType: 'general_seal_request',
      },
      { title: FORM_LABELS.invoice_seal_request, description: '開立給客戶的發票或 Invoice。', href: '/seal-requests/invoices/new', legacyType: 'invoice_seal_request' },
    ],
    records: [{ label: '我的用印申請', href: '/seal-requests' }],
  },
  {
    id: 'asset',
    title: '資產管理',
    description: '財產保管人異動、借出、合併、出售或報廢，核准後自動更新財產清冊。',
    forms: [{ title: FORM_LABELS.asset_transfer, description: '保管人異動、借出、合併、出售、報廢。', href: '/asset-transfers/new', legacyType: 'asset_transfer' }],
    records: [{ label: '我的資產異動', href: '/asset-transfers' }],
  },
];

export const FINANCE_LINKS: RecordLink[] = [
  { label: '簽核追蹤', href: '/case-tracking' },
  { label: '預算編號管理', href: '/budget-codes' },
  { label: '財產保管清冊', href: '/assets' },
];

export const ADMIN_LINKS: RecordLink[] = [
  { label: '主檔資料', href: '/admin/master-data' },
  { label: '帳號與權限', href: '/admin/accounts' },
  { label: '組織與簽核', href: '/admin/org' },
  { label: '表單設計器', href: '/admin/form-builder' },
];

/** A published designer form the viewer may file (from the database). */
export type DesignerFormEntry = {
  key: string;
  name: string;
  description: string;
  categoryKey: string;
  categoryTitle: string;
  categoryDescription: string;
  /** Hard-coded form this one replaces, if any. */
  legacyFormType?: string | null;
};

/**
 * Built-in forms plus published designer forms: each designer form joins its
 * category (new categories follow the built-in ones, in the given order) with
 * a "new" entry and its own "my records" link.
 *
 * `retired` (form_type -> designer key) lists hard-coded forms a published
 * designer form replaced: their entry is taken over in place by that designer
 * form, or dropped for viewers who may not file it. Their records links stay
 * (old forms remain readable there, and those pages list the new forms too).
 */
export function mergeCatalog(designerForms: DesignerFormEntry[], base: FormCategory[] = FORM_CATEGORIES, retired: Record<string, string> = {}): FormCategory[] {
  const categories = base.map((c) => ({ ...c, forms: [...c.forms], records: [...c.records] }));
  const byKey = new Map(designerForms.map((f) => [f.key, f]));
  const placed = new Set<string>();
  for (const c of categories) {
    c.forms = c.forms.flatMap((entry) => {
      const key = entry.legacyType ? retired[entry.legacyType] : undefined;
      if (!key) return [entry];
      const f = byKey.get(key);
      if (!f) return [];
      placed.add(f.key);
      return [{ title: f.name, description: f.description, href: `/f/${f.key}/new` }];
    });
  }
  for (const f of designerForms) {
    if (placed.has(f.key)) continue;
    let category = categories.find((c) => c.id === f.categoryKey);
    if (!category) {
      category = { id: f.categoryKey, title: f.categoryTitle, description: f.categoryDescription, forms: [], records: [] };
      categories.push(category);
    }
    category.forms.push({ title: f.name, description: f.description, href: `/f/${f.key}/new` });
    category.records.push({ label: `我的${f.name}`, href: `/f/${f.key}` });
  }
  return categories.filter((c) => c.forms.length > 0);
}

/** True when `pathname` is `href` itself or a page below it (so /assets does not match /asset-transfers). */
export function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const DESIGNER_NEW = /^\/f\/[^/]+\/new$/;

export const isNewFormPage = (pathname: string) =>
  pathname === '/forms' || DESIGNER_NEW.test(pathname) || FORM_CATEGORIES.some((c) => c.forms.some((f) => isUnder(pathname, f.href)));

export const isRecordPage = (pathname: string) =>
  !isNewFormPage(pathname) && (isUnder(pathname, '/f') || FORM_CATEGORIES.some((c) => c.records.some((r) => isUnder(pathname, r.href))));
