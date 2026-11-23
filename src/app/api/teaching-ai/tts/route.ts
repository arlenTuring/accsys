import { NextResponse } from 'next/server';
import { getVertexAccessToken } from '@/lib/ai-chat/auth';
import { requireAiChatConfig } from '@/lib/ai-chat/config';
import { spawn, execSync } from 'child_process';
import fs from 'fs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let ensuringServer = false;
async function ensureLocalHanakoServer(): Promise<boolean> {
  try {
    const ping = await fetch('http://127.0.0.1:8766/', { signal: AbortSignal.timeout(800) });
    if (ping.ok) return true;
  } catch {
    // not running yet
  }
  if (!ensuringServer) {
    ensuringServer = true;
    try {
      const outFd = fs.openSync('/tmp/hanako_server.log', 'a');
      const child = spawn(
        '/Users/arlen/Desktop/development/teaching/.venv_voice/bin/python',
        ['/Users/arlen/Desktop/development/teaching/hanako_voice_server.py'],
        {
          detached: true,
          stdio: ['ignore', outFd, outFd],
        }
      );
      child.unref();
      // Also ensure teaching server on 8765 is alive
      const teachingAlive = execSync('lsof -i :8765 || true', { encoding: 'utf-8' }).trim();
      if (!teachingAlive) {
        const tFd = fs.openSync('/tmp/teaching_srv.log', 'a');
        const tChild = spawn(process.execPath, ['/Users/arlen/Desktop/development/teaching/server.js'], {
          cwd: '/Users/arlen/Desktop/development/teaching',
          env: { ...process.env, PORT: '8765' },
          detached: true,
          stdio: ['ignore', tFd, tFd],
        });
        tChild.unref();
      }
    } catch {
      // ignore spawn error
    } finally {
      setTimeout(() => {
        ensuringServer = false;
      }, 6000);
    }
  }
  // Wait up to 8 seconds for it to come online
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const ping = await fetch('http://127.0.0.1:8766/', { signal: AbortSignal.timeout(800) });
      if (ping.ok) return true;
    } catch {
      // keep waiting
    }
  }
  return false;
}

