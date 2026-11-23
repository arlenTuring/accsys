import { cache } from 'react';
import { ASSET_TRANSFER_FORM } from '@/lib/custom-forms/migrated/asset-transfer';
import { BUDGET_CHANGE_KEY, BUDGET_REQUEST_KEY } from '@/lib/custom-forms/migrated/budget';
import { getFilableDefinitions } from '@/lib/custom-forms/queries';
import { FORM_CATEGORIES, type FormCategory, type RecordLink } from './catalog';

const TASK_DRIVEN_INTERNAL_FORM_KEYS = new Set<string>([
  BUDGET_REQUEST_KEY,
  BUDGET_CHANGE_KEY,
  ASSET_TRANSFER_FORM.key,
]);

const RECORD_LINK_BY_KEY: Record<string, RecordLink> = {
  'purchase-request': { label: '我的請購單', href: '/requests' },
  'purchase-order': { label: '我的採購單', href: '/purchase-orders' },
  acceptance: { label: '我的驗收單', href: '/acceptances' },
  'procurement-payment': { label: '我的採購付款', href: '/expense-requests' },
  'expense-claim': { label: '我的費用申請', href: '/expense-claims' },
  'travel-expense': { label: '我的出差報支', href: '/travel-expenses' },
  'business-trip': { label: '我的公出差旅申請單', href: '/f/business-trip' },
  'contract-seal': { label: '我的用印申請', href: '/seal-requests' },
  'general-seal': { label: '我的用印申請', href: '/seal-requests' },
  'invoice-seal': { label: '我的用印申請', href: '/seal-requests' },
};

/**
 * The catalog for the current employee: synchronized 1-to-1 with published
 * definitions in Form Builder (excluding internal task-driven forms).
 */
export const getFormCatalog = cache(async (): Promise<FormCategory[]> => {
  const designerForms = await getFilableDefinitions();
  const visibleForms = designerForms.filter(
    (f) => !TASK_DRIVEN_INTERNAL_FORM_KEYS.has(f.key) && f.categoryKey !== 'asset'
  );

  const byCategory = new Map<string, FormCategory>();
  for (const f of visibleForms) {
    let category = byCategory.get(f.categoryKey);
    if (!category) {
      const baseMeta = FORM_CATEGORIES.find((c) => c.id === f.categoryKey);
      category = {
        id: f.categoryKey,
        title: baseMeta?.title ?? f.categoryTitle,
        description: baseMeta?.description ?? f.categoryDescription,
        forms: [],
        records: [],
      };
      byCategory.set(f.categoryKey, category);
    }
    category.forms.push({
      title: f.name,
      description: f.description,
      href: `/f/${f.key}/new`,
      ...(f.legacyFormType ? { legacyType: f.legacyFormType } : {}),
    });
    const recordLink = RECORD_LINK_BY_KEY[f.key] ?? { label: `我的${f.name}`, href: `/f/${f.key}` };
    if (!category.records.some((r) => r.href === recordLink.href && r.label === recordLink.label)) {
      category.records.push(recordLink);
    }
  }

  return [...byCategory.values()].filter((c) => c.forms.length > 0);
});
