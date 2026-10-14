import { parseVisibility, type Visibility } from '@/lib/custom-forms/visibility';

/** Publish settings of a designer form (key, name, menu placement, numbering, who may file). Client-safe. */

export const FORM_KEY = /^[a-z][a-z0-9-]{1,39}$/;
export const NUMBER_PREFIX = /^[A-Z][A-Z0-9]{0,5}$/;
const CATEGORY = /^[a-z][a-z0-9_]{0,39}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

export type DefinitionSettings = {
  key: string;
  name: string;
  description: string;
  categoryKey: string;
  sortOrder: number;
  numberPrefix: string;
  visibility: Visibility;
};

export function parseSettings(raw: unknown): { ok: true; value: DefinitionSettings } | { ok: false; error: string } {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const key = str(r.key);
  if (!FORM_KEY.test(key)) return { ok: false, error: '表單代號需為 2–40 個小寫英數字或連字號，且以英文字母開頭' };
  const name = str(r.name);
  if (!name || name.length > 60 || CONTROL.test(name)) return { ok: false, error: '表單名稱需為 1–60 字' };
  const description = str(r.description);
  if (description.length > 300 || CONTROL.test(description)) return { ok: false, error: '表單說明最多 300 字' };
  const categoryKey = str(r.categoryKey);
  if (!CATEGORY.test(categoryKey)) return { ok: false, error: '請選擇入口分類' };
  const sortOrder = r.sortOrder === undefined || r.sortOrder === '' ? 0 : Number(r.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return { ok: false, error: '排序需為 0–9999 的整數' };
  const numberPrefix = str(r.numberPrefix);
  if (!NUMBER_PREFIX.test(numberPrefix)) return { ok: false, error: '表單編號字首需為 1–6 個大寫英數字，且以英文字母開頭' };
  const visibility = parseVisibility(r.visibility ?? {});
  if (!visibility.ok) return { ok: false, error: visibility.error };
  return { ok: true, value: { key, name, description, categoryKey, sortOrder, numberPrefix, visibility: visibility.value } };
}