export const GEMINI_VOICES = [
  // --- 6 Local Apple Silicon MLX Zero-Shot Clones of Official TBS Megumi Ogata (緒方惠美《地縛少年花子君》100% 官方原聲克隆) ---
  {
    id: 'clone:hanako_whisper:emb',
    gender: 'F',
    engine: 'mlx-clone',
    label: '👑 1. 緒方惠美本人日文原聲 B 克隆・第1話「お代は体で払ってもらうよ」貼耳微沙低語少年音（無硬幣雜音 10/10 純淨母帶・預設主聲線）',
    desc: '直接以您指定的第1話「言ったね？じゃあ、お代は体で……払ってもらうよ」無損精修純人聲母帶進行 1:1 神經聲紋克隆',
  },
  {
    id: 'clone:hanako_yashiro:emb',
    gender: 'F',
    engine: 'mlx-clone',
    label: '👑 2. TBS官方特報PV原聲 A 克隆・花子君微沙少年音（「ねえ、ヤシロ…ただいま」無BGM母帶）',
    desc: '直接擷取 TBS 官方特報 PV 緒方惠美無背景音原聲「ねえ、ヤシロ。やぁ、ヤシロ。ただいま。」進行神經聲紋克隆',
  },
  {
    id: 'clone:hanako_playful:emb',
    gender: 'F',
    engine: 'mlx-clone',
    label: '👑 3. 官方第1話原聲克隆・花子君元氣調皮捉弄少年音（「人間の助手」原聲）',
    desc: '擷取動畫第1話花子君開朗調侃八尋時的「ちょうど欲しかったんだよね、人間の助手」官方原聲聲紋',
  },
  {
    id: 'clone:hanako_super:emb',
    gender: 'F',
    engine: 'mlx-clone',
    label: '👑 4. 官方第1話原聲 C 克隆・花子君許願與壞笑（「聞かせてよ、願い事。見ぃつけた」原聲）',
    desc: '擷取動畫第1話花子君「君にもあるんだろう？聞かせてよ、願い事。見ぃつけた」官方原聲聲紋',
  },
  {
    id: 'clone:hanako_hybrid:emb',
    gender: 'F',
    engine: 'mlx-clone',
    label: '👑 5. TBS官方第2季PV原聲克隆・花子君溫柔堅定少年音（「葵ちゃんと約束したんだよね」原聲）',
    desc: '擷取 TBS 官方第2季 PV 緒方惠美「葵ちゃんと約束したんだよね。だから絶対諦めない」官方原聲聲紋',
  },
  {
    id: 'clone:hanako_studio:emb',
    gender: 'F',
    engine: 'mlx-clone',
    label: '👑 6. TBS官方訪談錄音室無BGM原聲克隆・緒方惠美本人現場演繹花子君與司',
    desc: '擷取 TBS 官方 Cast Comment 緒方惠美在錄音室零背景音樂的純淨原聲',
  },

  // --- 14 Gemini HD Female / Shonen Voices ---
  { id: 'Gacrux', gender: 'F', engine: 'gemini', label: '★ Gacrux（雲端女中音反串少年音）— Gemini 備援基底', desc: '女中音帶微沙氣音' },
  { id: 'Kore', gender: 'F', engine: 'gemini', label: '★ Kore（清冷少年感・女聲）', desc: '聲線乾淨偏中性' },
  { id: 'Aoede', gender: 'F', engine: 'gemini', label: '★ Aoede（調皮靈動少年・女聲）', desc: '尾音彈性極佳' },
  { id: 'Leda', gender: 'F', engine: 'gemini', label: 'Leda（青春甜美・女聲）', desc: '年輕可愛有活力' },
  { id: 'Zephyr', gender: 'F', engine: 'gemini', label: 'Zephyr（明亮清澈・女聲）', desc: '清脆有朝氣' },
  { id: 'Achernar', gender: 'F', engine: 'gemini', label: 'Achernar（輕柔甜美・女聲）', desc: '柔和細膩' },
  { id: 'Autonoe', gender: 'F', engine: 'gemini', label: 'Autonoe（溫暖明亮・女聲）', desc: '溫暖鼓勵' },
  { id: 'Callirrhoe', gender: 'F', engine: 'gemini', label: 'Callirrhoe（隨和親切・女聲）', desc: '放鬆陪伴感' },
  { id: 'Despina', gender: 'F', engine: 'gemini', label: 'Despina（溫暖滑順・女聲）', desc: '圓潤順耳' },
  { id: 'Erinome', gender: 'F', engine: 'gemini', label: 'Erinome（清晰知性・女聲）', desc: '乾淨俐落' },
  { id: 'Laomedeia', gender: 'F', engine: 'gemini', label: 'Laomedeia（歡快活潑・女聲）', desc: '高昂有精神' },
  { id: 'Pulcherrima', gender: 'F', engine: 'gemini', label: 'Pulcherrima（清亮突出・女聲）', desc: '戲劇張力高' },
  { id: 'Sulafat', gender: 'F', engine: 'gemini', label: 'Sulafat（溫暖療癒・女聲）', desc: '柔和有耐心' },
  { id: 'Vindemiatrix', gender: 'F', engine: 'gemini', label: 'Vindemiatrix（溫婉柔和・女聲）', desc: '慢條斯理' },

  // --- 16 Gemini HD Male Voices ---
  { id: 'Enceladus', gender: 'M', engine: 'gemini', label: '★ Enceladus（氣音磁性少年・男聲）', desc: '極具呼吸感與微沙空氣感' },
  { id: 'Puck', gender: 'M', engine: 'gemini', label: '★ Puck（調皮鬼靈精少年・男聲）', desc: '充滿惡作劇與探險感' },
  { id: 'Sadachbia', gender: 'M', engine: 'gemini', label: '★ Sadachbia（戲劇反差少年・男聲）', desc: '高低起伏豐富' },
  { id: 'Charon', gender: 'M', engine: 'gemini', label: 'Charon（沉穩知性・男聲）', desc: '冷靜溫和' },
  { id: 'Fenrir', gender: 'M', engine: 'gemini', label: 'Fenrir（熱情興奮・男聲）', desc: '節奏明快' },
  { id: 'Achird', gender: 'M', engine: 'gemini', label: 'Achird（友善親和・男聲）', desc: '鄰家大哥哥' },
  { id: 'Orus', gender: 'M', engine: 'gemini', label: 'Orus（穩重可靠・男聲）', desc: '條理分明' },
  { id: 'Iapetus', gender: 'M', engine: 'gemini', label: 'Iapetus（清晰自然・男聲）', desc: '乾淨爽朗' },
  { id: 'Sadaltager', gender: 'M', engine: 'gemini', label: 'Sadaltager（博學知性・男聲）', desc: '專業語氣' },
  { id: 'Schedar', gender: 'M', engine: 'gemini', label: 'Schedar（平穩踏實・男聲）', desc: '不疾不徐' },
  { id: 'Algenib', gender: 'M', engine: 'gemini', label: 'Algenib（磁性微沙・男聲）', desc: '顆粒質感' },
  { id: 'Algieba', gender: 'M', engine: 'gemini', label: 'Algieba（溫潤流暢・男聲）', desc: '廣播級男聲' },
  { id: 'Alnilam', gender: 'M', engine: 'gemini', label: 'Alnilam（堅定有力・男聲）', desc: '精神飽滿' },
  { id: 'Rasalgethi', gender: 'M', engine: 'gemini', label: 'Rasalgethi（敘事理性・男聲）', desc: '娓娓道來' },
  { id: 'Umbriel', gender: 'M', engine: 'gemini', label: 'Umbriel（隨和輕鬆・男聲）', desc: '輕鬆聊天感' },
  { id: 'Zubenelgenubi', gender: 'M', engine: 'gemini', label: 'Zubenelgenubi（低沉渾厚・男聲）', desc: '深沉老博士' },

  // --- 3 Google Cloud Native Taiwan Mandarin Wavenet Voices ---
  { id: 'cmn-TW-Wavenet-A', gender: 'F', engine: 'cloud-tw', label: '台灣原生 Wavenet-A（道地台灣國語・女聲）', desc: 'Google Cloud 台灣本地女聲' },
  { id: 'cmn-TW-Wavenet-B', gender: 'M', engine: 'cloud-tw', label: '台灣原生 Wavenet-B（道地台灣國語・男聲）', desc: 'Google Cloud 台灣本地男聲' },
  { id: 'cmn-TW-Wavenet-C', gender: 'M', engine: 'cloud-tw', label: '台灣原生 Wavenet-C（道地台灣國語・男聲2）', desc: 'Google Cloud 台灣本地男聲' },
];

