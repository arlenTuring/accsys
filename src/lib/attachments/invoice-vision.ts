/**
 * Vision extraction for invoice / receipt images via Vertex (same project as AI chat).
 * AI extracts fields; tax-id compare stays deterministic in invoice-check.ts.
 */
import { loadAiChatConfig } from '@/lib/ai-chat/config';
import { getVertexAccessToken } from '@/lib/ai-chat/auth';

export type VisionInvoiceExtraction = {
  documentKind: 'invoice' | 'receipt' | 'other' | 'unknown';
  buyerTaxId: string | null;
  buyerName: string | null;
  sellerTaxId: string | null;
  sellerName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: string | null;
  currency: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  notes: string | null;
  rawTextExcerpt: string | null;
};

const PROMPT = `你是發票／收據欄位抽取器。只輸出一個 JSON 物件，不要 markdown。
規則：
- buyerTaxId = 買受人／買方統一編號（8 位數字）。不要把賣方／開立人統編填進 buyerTaxId。
- sellerTaxId = 銷售人／賣方統編。
- 若看不清或找不到買方統編，buyerTaxId 填 null，confidence 用 low 或 none。
- documentKind: invoice | receipt | other | unknown
- 7-ELEVEN 電子發票證明聯通常買方統編在「買受人」欄；若無載明買方統編則 buyerTaxId=null。
JSON 鍵：documentKind,buyerTaxId,buyerName,sellerTaxId,sellerName,invoiceNumber,invoiceDate,amount,currency,confidence,notes,rawTextExcerpt`;

function endpoint(projectId: string, location: string, model: string): string {
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${model}:generateContent`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asTaxId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

function asKind(v: unknown): VisionInvoiceExtraction['documentKind'] {
  if (v === 'invoice' || v === 'receipt' || v === 'other' || v === 'unknown') return v;
  return 'unknown';
}

function asConf(v: unknown): VisionInvoiceExtraction['confidence'] {
  if (v === 'high' || v === 'medium' || v === 'low' || v === 'none') return v;
  return 'low';
}

export async function extractInvoiceWithVision(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<{ ok: true; data: VisionInvoiceExtraction } | { ok: false; error: string }> {
  const cfg = loadAiChatConfig();
  if (!cfg.enabled || !cfg.projectId) {
    return { ok: false, error: 'model_unavailable' };
  }
  const mime = input.mimeType.startsWith('image/') ? input.mimeType : 'image/jpeg';
  if (input.bytes.length === 0 || input.bytes.length > 20 * 1024 * 1024) {
    return { ok: false, error: 'image_too_large' };
  }

  let token: string;
  try {
    ({ token } = await getVertexAccessToken(cfg));
  } catch {
    return { ok: false, error: 'model_unavailable' };
  }

  let binary = '';
  for (let i = 0; i < input.bytes.length; i++) binary += String.fromCharCode(input.bytes[i]!);
  const base64 = btoa(binary);

  const url = endpoint(cfg.projectId, cfg.location, cfg.model);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': cfg.projectId,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType: mime, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    console.warn('[invoice-vision] vertex status', res.status, (await res.text()).slice(0, 200));
    return { ok: false, error: 'model_failed' };
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text!)
    .join('\n');
  const obj = parseJsonObject(text);
  if (!obj) return { ok: false, error: 'parse_failed' };

  return {
    ok: true,
    data: {
      documentKind: asKind(obj.documentKind),
      buyerTaxId: asTaxId(obj.buyerTaxId),
      buyerName: typeof obj.buyerName === 'string' ? obj.buyerName.slice(0, 120) : null,
      sellerTaxId: asTaxId(obj.sellerTaxId),
      sellerName: typeof obj.sellerName === 'string' ? obj.sellerName.slice(0, 120) : null,
      invoiceNumber: typeof obj.invoiceNumber === 'string' ? obj.invoiceNumber.slice(0, 40) : null,
      invoiceDate: typeof obj.invoiceDate === 'string' ? obj.invoiceDate.slice(0, 40) : null,
      amount: typeof obj.amount === 'string' || typeof obj.amount === 'number' ? String(obj.amount) : null,
      currency: typeof obj.currency === 'string' ? obj.currency : 'TWD',
      confidence: asConf(obj.confidence),
      notes: typeof obj.notes === 'string' ? obj.notes.slice(0, 240) : null,
      rawTextExcerpt: typeof obj.rawTextExcerpt === 'string' ? obj.rawTextExcerpt.slice(0, 400) : null,
    },
  };
}
