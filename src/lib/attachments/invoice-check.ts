import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { attachmentAnalyses, attachments } from '@/lib/db/schema';
import { getActiveCompanyProfile } from '@/lib/company/service';
import { compareBuyerTaxId, normalizeTaxId, type TaxIdCompareStatus } from '@/lib/company/tax-id';
import { readNoFollow } from '@/lib/attachments/storage';
import { extractInvoiceWithVision } from '@/lib/attachments/invoice-vision';

export const INVOICE_RULES_VERSION = 'invoice-rules-2';

export type InvoiceFieldEvidence = {
  field: string;
  value: string | null;
  page?: number;
  excerpt?: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
};

export type InvoicePageResult = {
  page: number;
  documentKind: 'invoice' | 'receipt' | 'other' | 'unknown';
  buyerTaxId: string | null;
  buyerName: string | null;
  sellerTaxId: string | null;
  sellerName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: string | null;
  currency: string | null;
  compareStatus: TaxIdCompareStatus;
  compareDetail: string;
  evidence: InvoiceFieldEvidence[];
  notes?: string;
};

export type InvoiceCheckResult = {
  complete: boolean;
  pagesAnalysed: number;
  pagesTotal: number | null;
  overallStatus: TaxIdCompareStatus;
  summary: string;
  pages: InvoicePageResult[];
  /** True when vision model was used (not just binary text sniff). */
  usedVision?: boolean;
};

/** Deterministic extractor for fixture PDFs / text that embed TEST markers. */
export function extractInvoiceFromText(text: string, page = 1): InvoicePageResult {
  const isTestDoc = /測試文件|不得報帳|TEST[_\s-]?INVOICE|TEST DOCUMENT|DO NOT CLAIM/i.test(text);
  const buyer = text.match(/(?:買方統編|Buyer Tax ID)[:：\s]*([0-9]{8})/i);
  const seller = text.match(/(?:賣方統編|Seller Tax ID)[:：\s]*([0-9]{8})/i);
  const onlySeller = /僅賣方統編|SELLER_ONLY/i.test(text);
  const noBuyer = /無買方統編|NO_BUYER/i.test(text);
  const receipt = /收據|RECEIPT/i.test(text) && !/發票|INVOICE/i.test(text);
  const unclear = /模糊|UNCLEAR/i.test(text);

  let documentKind: InvoicePageResult['documentKind'] = 'unknown';
  if (receipt) documentKind = 'receipt';
  else if (/發票|INVOICE/i.test(text) || buyer || seller) documentKind = 'invoice';
  else if (isTestDoc) documentKind = 'other';

  const buyerTaxId = onlySeller || noBuyer ? null : buyer?.[1] ?? null;
  const sellerTaxId = seller?.[1] ?? null;

  const evidence: InvoiceFieldEvidence[] = [];
  if (buyerTaxId) {
    evidence.push({ field: 'buyerTaxId', value: buyerTaxId, page, excerpt: buyer?.[0], confidence: 'high' });
  }
  if (sellerTaxId) {
    evidence.push({ field: 'sellerTaxId', value: sellerTaxId, page, excerpt: seller?.[0], confidence: 'high' });
  }

  return {
    page,
    documentKind,
    buyerTaxId,
    buyerName: null,
    sellerTaxId,
    sellerName: null,
    invoiceNumber: text.match(/(?:發票號碼|Invoice)[:：\s]*([A-Z0-9-]+)/i)?.[1] ?? null,
    invoiceDate: text.match(/(?:日期|Date)[:：\s]*([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})/i)?.[1] ?? null,
    amount: text.match(/(?:金額|Amount)[:：\s]*([0-9,.]+)/i)?.[1] ?? null,
    currency: 'TWD',
    compareStatus: 'analysis_pending',
    compareDetail: '',
    evidence,
    notes: unclear ? '影像或文字標示為不清楚' : isTestDoc ? '測試文件／不得報帳' : undefined,
  };
}

function finalizePage(
  page: InvoicePageResult,
  company: { taxId: string; version: number } | null
): InvoicePageResult {
  const compared = compareBuyerTaxId({
    companyTaxId: company?.taxId,
    companyConfigured: Boolean(company),
    extractedBuyerTaxId: page.buyerTaxId,
    confidence: page.notes?.includes('不清楚') ? 'low' : page.buyerTaxId ? 'high' : 'medium',
    documentKind: page.documentKind,
    analysisOk: true,
    analysisDone: true,
  });
  let next = { ...page, compareStatus: compared.status, compareDetail: compared.detail };
  if (
    next.sellerTaxId &&
    company &&
    normalizeTaxId(next.sellerTaxId) === normalizeTaxId(company.taxId) &&
    !next.buyerTaxId
  ) {
    next = {
      ...next,
      compareStatus: 'not_found',
      compareDetail: '僅見賣方統編，不得當作買方統編相符',
    };
  }
  return next;
}

/**
 * Shared check for formal attachments and chat→draft attach.
 * Images: Vertex vision OCR. Text PDFs / fixtures: byte text sniff first.
 */