export const ACTING_STYLES: Record<string, { label: string; prompt: string }> = {
  hanako_ogata: {
    label: '👻 地縛少年花子君（緒方惠美 1:1 原聲聲紋克隆：微沙少年音・調皮壞笑 ➔ 貼耳低語反差）',
    prompt:
      '請模仿日本傳奇聲優「緒方惠美」配音《地縛少年花子君》男主角「花子君」的招牌少年音演技（使用自然台灣繁體中文口音，不捲舌）！' +
      '聲線特徵：帶有微沙磁性的13歲中性少年音（女中音反串少年感）。' +
      '演技要求：開頭先帶著壞壞又可愛的氣音輕笑或慵懶拉長尾音（例如「嘿嘿～」「吶吶～」），語氣調皮愛捉弄人、尾音上揚有彈性；' +
      '講到關鍵句時，突然收起笑聲、壓低嗓音變成貼在耳邊低語般的神秘磁性低音，展現令人心跳加速的反差感：',
  },
  anime_mascot: {
    label: '✨ 動漫吉祥物（元氣誇張・像日本 VTuber / 巧虎）',
    prompt: '請用道地台灣國語（台灣繁體中文口音，絕對不要捲舌兒化音）、超元氣可愛的日本動漫吉祥物老師語氣說話！語調高低起伏要非常生動誇張，可以自然帶一點點可愛的氣音、笑意與驚嘆感：',
  },
  warm_sister: {
    label: '🌸 溫柔幼兒園姊姊（超有耐心・輕柔哄孩子）',
    prompt: '請用道地台灣國語（台灣繁體中文口音）、像最溫柔有耐心的台灣故事姊姊語氣說話，聲音輕柔溫暖、帶著微笑與呼吸感，尾音自然柔和：',
  },
  excited_host: {
    label: '🎉 兒童節目闖關主持人（超嗨・節奏明快）',
    prompt: '請用道地台灣國語（台灣繁體中文口音）、像兒童電視節目最受歡迎的熱血主持人語氣說話！充滿驚喜感、節奏輕快有感染力：',
  },
  detective_story: {
    label: '🔍 神秘偵探說書人（壓低聲音・引人好奇）',
    prompt: '請用道地台灣國語（台灣繁體中文口音）、像在跟孩子分享神秘線索的偵探說書人語氣說話，帶有好奇、停頓與懸念感：',
  },
};

