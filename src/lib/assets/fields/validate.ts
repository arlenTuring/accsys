import {
  ASSET_FIELD_SECTIONS,
  ASSET_FIELD_TYPES,
  type CreateAssetFieldInput,
  type FieldOption,
  type UpdateAssetFieldInput,
} from './types';

export function slugifyLabel(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  // stable_key must match ^[a-z][a-z0-9_]{0,63}$ — prefix custom_ and strip non-ascii
  const ascii = base
    .replace(/[^\x00-\x7f]/g, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const body = ascii || `f_${Date.now().toString(36)}`;
  const key = `c_${body}`.replace(/[^a-z0-9_]/g, '_').slice(0, 64);
  return key.match(/^[a-z][a-z0-9_]{0,63}$/) ? key : `c_${Date.now().toString(36)}`;
}

export function cleanOptions(raw: FieldOption[] | undefined): FieldOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldOption[] = [];
  const seen = new Set<string>();
  for (const o of raw.slice(0, 100)) {
    const id = String(o?.id ?? '').trim().slice(0, 64);
    const label = String(o?.label ?? '').trim().slice(0, 80);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, active: o.active !== false });
  }
  return out;
}

export function validateCreate(input: CreateAssetFieldInput): { ok: true; value: CreateAssetFieldInput & { stableKey: string } } | { ok: false; error: string } {
  const label = String(input.label ?? '').trim();
  if (label.length < 1 || label.length > 80) return { ok: false, error: '顯示名稱需 1～80 字' };
  if (!(ASSET_FIELD_TYPES as readonly string[]).includes(input.fieldType)) {
    return { ok: false, error: '不支援的欄位型別' };
  }
  if (!(ASSET_FIELD_SECTIONS as readonly string[]).includes(input.section)) {
    return { ok: false, error: '不支援的區塊' };
  }
  if (input.fieldType === 'select' || input.fieldType === 'multiselect') {
    const options = cleanOptions(input.options);
    if (options.length === 0) return { ok: false, error: '單選／多選至少需要一個選項' };
  }
  const stableKey = input.stableKey?.trim() || slugifyLabel(label);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(stableKey)) return { ok: false, error: '欄位 ID 格式無效' };
  return {
    ok: true,
    value: {
      ...input,
      label,
      help: String(input.help ?? '').slice(0, 500),
      stableKey,
      options: cleanOptions(input.options),
      storageScope: input.storageScope === 'inventory' ? 'inventory' : 'asset',
    },
  };
}

export function validateUpdate(input: UpdateAssetFieldInput): { ok: true; value: UpdateAssetFieldInput } | { ok: false; error: string } {
  if (!input.id || !/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false, error: '欄位無效' };
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return { ok: false, error: '版本無效' };
  }
  if (input.label !== undefined) {
    const label = String(input.label).trim();
    if (label.length < 1 || label.length > 80) return { ok: false, error: '顯示名稱需 1～80 字' };
  }
  if (input.fieldType !== undefined && !(ASSET_FIELD_TYPES as readonly string[]).includes(input.fieldType)) {
    return { ok: false, error: '不支援的欄位型別' };
  }
  if (input.section !== undefined && !(ASSET_FIELD_SECTIONS as readonly string[]).includes(input.section)) {
    return { ok: false, error: '不支援的區塊' };
  }
  return {
    ok: true,
    value: {
      ...input,
      label: input.label !== undefined ? String(input.label).trim() : undefined,
      help: input.help !== undefined ? String(input.help).slice(0, 500) : undefined,
      options: input.options !== undefined ? cleanOptions(input.options) : undefined,
    },
  };
}

/** Count how many stored string values cannot become ISO dates. */
export function countUnconvertibleDates(values: unknown[]): number {
  let n = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    n += 1;
  }
  return n;
}
