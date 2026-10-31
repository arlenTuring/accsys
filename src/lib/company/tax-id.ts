/**
 * Taiwan company uniform numbers (統一編號) — 8 digits with official checksum.
 * Checksum correctness ≠ enterprise exists or invoice is valid.
 */

const WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1] as const;

export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 8);
}

/** Sum of digit products with special rule for the 7th digit when product is 10. */
function weightedDigitSum(digits: number[]): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const product = digits[i]! * WEIGHTS[i]!;
    sum += Math.floor(product / 10) + (product % 10);
  }
  return sum;
}

/**
 * Official-style checksum. Special case: if the 7th digit is 7, either
 * sum % 10 === 0 or (sum + 1) % 10 === 0 is accepted.
 */
export function isValidTaiwanTaxId(raw: string): boolean {
  const id = normalizeTaxId(raw);
  if (!/^\d{8}$/.test(id)) return false;
  const digits = id.split('').map((c) => Number(c));
  const sum = weightedDigitSum(digits);
  if (sum % 10 === 0) return true;
  if (digits[6] === 7 && (sum + 1) % 10 === 0) return true;
  return false;
}

export type TaxIdCompareStatus =
  | 'match'
  | 'mismatch'
  | 'not_found'
  | 'unclear'
  | 'not_invoice'
  | 'company_unset'
  | 'analysis_failed'
  | 'analysis_pending';

export function compareBuyerTaxId(opts: {
  companyTaxId: string | null | undefined;
  companyConfigured: boolean;
  extractedBuyerTaxId: string | null | undefined;
  confidence: 'high' | 'medium' | 'low' | 'none';
  documentKind: 'invoice' | 'receipt' | 'other' | 'unknown';
  analysisOk: boolean;
  analysisDone: boolean;
}): { status: TaxIdCompareStatus; detail: string } {
  if (!opts.analysisDone) {
    return { status: 'analysis_pending', detail: 'AI 分析尚未完成' };
  }
  if (!opts.analysisOk) {
    return { status: 'analysis_failed', detail: 'AI 分析失敗；安全掃描與夾帶不受影響' };
  }
  if (opts.documentKind === 'other') {
    return { status: 'not_invoice', detail: '文件類型非發票，不進行統編比對' };
  }
  if (!opts.companyConfigured || !opts.companyTaxId) {
    return { status: 'company_unset', detail: '尚未設定公司資訊，無法比對' };
  }
  const expected = normalizeTaxId(opts.companyTaxId);
  const got = opts.extractedBuyerTaxId ? normalizeTaxId(opts.extractedBuyerTaxId) : '';
  if (!got) {
    if (opts.confidence === 'none' || opts.confidence === 'low') {
      return { status: 'unclear', detail: '無法確認是否含有買方統編' };
    }
    return { status: 'not_found', detail: '未辨識到買方統編（不代表原件確定沒有）' };
  }
  // A number read with low confidence decides nothing, either way.
  if (opts.confidence === 'none' || opts.confidence === 'low') {
    return { status: 'unclear', detail: `買方統編看不清楚（疑似 ${got}），未能確認` };
  }
  if (got === expected) {
    return { status: 'match', detail: '買方統編與公司設定相符' };
  }
  return {
    status: 'mismatch',
    detail: `買方統編 ${got} 與公司設定 ${expected} 不符`,
  };
}
