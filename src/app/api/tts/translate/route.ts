import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getVertexAccessToken } from '@/lib/ai-chat/auth';
import { loadAiChatConfig } from '@/lib/ai-chat/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type TargetLang = 'zh-TW' | 'en-US' | 'ja-JP';

function buildVertexUrl(projectId: string, location: string, model: string): string {
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${model}:generateContent`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

/**
 * Fast primary translation via Google Translate GTX endpoint (<300ms, zero thinking token overhead).
 */
async function translateViaGoogleGtx(text: string, targetLang: TargetLang): Promise<string | null> {
  const tl = targetLang === 'ja-JP' ? 'ja' : targetLang === 'en-US' ? 'en' : 'zh-TW';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(
    text.slice(0, 3000)
  )}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const pieces = (data[0] as Array<unknown>)
      .map((item) => (Array.isArray(item) && typeof item[0] === 'string' ? item[0] : ''))
      .join('')
      .trim();
    return pieces || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Secondary fallback via Vertex AI Gemini with thinkingBudget: 0.
 */
async function translateViaVertex(text: string, targetLang: TargetLang): Promise<string | null> {
  const cfg = loadAiChatConfig();
  if (!cfg.enabled || !cfg.projectId) return null;

  const { token } = await getVertexAccessToken(cfg);
  const url = buildVertexUrl(cfg.projectId, cfg.location, cfg.model);

  const langInstruction =
    targetLang === 'en-US'
      ? 'Translate the following text into natural spoken English (en-US). Romanize any Chinese person names. Output ONLY the translated English text without any explanation.'
      : targetLang === 'ja-JP'
        ? '以下のテキストを自然で丁寧な話し言葉の日本語（です・ます調）に翻訳してください。説明は一切省き、翻訳後の日本語テキストのみを出力してください。'
        : '請將以下文字翻譯為自然流暢的台灣繁體中文口語朗讀稿，移除所有日文假名，僅輸出翻譯後的繁體中文純文字，不要任何解釋。';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${langInstruction}\n\n---\n${text.slice(0, 3000)}` }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) return null;

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };

  const translated = (
    json.candidates?.[0]?.content?.parts
      ?.filter((p) => !p.thought)
      ?.map((p) => p.text ?? '')
      .join('') ?? ''
  ).trim();

  return translated || null;
}

export async function POST(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { text?: string; targetLang?: TargetLang };
  try {
    body = (await request.json()) as { text?: string; targetLang?: TargetLang };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const rawText = (body.text ?? '').trim();
  const targetLang: TargetLang =
    body.targetLang === 'en-US' || body.targetLang === 'ja-JP' ? body.targetLang : 'zh-TW';

  if (!rawText) {
    return NextResponse.json({ ok: true, text: '' });
  }

  try {
    const gtxTranslated = await translateViaGoogleGtx(rawText, targetLang);
    if (gtxTranslated) {
      return NextResponse.json({ ok: true, text: gtxTranslated });
    }

    const vertexTranslated = await translateViaVertex(rawText, targetLang);
    if (vertexTranslated) {
      return NextResponse.json({ ok: true, text: vertexTranslated });
    }

    return NextResponse.json({ ok: false, error: 'Translation unavailable' }, { status: 502 });
  } catch (err) {
    console.error('[/api/tts/translate] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Translation failed' },
      { status: 500 }
    );
  }
}
