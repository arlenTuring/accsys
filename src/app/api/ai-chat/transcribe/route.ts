import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getVertexAccessToken } from '@/lib/ai-chat/auth';
import { loadAiChatConfig, requireAiChatConfig } from '@/lib/ai-chat/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const ALLOWED_AUDIO_PREFIX = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/aac'];

function endpoint(projectId: string, location: string, model: string): string {
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${model}:generateContent`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

export async function POST(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: '無法讀取音訊內容。' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ ok: false, error: '缺少音訊檔案。' }, { status: 400 });
  }
  if (audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ ok: false, error: '音訊長度不正確或超過上限。' }, { status: 400 });
  }
  const rawType = (audio.type || 'audio/webm').split(';')[0]!.trim().toLowerCase();
  const mimeType = ALLOWED_AUDIO_PREFIX.find((p) => rawType.startsWith(p)) ?? 'audio/webm';

  try {
    const cfg = requireAiChatConfig();
    const { token } = await getVertexAccessToken(cfg);
    const bytes = Buffer.from(await audio.arrayBuffer());
    const res = await fetch(endpoint(cfg.projectId, cfg.location, cfg.model), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': cfg.projectId,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: '將這段語音逐字轉寫為繁體中文（台灣慣用詞與標點）。只輸出轉寫後的文字本身，不要加任何說明、前綴或引號；若完全聽不清楚或只有雜音則輸出空白。',
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: bytes.toString('base64'),
                },
              },
              { text: '請轉寫這段語音。' },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      let detail = raw.slice(0, 180);
      try {
        const j = JSON.parse(raw) as { error?: { message?: string } };
        if (j.error?.message) detail = j.error.message.slice(0, 180);
      } catch {
        /* ignore */
      }
      return NextResponse.json({ ok: false, error: `語音轉寫失敗（${res.status}）：${detail}` }, { status: 502 });
    }
    const parsed = JSON.parse(raw) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };
    const parts = parsed.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    return NextResponse.json({ ok: true, text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const fallbackCfg = loadAiChatConfig();
    return NextResponse.json(
      { ok: false, error: `無法連線至語音轉寫（${fallbackCfg.model}）：${msg.slice(0, 160)}` },
      { status: 500 }
    );
  }
}
