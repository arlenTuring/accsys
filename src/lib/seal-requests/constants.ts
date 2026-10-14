// Shared by the seal request forms. Codes are stored in the database (checked there too).

export const SEAL_URGENCIES = [
  { code: 'normal', label: '一般件(2~3天)' },
  { code: 'urgent', label: '急件(1天內)' },
] as const;
export type SealUrgency = (typeof SEAL_URGENCIES)[number]['code'];

/** 一般件 needs this many days between the application date and the expected completion date. */
export const NORMAL_LEAD_DAYS = 2;

export const SEAL_TYPES = [
  { code: 'perforation', short: '騎縫章' },
  { code: 'contract_seal', short: '合約章' },
  { code: 'registration_seal', short: '工商登記章' },
  { code: 'bank_seal', short: '銀行印鑑章' },
  { code: 'invoice_seal', short: '發票章' },
  { code: 'customs_seal', short: '進出口報關專用章' },
  { code: 'signature', short: '簽名' },
  { code: 'e_signature', short: '電子簽章' },
] as const;
export type SealType = (typeof SEAL_TYPES)[number]['code'];

/** One checkbox of 印鑑名稱; each form lists its own subset, in its own order and wording. */
export type SealOption = { code: SealType; label: string };

/** "NT$ 1,234" / "USD 1,234" / "—" for lists mixing seal requests with and without an amount. */
export function sealAmountLabel(amount: number | null, currency?: string): string {
  if (amount === null) return '—';
  return `${!currency || currency === 'TWD' ? 'NT$' : currency} ${amount.toLocaleString()}`;
}

export const URGENCY_LABELS: Record<string, string> = Object.fromEntries(SEAL_URGENCIES.map((u) => [u.code, u.label]));
export const SEAL_TYPE_LABELS: Record<string, string> = Object.fromEntries(SEAL_TYPES.map((s) => [s.code, s.short]));
