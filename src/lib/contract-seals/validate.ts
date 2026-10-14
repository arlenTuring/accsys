import { MoneyError, toCents, type Cents } from '@/lib/money';
import {
  CONTRACT_DOCUMENT_TYPES,
  CONTRACT_SEAL_OPTIONS,
  LEGAL_REVIEW_DOCUMENT_TYPES,
  MOU_CHECKS,
  MOU_NOT_APPLICABLE_LABEL,
  NDA_CHECKS,
  NDA_NOT_APPLICABLE_LABEL,
  NOT_APPLICABLE,
  type ContractDocumentType,
} from '@/lib/contract-seals/constants';
import type { SealType, SealUrgency } from '@/lib/seal-requests/constants';
import {
  codes,
  collect,
  date,
  invalid,
  oneOf,
  parseLending,
  parseSeals,
  parseTiming,
  text,
  uuidOrBlank,
} from '@/lib/seal-requests/validate';

// Shared by the form (instant feedback) and the server (authoritative check).

export { addDays } from '@/lib/seal-requests/validate';

export type ContractSealInput = {
  applicantEmployeeId: string;
  departmentId: string;
  urgency: string;
  expectedCompletionDate: string;
  remark: string;
  documentType: string;
  seals: string[];
  periodStart: string;
  periodEnd: string;
  totalAmount: string;
  counterparty: string;
  subject: string;
  ndaChecks: string[];
  mouChecks: string[];
  legalReviewConfirmed: boolean;
  lendSeal: string;
  lendSealNote: string;
};

export type NormalizedContractSeal = {
  applicantEmployeeId: string;
  departmentId: string;
  urgency: SealUrgency;
  expectedCompletionDate: string;
  remark: string;
  documentType: ContractDocumentType;
  seals: SealType[];
  periodStart: string;
  periodEnd: string;
  totalAmount: Cents;
  counterparty: string;
  subject: string;
  ndaChecks: string[];
  mouChecks: string[];
  legalReviewConfirmed: boolean;
  lendSeal: boolean;
  lendSealNote: string;
};

export type ParseResult = { ok: true; value: NormalizedContractSeal } | { ok: false; error: string };

/**
 * NDA / MOU checklist: a document of that kind must meet every item; any
 * other document must tick only "非屬…".
 */
function checklist(
  value: unknown,
  items: readonly { code: string }[],
  applies: boolean,
  label: string,
  notApplicableLabel: string
): string[] {
  const picked = codes(value, `${label}須備事項`);
  const known = new Set([...items.map((i) => i.code), NOT_APPLICABLE]);
  if (picked.some((c) => !known.has(c))) invalid(`${label}須備事項有不正確的選項`);
  if (applies) {
    const all = items.every((i) => picked.includes(i.code));
    if (!all || picked.includes(NOT_APPLICABLE)) {
      invalid(`用印文件為${label}，須完全符合 ${items.length} 項須備事項（請逐項確認後勾選）`);
    }
    return items.map((i) => i.code);
  }
  if (picked.length !== 1 || picked[0] !== NOT_APPLICABLE) invalid(`用印文件不是${label}，請勾選「${notApplicableLabel}」`);
  return [NOT_APPLICABLE];
}

function amount(value: unknown): Cents {
  const raw = typeof value === 'string' ? value.trim() : value;
  let cents: Cents;
  try {
    cents = toCents((raw === '' || raw == null ? '0' : raw) as string);
  } catch (err) {
    return invalid(`總價：${(err as MoneyError).message}`);
  }
  if (cents < 0) invalid('總價不可為負數');
  return cents;
}

/** `today` is the application date (Asia/Taipei). */
export function parseContractSealInput(input: ContractSealInput, today: string): ParseResult {
  return collect(() => {
    if (!input || typeof input !== 'object') invalid('表單內容不正確');
    const timing = parseTiming(input, today);
    const documentType = oneOf(input.documentType, CONTRACT_DOCUMENT_TYPES, '請選擇文件類別');
    const seals = parseSeals(input.seals, CONTRACT_SEAL_OPTIONS);

    const periodStart = date(input.periodStart, '起始日');
    const periodEnd = date(input.periodEnd, '結束日');
    if (periodEnd < periodStart) invalid('結束日不可早於起始日');
    const totalAmount = amount(input.totalAmount);
    const counterparty = text(input.counterparty, '客戶/廠商名稱', 200);
    const subject = text(input.subject, '標的', 500);

    const ndaChecks = checklist(input.ndaChecks, NDA_CHECKS, documentType === 'nda', '保密協議/NDA', NDA_NOT_APPLICABLE_LABEL);
    const mouChecks = checklist(input.mouChecks, MOU_CHECKS, documentType === 'mou', '合作備忘錄/MOU', MOU_NOT_APPLICABLE_LABEL);

    const needsLegal = LEGAL_REVIEW_DOCUMENT_TYPES.includes(documentType);
    if (needsLegal && input.legalReviewConfirmed !== true) {
      invalid('合約、協議書與意向書須先經法律顧問審閱，請確認已附上法律顧問確認完成信件');
    }

    return {
      applicantEmployeeId: uuidOrBlank(input.applicantEmployeeId),
      departmentId: uuidOrBlank(input.departmentId),
      ...timing,
      documentType,
      seals,
      periodStart,
      periodEnd,
      totalAmount,
      counterparty,
      subject,
      ndaChecks,
      mouChecks,
      legalReviewConfirmed: needsLegal,
      ...parseLending(input),
    };
  });
}
