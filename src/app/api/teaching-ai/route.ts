import { NextResponse } from 'next/server';
import { getVertexAccessToken } from '@/lib/ai-chat/auth';
import { requireAiChatConfig } from '@/lib/ai-chat/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PERSONAS: Record<string, { name: string; subject: string; persona: string; defaultVoice: string; voiceStyle: string }> = {
  math: {
    name: '呼呼',
    subject: '數學',
    persona: '圓滾滾的送信貓頭鷹老師，有著像《地縛少年花子君》花子君一樣調皮又神秘的少年性格，喜歡先把算式蓋住笑著問「嘿嘿～你怎麼知道的？」。',
    defaultVoice: 'clone:hanako_whisper:emb',
    voiceStyle:
      '請模仿日本傳奇聲優「緒方惠美」配音《地縛少年花子君》男主角「花子君」的招牌少年音演技（使用自然台灣繁體中文口音，不捲舌）！' +
      '聲線特徵：帶有微沙磁性的13歲中性少年音（女中音反串少年感）。' +
      '演技要求：開頭先帶著壞壞又可愛的氣音輕笑或慵懶拉長尾音，語氣調皮愛捉弄人、尾音上揚有彈性；講到關鍵句時，突然壓低嗓音變成貼在耳邊低語般的神秘磁性低音：',
  },
  english: {
    name: '咪咪',
    subject: '英文',
    persona:
      '戴金色大鈴鐺的虎斑小貓老師，有著像花子君一樣鬼靈精怪的調皮少年感，同時具備「Yalft / 瑞杰老師（史瑞杰 Erik）30天英語思維」的深度底層教學法：' +
      '1. 【反常識破題】：開頭先打破死背單字或死背文法的迷思（例如「外國人說話才不會在腦子裡想什麼定語從句！」）。' +
      '2. 【詞源畫面與歷史溯源】：不教「A = B」中譯英對照表，而是給出單字與介系詞的「母語底層畫面或歷史故事」（例如 can 為什麼是罐頭？因為源自拉丁語 canna 空心蘆葦管；cow 與 beef 為什麼不同？因為一千年前英國農民養 cow、法國貴族吃 beef；on 是接觸貼合表面、in 是包覆在容器空間裡）。' +
      '3. 【第一性原理骨架】：把複雜句子降維成「主動賓（誰做什麼）＋方地時（方式、地點、時間）」，看到場景直接用英文畫面反應開口。',
    defaultVoice: 'clone:hanako_whisper:emb',
    voiceStyle:
      '請模仿日本傳奇聲優「緒方惠美」配音《地縛少年花子君》男主角「花子君」的招牌少年音演技（台灣繁體中文夾雜道地英文發音）！' +
      '帶有微沙磁性的中性少年音，開頭帶著調皮輕笑與氣音，尾音靈動上揚，關鍵句突然貼耳低語：',
  },
  social: {
    name: '途途',
    subject: '社會',
    persona: '戴飛行護目鏡的探險小狐狸老師，像花子君講述學園七大不可思議一樣，帶著神秘又調皮的語氣把地理歷史當成偵探推理。',
    defaultVoice: 'clone:hanako_whisper:emb',
    voiceStyle:
      '請模仿日本聲優「緒方惠美」配音《地縛少年花子君》的微沙磁性少年音（自然台灣繁體中文口音），像在講述神秘怪談傳說一樣，前半段調皮捉弄、後半段壓低聲音貼耳低語：',
  },
  science: {
    name: '芽芽',
    subject: '自然',
    persona: '頭上長出小嫩芽與寶石的青蛙鍊金術師老師，像花子君一樣調皮又神秘，講話前會先歪頭笑說「嘿嘿～先猜猜看會怎樣？」。',
    defaultVoice: 'clone:hanako_whisper:emb',
    voiceStyle:
      '請模仿日本聲優「緒方惠美」配音《地縛少年花子君》的清冷微沙少年音（自然台灣繁體中文口音），帶著調皮輕笑與神秘反差感：',
  },
};

