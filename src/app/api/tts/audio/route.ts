import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  adaptTextForSpeechLocaleSync,
  cleanTextForSpeech,
  needsSpeechTranslation,
  type SpeechLangCode,
} from '@/lib/tts/speech';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Translates text into the target language via Google GTX (<300ms).
 */
async function translateViaGoogleGtx(
  text: string,
  targetLang: SpeechLangCode
): Promise<string | null> {
  const tl = targetLang === 'ja-JP' ? 'ja' : targetLang === 'en-US' ? 'en' : 'zh-TW';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(
    text.slice(0, 2500)
  )}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });
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
 * Splits text into natural sentence chunks <= maxLen characters for Google TTS synthesis.
 */
function splitIntoTtsChunks(text: string, maxLen = 160): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const rawSentences = cleaned.split(/(?<=[。！？.!?\n；;，,])\s*/);
  const chunks: string[] = [];
  let current = '';

  for (const part of rawSentences) {
    const s = part.trim();
    if (!s) continue;
    if ((current ? `${current} ${s}` : s).length <= maxLen) {
      current = current ? `${current} ${s}` : s;
    } else {
      if (current) chunks.push(current);
      if (s.length <= maxLen) {
        current = s;
      } else {
        for (let i = 0; i < s.length; i += maxLen) {
          chunks.push(s.slice(i, i + maxLen));
        }
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 12);
}

async function fetchTtsMp3Chunk(chunk: string, tl: string): Promise<Buffer | null> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
    tl
  )}&q=${encodeURIComponent(chunk)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    if (arr.byteLength < 256) return null;
    return Buffer.from(arr);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { text?: string; targetLang?: SpeechLangCode };
  try {
    body = (await request.json()) as { text?: string; targetLang?: SpeechLangCode };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const rawText = cleanTextForSpeech(body.text ?? '');
  const targetLang: SpeechLangCode =
    body.targetLang === 'en-US' || body.targetLang === 'ja-JP' ? body.targetLang : 'zh-TW';

  if (!rawText) {
    return NextResponse.json({ ok: false, error: 'Empty text' }, { status: 400 });
  }

  try {
    // 1. Ensure the text is in the target language (zh-TW, en-US, or ja-JP)
    let localizedText = rawText;
    if (needsSpeechTranslation(rawText, targetLang)) {
      const gtx = await translateViaGoogleGtx(rawText, targetLang);
      localizedText = gtx
        ? adaptTextForSpeechLocaleSync(gtx, targetLang)
        : adaptTextForSpeechLocaleSync(rawText, targetLang);
    } else {
      localizedText = adaptTextForSpeechLocaleSync(rawText, targetLang);
    }

    // 2. Synthesize natural female voice MP3 in the exact target language
    const tl = targetLang === 'ja-JP' ? 'ja' : targetLang === 'en-US' ? 'en' : 'zh-TW';
    const chunks = splitIntoTtsChunks(localizedText, 160);
    if (chunks.length === 0) {
      return NextResponse.json({ ok: false, error: 'No speakable chunks' }, { status: 400 });
    }

    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      const buf = await fetchTtsMp3Chunk(chunk, tl);
      if (buf) buffers.push(buf);
    }

    if (buffers.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Audio synthesis failed', text: localizedText },
        { status: 502 }
      );
    }

    const combined = Buffer.concat(buffers);
    const audioBase64 = combined.toString('base64');

    return NextResponse.json({
      ok: true,
      targetLang,
      text: localizedText,
      audioDataUrl: `data:audio/mpeg;base64,${audioBase64}`,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'TTS audio failed' },
      { status: 500 }
    );
  }
}