const TEACHER_VOICE_DEFAULTS: Record<string, { voice: string; styleKey: string }> = {
  math: { voice: 'clone:hanako_whisper:emb', styleKey: 'hanako_ogata' },
  english: { voice: 'clone:hanako_whisper:emb', styleKey: 'hanako_ogata' },
  social: { voice: 'clone:hanako_whisper:emb', styleKey: 'hanako_ogata' },
  science: { voice: 'clone:hanako_whisper:emb', styleKey: 'hanako_ogata' },
};

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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(
    { voices: GEMINI_VOICES, styles: ACTING_STYLES, defaults: TEACHER_VOICE_DEFAULTS },
    { headers: CORS }
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rawText = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!rawText) {
      return NextResponse.json({ error: '缺少要朗讀的文字' }, { status: 400, headers: CORS });
    }

    const teacherId = typeof payload.teacherId === 'string' ? payload.teacherId : 'math';
    const def = TEACHER_VOICE_DEFAULTS[teacherId] || TEACHER_VOICE_DEFAULTS.math!;
    const voiceName = typeof payload.voiceName === 'string' && payload.voiceName ? payload.voiceName : def.voice;
    const styleKey = typeof payload.styleKey === 'string' && ACTING_STYLES[payload.styleKey] ? payload.styleKey : def.styleKey;
    const customStyle = typeof payload.customStyle === 'string' && payload.customStyle.trim()
      ? payload.customStyle.trim()
      : ACTING_STYLES[styleKey]!.prompt;

    // 1. Local Apple Silicon MLX Zero-Shot Voice Cloning (Megumi Ogata Hanako-kun 1:1 Reference Clone)
    if (voiceName.startsWith('clone:')) {
      const parts = voiceName.split(':');
      const refKey = parts[1] || 'hanako_whisper';
      const mode = parts[2] || 'emb';

      const ready = await ensureLocalHanakoServer();
      if (ready) {
        const cloneRes = await fetch('http://127.0.0.1:8766/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: rawText,
            refKey,
            mode,
            temperature: 0.82,
          }),
        });
        if (cloneRes.ok) {
          const cloneData = (await cloneRes.json()) as {
            ok?: boolean;
            audioBase64?: string;
            model?: string;
            durationSec?: number;
            latencyMs?: number;
          };
          if (cloneData.ok && cloneData.audioBase64) {
            return NextResponse.json(
              {
                ok: true,
                ttsModel: cloneData.model || `Qwen3-TTS-MLX-Hanako (${refKey})`,
                voiceName,
                styleKey,
                latencyMs: cloneData.latencyMs || Date.now() - startedAt,
                durationSec: cloneData.durationSec || 0,
                audioDataUrl: `data:audio/wav;base64,${cloneData.audioBase64}`,
              },
              { headers: CORS }
            );
          }
        }
      }
    }

    const cfg = requireAiChatConfig();
    const { token } = await getVertexAccessToken(cfg);

    if (voiceName.startsWith('cmn-TW-')) {
      const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': cfg.projectId,
        },
        body: JSON.stringify({
          input: { text: rawText },
          voice: { languageCode: 'cmn-TW', name: voiceName },
          audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: 1.05, pitch: 1.2 },
        }),
      });
      if (!r.ok) {
        const errText = await r.text();
        return NextResponse.json({ error: `Cloud TTS HTTP ${r.status}: ${errText.slice(0, 250)}` }, { status: 500, headers: CORS });
      }
      const d = (await r.json()) as { audioContent?: string };
      const wavBuf = Buffer.from(d.audioContent || '', 'base64');
      return NextResponse.json(
        {
          ok: true,
          ttsModel: 'google-cloud-tts-cmn-TW',
          voiceName,
          latencyMs: Date.now() - startedAt,
          durationSec: +(wavBuf.length / (24000 * 2)).toFixed(2),
          audioDataUrl: `data:audio/wav;base64,${wavBuf.toString('base64')}`,
        },
        { headers: CORS }
      );
    }

    const ttsModel = typeof payload.ttsModel === 'string' && payload.ttsModel
      ? payload.ttsModel
      : 'gemini-2.5-flash-preview-tts';
    const fallbackVoice = voiceName.startsWith('clone:') ? 'Gacrux' : voiceName;

    const url = `https://aiplatform.googleapis.com/v1/projects/${cfg.projectId}/locations/global/publishers/google/models/${ttsModel}:generateContent`;

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
            parts: [{ text: `${customStyle}\n「${rawText}」` }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: fallbackVoice,
              },
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Gemini TTS HTTP ${res.status}: ${errText.slice(0, 300)}` },
        { status: 500, headers: CORS }
      );
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
          }>;
        };
      }>;
    };

    const b64Pcm = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64Pcm) {
      return NextResponse.json({ error: '未收到語音資料' }, { status: 500, headers: CORS });
    }

    const pcmBuf = Buffer.from(b64Pcm, 'base64');
    const wavBuf = pcm24kToWav(pcmBuf, 24000);

    return NextResponse.json(
      {
        ok: true,
        ttsModel,
        voiceName: fallbackVoice,
        styleKey,
        latencyMs: Date.now() - startedAt,
        durationSec: +(pcmBuf.length / (24000 * 2)).toFixed(2),
        audioDataUrl: `data:audio/wav;base64,${wavBuf.toString('base64')}`,
      },
      { headers: CORS }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'TTS 發生未知錯誤' },
      { status: 500, headers: CORS }
    );
  }
}