const TOOL_DECLARATIONS = [
  {
    name: 'classroom_action',
    description: '控制電視上的角色表情、手勢、以及黑板畫面進度。每次回答時請務必同時呼叫此工具！',
    parameters: {
      type: 'OBJECT',
      properties: {
        express: {
          type: 'STRING',
          description: '老師臉部表情',
          enum: ['neutral', 'happy', 'excited', 'thinking', 'surprised', 'encouraging', 'listening'],
        },
        gesture: {
          type: 'STRING',
          description: '老師肢體手勢',
          enum: ['rest', 'wave', 'point', 'explain', 'think', 'thumbsup', 'celebrate'],
        },
        boardAction: {
          type: 'STRING',
          description: '是否操作電視黑板：none(留在當前題討論)、reveal(揭曉提示或答案)、next(進入下一題)、prev(回上一題)、gradeCorrect(判定學生答對加星星)、gradeRetry(請學生再想一下)',
          enum: ['none', 'reveal', 'next', 'prev', 'gradeCorrect', 'gradeRetry'],
        },
      },
      required: ['express', 'gesture', 'boardAction'],
    },
  },
];

function pcm24kToWav(pcmBuffer: Buffer, sampleRate = 24000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

let aiHistory: Array<{ role: 'user' | 'model'; text: string }> = [];

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const cfg = requireAiChatConfig();
  return NextResponse.json(
    {
      ok: true,
      model: cfg.model,
      ttsModel: 'gemini-2.5-flash-preview-tts',
      projectId: cfg.projectId,
      location: cfg.location,
    },
    { headers: CORS }
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (payload.reset) aiHistory = [];

    const teacherId = typeof payload.teacherId === 'string' && PERSONAS[payload.teacherId] ? payload.teacherId : 'math';
    const t = PERSONAS[teacherId]!;
    const userText = (typeof payload.text === 'string' ? payload.text.trim() : '') || '請開始這堂課的教學並引導我思考！';
    const requestedVoice = typeof payload.voiceName === 'string' && payload.voiceName ? payload.voiceName : t.defaultVoice;

    const cfg = requireAiChatConfig();
    const { token } = await getVertexAccessToken(cfg);
    const host = cfg.location === 'global' ? 'aiplatform.googleapis.com' : `${cfg.location}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${cfg.projectId}/locations/${cfg.location}/publishers/google/models/${cfg.model}:generateContent`;

    const sysPrompt = [
      `你是家庭教室的 2D 吉祥物老師「${t.name}」（負責科目：${t.subject}）。`,
      `角色設定：${t.persona}`,
      '你正在電視畫面的右下角跟國小孩子（小四或小六）進行一對一的即時語音互動上課。',
      '【非常重要的說話與教學原則】：',
      '1. 請務必在同一個回應中同時產生「給孩子的口語回覆文字（text）」以及呼叫 `classroom_action` 工具！',
      '2. 語氣風格請參考《地縛少年花子君》男主角「花子君」（聲優緒方惠美）：調皮、愛捉弄人又帶點神秘反差萌的少年語氣！開頭可以自然加上「嘿嘿～」「吶吶～」「喔～？」，先故意逗一下孩子或給一個充滿畫面的神秘提示，關鍵時刻又溫柔肯定他，再反問一個小問題。',
      '3. 每次回答控制在 2 到 3 句話以內（約 35～70 字），使用自然台灣繁體中文口語，絕對不要使用 Markdown 符號（不要 ** 或條列號）。',
      payload.stepContext ? `目前黑板題目資訊：${JSON.stringify(payload.stepContext)}` : '',
    ].filter(Boolean).join('\n');

    const contents = [
      ...aiHistory.slice(-8).map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })),
      { role: 'user', parts: [{ text: userText }] },
    ];

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': cfg.projectId,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sysPrompt }] },
        contents,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Vertex ${cfg.model} HTTP ${res.status}: ${errText.slice(0, 300)}` }, { status: 500, headers: CORS });
    }

    const data = (await res.json()) as Record<string, unknown>;
    const candidates = (data.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }>) || [];
    const parts = candidates[0]?.content?.parts || [];

    let replyText = '';
    let action = { express: 'encouraging', gesture: 'explain', boardAction: 'none' };

    for (const p of parts) {
      if (typeof p.text === 'string' && !p.thought) {
        replyText += p.text;
      }
      if (p.functionCall && typeof p.functionCall === 'object') {
        const fc = p.functionCall as { name?: string; args?: Record<string, string> };
        if (fc.name === 'classroom_action' && fc.args) {
          action = {
            express: fc.args.express || 'encouraging',
            gesture: fc.args.gesture || 'explain',
            boardAction: fc.args.boardAction || 'none',
          };
        }
      }
    }

    if (!replyText.trim()) {
      const r2 = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': cfg.projectId,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sysPrompt }] },
          contents: [
            ...contents,
            { role: 'model', parts },
            {
              role: 'user',
              parts: [{
                functionResponse: {
                  name: 'classroom_action',
                  response: { status: 'ok', applied: action },
                },
              }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 350,
            thinkingConfig: { thinkingLevel: 'LOW' },
          },
        }),
      });
      if (r2.ok) {
        const d2 = (await r2.json()) as Record<string, unknown>;
        const c2 = (d2.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }>) || [];
        for (const p of c2[0]?.content?.parts || []) {
          if (typeof p.text === 'string' && !p.thought) replyText += p.text;
        }
      }
    }

    replyText = replyText.replace(/[*#_`~]/g, '').trim();
    const brainLatencyMs = Date.now() - startedAt;

    aiHistory.push({ role: 'user', text: userText });
    aiHistory.push({ role: 'model', text: replyText });

    // Synthesize human-like expressive voice via Local Apple Silicon MLX Megumi Ogata Clone first, fallback to Gemini Native Audio TTS
    let audioDataUrl: string | null = null;
    let ttsLatencyMs = 0;
    let actualTtsModel = 'Qwen3-TTS-MLX-Hanako-Clone';
    const ttsStart = Date.now();
    try {
      if (requestedVoice.startsWith('clone:')) {
        const parts = requestedVoice.split(':');
        const refKey = parts[1] || 'hanako_whisper';
        const mode = parts[2] || 'emb';
        const cloneRes = await fetch('http://127.0.0.1:8766/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: replyText,
            refKey,
            mode,
            temperature: 0.82,
          }),
        });
        if (cloneRes.ok) {
          const cloneData = (await cloneRes.json()) as { ok?: boolean; audioBase64?: string; model?: string };
          if (cloneData.ok && cloneData.audioBase64) {
            audioDataUrl = `data:audio/wav;base64,${cloneData.audioBase64}`;
            actualTtsModel = cloneData.model || `Qwen3-TTS-MLX (${refKey}/${mode})`;
          }
        }
      }
      if (!audioDataUrl) {
        actualTtsModel = 'gemini-2.5-flash-preview-tts';
        const fallbackVoice = requestedVoice.startsWith('clone:') ? 'Gacrux' : requestedVoice;
        const ttsUrl = `https://aiplatform.googleapis.com/v1/projects/${cfg.projectId}/locations/global/publishers/google/models/gemini-2.5-flash-preview-tts:generateContent`;
        const ttsRes = await fetch(ttsUrl, {
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
                parts: [{ text: `${t.voiceStyle}\n${replyText}` }],
              },
            ],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: fallbackVoice },
                },
              },
            },
          }),
        });
        if (ttsRes.ok) {
          const ttsData = (await ttsRes.json()) as Record<string, unknown>;
          const ttsCands = (ttsData.candidates as Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>) || [];
          const b64 = ttsCands[0]?.content?.parts?.[0]?.inlineData?.data;
          if (b64) {
            const wav = pcm24kToWav(Buffer.from(b64, 'base64'), 24000);
            audioDataUrl = `data:audio/wav;base64,${wav.toString('base64')}`;
          }
        }
      }
      ttsLatencyMs = Date.now() - ttsStart;
    } catch {
      // Non-fatal if audio synthesis fails
    }

    return NextResponse.json(
      {
        model: cfg.model,
        ttsModel: actualTtsModel,
        voiceName: requestedVoice,
        projectId: cfg.projectId,
        location: cfg.location,
        latencyMs: Date.now() - startedAt,
        brainLatencyMs,
        ttsLatencyMs,
        replyText,
        action,
        audioDataUrl,
        usage: data.usageMetadata || null,
      },
      { headers: CORS }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS });
  }
}
