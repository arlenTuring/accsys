import { CURRENCY_LABELS, TRAVEL_CURRENCIES } from '@/lib/travel-expenses/constants';

// Codes are stored in the database (checked there too); labels follow the paper form.

export const INVOICE_TYPES = [
  { code: 'triplicate', label: '三聯式(公司)' },
  { code: 'duplicate', label: '二聯式(個人)' },
  { code: 'e_invoice', label: '電子發票' },
  { code: 'export_invoice', label: 'Invoice(國外客戶)' },
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number]['code'];

export const INVOICE_SEALS = [
  { code: 'invoice_seal', label: '發票章' },
  { code: 'contract_seal', label: '合約章' },
  { code: 'signature', label: '簽名' },
] as const;
export type InvoiceSeal = (typeof INVOICE_SEALS)[number]['code'];

export const INVOICE_CURRENCIES = TRAVEL_CURRENCIES;
export type InvoiceCurrency = (typeof INVOICE_CURRENCIES)[number]['code'];
export { CURRENCY_LABELS };

export const MAX_INVOICE_LINES = 50;

/** Taiwan business tax, only used for the 含稅 hint on the form. */
export const BUSINESS_TAX_RATE = 0.05;

export const INVOICE_TYPE_LABELS: Record<string, string> = Object.fromEntries(INVOICE_TYPES.map((t) => [t.code, t.label]));
export const INVOICE_SEAL_LABELS: Record<string, string> = Object.fromEntries(INVOICE_SEALS.map((s) => [s.code, s.label]));
