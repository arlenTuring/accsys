import { NORMAL_LEAD_DAYS, SEAL_URGENCIES, type SealOption, type SealType, type SealUrgency } from '@/lib/seal-requests/constants';

// Building blocks for both seal request parsers (form = instant feedback, server = authoritative).

export class Invalid extends Error {}
export const invalid = (message: string): never => {
  throw new Invalid(message);
};

/** Runs a parser built from the helpers below; an `invalid(...)` becomes `{ ok: false, error }`. */
export function collect<T>(parse: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: parse() };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "無" (or similar) — what the forms ask for when there is nothing to say. */
export const isNone = (v: string) => ['無', '无', 'none', 'n/a', 'na'].includes(v.trim().toLowerCase());

export function text(value: unknown, label: string, max: number): string {
  if (value !== undefined && value !== null && typeof value !== 'string') invalid(`${label}格式不正確`);
  const v = ((value as string | null | undefined) ?? '').trim();
  if (v === '') invalid(`請填寫${label}`);
  if (v.length > max) invalid(`${label}不可超過 ${max} 字`);
  return v;
}

export function date(value: unknown, label: string): string {
  if (!isIsoDate(value)) invalid(`請填寫正確的${label}`);
  return value as string;
}

export function codes(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) invalid(`${label}格式不正確`);
  return [...new Set(value as string[])];
}

export function oneOf<T extends string>(value: unknown, options: readonly { code: T }[], message: string): T {
  return options.find((o) => o.code === value)?.code ?? invalid(message);
}

/** 文件用印時效性 / 期望用印完成日 / 備註. `today` is the application date (Asia/Taipei). */
export function parseTiming(input: { urgency: unknown; expectedCompletionDate: unknown; remark: unknown }, today: string) {
  const urgency: SealUrgency = oneOf(input.urgency, SEAL_URGENCIES, '請選擇文件用印時效性');
  const expectedCompletionDate = date(input.expectedCompletionDate, '期望用印完成日');
  if (expectedCompletionDate < today) invalid('期望用印完成日不可早於申請日期');
  if (urgency === 'normal' && expectedCompletionDate < addDays(today, NORMAL_LEAD_DAYS)) {
    invalid(`一般件需 2~3 天作業，期望用印完成日請選 ${addDays(today, NORMAL_LEAD_DAYS)} 以後；趕件請改選急件`);
  }
  const remark = text(input.remark, '備註（一般件請填「無」）', 1000);
  if (urgency === 'urgent' && isNone(remark)) invalid('急件請在備註註明「完成時間與急件原因」');
  return { urgency, expectedCompletionDate, remark };
}

/** 印鑑名稱: at least one of the form's options, returned in the form's order. */
export function parseSeals(value: unknown, options: readonly SealOption[]): SealType[] {
  const picked = codes(value, '印鑑名稱');
  if (picked.length === 0) invalid('請至少勾選一種印鑑名稱');
  const known = new Set<string>(options.map((s) => s.code));
  if (picked.some((s) => !known.has(s))) invalid('印鑑名稱有不正確的選項');
  return options.map((s) => s.code).filter((c) => picked.includes(c));
}

/** 出借印鑑 / 出借印鑑說明. */
export function parseLending(input: { lendSeal: unknown; lendSealNote: unknown }) {
  if (input.lendSeal !== 'yes' && input.lendSeal !== 'no') invalid('請選擇是否出借印鑑');
  const lendSeal = input.lendSeal === 'yes';
  const lendSealNote = text(input.lendSealNote, '出借印鑑說明（沒有請填「無」）', 1000);
  if (lendSeal && isNone(lendSealNote)) invalid('出借印鑑請說明出借原因、期間與歸還方式');
  return { lendSeal, lendSealNote };
}

export const uuidOrBlank = (value: unknown) => (typeof value === 'string' ? value : '');