export async function runInvoiceCheckOnBytes(input: {
  bytes: Uint8Array;
  mimeType: string;
  forceText?: string;
  modelAvailable?: boolean;
}): Promise<InvoiceCheckResult> {
  const companyProfile = await getActiveCompanyProfile();
  const company = companyProfile ? { taxId: companyProfile.taxId, version: companyProfile.version } : null;

  if (input.modelAvailable === false && !input.forceText) {
    return {
      complete: false,
      pagesAnalysed: 0,
      pagesTotal: null,
      pages: [],
      overallStatus: 'analysis_failed',
      summary: 'AI 模型不可用；安全附件仍可確認夾帶',
      usedVision: false,
    };
  }

  let page: InvoicePageResult | null = null;
  let usedVision = false;

  if (input.forceText) {
    page = extractInvoiceFromText(input.forceText, 1);
  } else {
    // Textual sniff (fixtures / text PDFs)
    let text = Buffer.from(input.bytes).toString('utf8');
    if (text.includes('\u0000')) {
      text = Buffer.from(input.bytes)
        .toString('latin1')
        .replace(/[^\x20-\x7E\u4e00-\u9fff\n\r：:]/g, ' ');
    }
    const sniffed = extractInvoiceFromText(text || 'unknown', 1);
    const sniffUseful =
      Boolean(sniffed.buyerTaxId || sniffed.sellerTaxId) ||
      sniffed.documentKind === 'invoice' ||
      sniffed.documentKind === 'receipt';

    const isImage = input.mimeType.startsWith('image/');
    if (isImage || !sniffUseful) {
      const vision = await extractInvoiceWithVision({
        bytes: input.bytes,
        mimeType: input.mimeType.startsWith('image/') ? input.mimeType : 'image/jpeg',
      });
      if (vision.ok) {
        usedVision = true;
        const v = vision.data;
        page = {
          page: 1,
          documentKind: v.documentKind,
          buyerTaxId: v.buyerTaxId,
          buyerName: v.buyerName,
          sellerTaxId: v.sellerTaxId,
          sellerName: v.sellerName,
          invoiceNumber: v.invoiceNumber,
          invoiceDate: v.invoiceDate,
          amount: v.amount,
          currency: v.currency,
          compareStatus: 'analysis_pending',
          compareDetail: '',
          evidence: [
            ...(v.buyerTaxId
              ? [
                  {
                    field: 'buyerTaxId',
                    value: v.buyerTaxId,
                    page: 1,
                    excerpt: v.rawTextExcerpt ?? undefined,
                    confidence: v.confidence,
                  } satisfies InvoiceFieldEvidence,
                ]
              : []),
            ...(v.sellerTaxId
              ? [
                  {
                    field: 'sellerTaxId',
                    value: v.sellerTaxId,
                    page: 1,
                    confidence: v.confidence,
                  } satisfies InvoiceFieldEvidence,
                ]
              : []),
          ],
          notes: v.notes ?? undefined,
        };
      } else if (sniffUseful) {
        page = sniffed;
      } else {
        return {
          complete: false,
          pagesAnalysed: 0,
          pagesTotal: 1,
          pages: [],
          overallStatus: 'analysis_failed',
          summary: `影像辨識失敗（${vision.error}）；可仍要夾帶，但不代表已核對統編`,
          usedVision: false,
        };
      }
    } else {
      page = sniffed;
    }
  }

  page = finalizePage(page!, company);
  return {
    complete: true,
    pagesAnalysed: 1,
    pagesTotal: 1,
    pages: [page],
    overallStatus: page.compareStatus,
    summary: page.compareDetail || page.notes || '已完成檢查',
    usedVision,
  };
}

export async function runInvoiceCheckForAttachment(
  attachmentId: string,
  opts?: { forceText?: string; modelAvailable?: boolean }
): Promise<{ analysisId: string; result: InvoiceCheckResult }> {
  const db = getDb();
  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!row) throw new Error('attachment_not_found');

  const company = await getActiveCompanyProfile();
  const analysisId = randomUUID();
  await db.insert(attachmentAnalyses).values({
    id: analysisId,
    attachmentId,
    kind: 'invoice_check',
    status: 'running',
    model: opts?.modelAvailable === false ? null : 'vertex-vision',
    rulesVersion: INVOICE_RULES_VERSION,
    companyProfileId: company?.id ?? null,
    companyProfileVersion: company?.version ?? null,
    result: {},
  });

  let bytes: Uint8Array;
  try {
    bytes = await readNoFollow(row.storagePath);
  } catch {
    const failed: InvoiceCheckResult = {
      complete: false,
      pagesAnalysed: 0,
      pagesTotal: null,
      pages: [],
      overallStatus: 'analysis_failed',
      summary: '無法讀取附件內容',
    };
    await db
      .update(attachmentAnalyses)
      .set({ status: 'failed', error: 'read_failed', result: failed, completedAt: new Date() })
      .where(eq(attachmentAnalyses.id, analysisId));
    return { analysisId, result: failed };
  }

  const result = await runInvoiceCheckOnBytes({
    bytes,
    mimeType: row.mimeType,
    forceText: opts?.forceText,
    modelAvailable: opts?.modelAvailable,
  });

  await db
    .update(attachmentAnalyses)
    .set({
      status: result.overallStatus === 'analysis_failed' ? 'failed' : 'ready',
      error: result.overallStatus === 'analysis_failed' ? result.summary : null,
      result,
      completedAt: new Date(),
    })
    .where(eq(attachmentAnalyses.id, analysisId));

  return { analysisId, result };
}
