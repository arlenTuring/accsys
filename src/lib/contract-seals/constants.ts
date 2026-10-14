import type { SealOption } from '@/lib/seal-requests/constants';

// Codes are stored in the database (checked there too); labels follow the paper form.

export const CONTRACT_DOCUMENT_TYPES = [
  { code: 'contract', label: '合約/Contract' },
  { code: 'agreement', label: '協議書/Agreement' },
  { code: 'nda', label: '保密協議/NDA' },
  { code: 'loi', label: '意向書/LOI' },
  { code: 'mou', label: '合作備忘錄/MOU' },
] as const;
export type ContractDocumentType = (typeof CONTRACT_DOCUMENT_TYPES)[number]['code'];

/** Everything except NDA and MOU must be confirmed by the legal counsel before the seal request. */
export const LEGAL_REVIEW_DOCUMENT_TYPES: readonly ContractDocumentType[] = ['contract', 'agreement', 'loi'];

export const CONTRACT_SEAL_OPTIONS: readonly SealOption[] = [
  { code: 'perforation', label: '騎縫章(一頁以上必選)' },
  { code: 'contract_seal', label: '合約章' },
  { code: 'signature', label: '簽名' },
  { code: 'invoice_seal', label: '發票章' },
  { code: 'e_signature', label: '電子簽章' },
  { code: 'registration_seal', label: '工商登記章' },
  { code: 'bank_seal', label: '銀行印鑑章' },
];

/** Checked instead of the items when the document is not of that kind. */
export const NOT_APPLICABLE = 'not_applicable';

export const NDA_CHECKS = [
  { code: 'mutual', label: '1. 確認為雙方NDA' },
  { code: 'ip_retained', label: '2. 智慧財產所有權保留在揭露方，資料揭露不構成任何形式授權' },
  { code: 'penalty_reviewed', label: '3. 違約金金額是否過高' },
] as const;
export const NDA_NOT_APPLICABLE_LABEL = '用印文件非屬保密協議/NDA';

export const MOU_CHECKS = [
  { code: 'non_binding', label: '1. 有"無法律拘束力、具體合作事宜會再簽署正式合約"等用語' },
  { code: 'amount_range', label: '2. 盡量不涉及過度具體的金額，若需寫，可約定區間非特定數字' },
] as const;
export const MOU_NOT_APPLICABLE_LABEL = '用印文件非屬合作備忘錄/MOU';

export const DOCUMENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  CONTRACT_DOCUMENT_TYPES.map((d) => [d.code, d.label])
);
export const NDA_CHECK_LABELS: Record<string, string> = {
  ...Object.fromEntries(NDA_CHECKS.map((c) => [c.code, c.label])),
  [NOT_APPLICABLE]: NDA_NOT_APPLICABLE_LABEL,
};
export const MOU_CHECK_LABELS: Record<string, string> = {
  ...Object.fromEntries(MOU_CHECKS.map((c) => [c.code, c.label])),
  [NOT_APPLICABLE]: MOU_NOT_APPLICABLE_LABEL,
};

/** Public copy of the NDA/MOU review notes (注意事項2). */
export const NDA_MOU_NOTES_URL = '/docs/nda-mou-review-notes.pdf';
