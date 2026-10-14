import { GENERAL_DOCUMENT_TYPES, GENERAL_SEAL_OPTIONS, type GeneralDocumentType } from '@/lib/general-seals/constants';
import type { SealType, SealUrgency } from '@/lib/seal-requests/constants';
import { collect, invalid, oneOf, parseLending, parseSeals, parseTiming, text, uuidOrBlank } from '@/lib/seal-requests/validate';

// Shared by the form (instant feedback) and the server (authoritative check).

export type GeneralSealInput = {
  applicantEmployeeId: string;
  departmentId: string;
  urgency: string;
  expectedCompletionDate: string;
  remark: string;
  documentType: string;
  documentDescription: string;
  seals: string[];
  lendSeal: string;
  lendSealNote: string;
};

export type NormalizedGeneralSeal = {
  applicantEmployeeId: string;
  departmentId: string;
  urgency: SealUrgency;
  expectedCompletionDate: string;
  remark: string;
  documentType: GeneralDocumentType;
  documentDescription: string;
  seals: SealType[];
  lendSeal: boolean;
  lendSealNote: string;
};

export type ParseResult = { ok: true; value: NormalizedGeneralSeal } | { ok: false; error: string };

/** `today` is the application date (Asia/Taipei). */
export function parseGeneralSealInput(input: GeneralSealInput, today: string): ParseResult {
  return collect(() => {
    if (!input || typeof input !== 'object') invalid('表單內容不正確');
    const timing = parseTiming(input, today);
    const documentType = oneOf(input.documentType, GENERAL_DOCUMENT_TYPES, '請選擇文件類別');
    const documentDescription = text(input.documentDescription, '文件說明', 1000);
    const seals = parseSeals(input.seals, GENERAL_SEAL_OPTIONS);
    return {
      applicantEmployeeId: uuidOrBlank(input.applicantEmployeeId),
      departmentId: uuidOrBlank(input.departmentId),
      ...timing,
      documentType,
      documentDescription,
      seals,
      ...parseLending(input),
    };
  });
}
