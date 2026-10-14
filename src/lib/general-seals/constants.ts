import type { SealOption } from '@/lib/seal-requests/constants';

// Codes are stored in the database (checked there too); labels follow the paper form.

export const GENERAL_DOCUMENT_TYPES = [
  { code: 'quotation', label: '報價單' },
  { code: 'general_document', label: '一般文件' },
  { code: 'project_document', label: '專案公文' },
  { code: 'registration', label: '工商登記文件' },
  { code: 'banking', label: '銀行往來文件（支票、取款條）' },
  { code: 'customs', label: '進出口報關文件' },
  { code: 'other', label: '其他' },
] as const;
export type GeneralDocumentType = (typeof GENERAL_DOCUMENT_TYPES)[number]['code'];

export const GENERAL_SEAL_OPTIONS: readonly SealOption[] = [
  { code: 'perforation', label: '騎縫章(一頁以上必選)' },
  { code: 'contract_seal', label: '合約章：合約、協議書、專案公文、一般文件' },
  { code: 'registration_seal', label: '工商登記章：工商登記之文件' },
  { code: 'bank_seal', label: '銀行印鑑章：銀行往來文件、支票、取款條' },
  { code: 'invoice_seal', label: '發票章：報價單' },
  { code: 'customs_seal', label: '進出口報關專用章' },
  { code: 'signature', label: '簽名' },
  { code: 'e_signature', label: '電子簽章' },
];

export const GENERAL_DOCUMENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  GENERAL_DOCUMENT_TYPES.map((d) => [d.code, d.label])
);
