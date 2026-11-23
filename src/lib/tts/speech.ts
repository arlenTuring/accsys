import type { Locale } from '@/lib/i18n/messages';

export type SpeechLangCode = 'zh-TW' | 'en-US' | 'ja-JP';

export type VoiceLike = {
  name: string;
  lang: string;
  voiceURI?: string;
  localService?: boolean;
  default?: boolean;
};

/**
 * Real Japanese Hiragana (ぁ-ゖ) and Katakana (ァ-ヶ, halfwidth ｦ-ﾟ),
 * explicitly EXCLUDING U+30FB (・ middle dot used as Chinese bullet) and U+30FC (ー).
 */
const JAPANESE_KANA_RE = /[\u3041-\u3096\u30A1-\u30FA\uFF66-\uFF9F]/g;

/** CJK Unified Ideographs */
const CJK_HAN_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;

/** Latin words */
const LATIN_WORD_RE = /[A-Za-z]{2,}/g;

/** In-memory cache of translated speech text keyed by `${targetLang}::${rawText}` */
const speechTranslationCache = new Map<string, string>();
const speechTranslationInFlight = new Map<string, Promise<string | null>>();

/** In-memory cache of synthesized female MP3 audio data URLs keyed by `${targetLang}::${rawText}` */
const speechAudioCache = new Map<string, string>();
const speechAudioInFlight = new Map<string, Promise<{ audioDataUrl: string; text: string } | null>>();
let activeAudioElement: HTMLAudioElement | null = null;

/**
 * All 39 Taiwan Turing Drive employees & common entities mapped for English & Japanese speech
 */
const EMPLOYEE_NAME_EN_MAP: Array<[string, string]> = [
  ['林群力', 'Chun-Li Lin'],
  ['林哲緯', 'Che-Wei Lin'],
  ['沈家進', 'Chia-Chin Shen'],
  ['陳維隆', 'Wei-Lung Chen'],
  ['阮振瑋', 'Zhen-Wei Ruan'],
  ['張晏銘', 'Yen-Ming Chang'],
  ['黃士桓', 'Shih-Huan Huang'],
  ['許雲茹', 'Yun-Ru Hsu'],
  ['陳亮君', 'Liang-Chun Chen'],
  ['賴昭宇', 'Chao-Yu Lai'],
  ['陳思潔', 'Szu-Chieh Chen'],
  ['王立心', 'Li-Hsin Wang'],
  ['林佳瑩', 'Chia-Ying Lin'],
  ['周庭安', 'Ting-An Chou'],
  ['吳承翰', 'Cheng-Han Wu'],
  ['劉育誠', 'Yu-Cheng Liu'],
  ['蔡佩珊', 'Pei-Shan Tsai'],
  ['鄭宇軒', 'Yu-Hsuan Cheng'],
  ['楊雅筑', 'Ya-Chu Yang'],
  ['謝宗翰', 'Tsung-Han Hsieh'],
  ['郭家豪', 'Chia-Hao Kuo'],
  ['洪詩涵', 'Shih-Han Hung'],
  ['邱冠宇', 'Kuan-Yu Chiu'],
  ['曾郁婷', 'Yu-Ting Tseng'],
  ['廖柏鈞', 'Po-Chun Liao'],
  ['徐瑋廷', 'Wei-Ting Hsu'],
  ['賴怡君', 'Yi-Chun Lai'],
  ['台灣智慧駕駛股份有限公司', 'Taiwan Turing Drive Inc.'],
  ['台灣智慧駕駛', 'Taiwan Turing Drive'],
];

/**
 * Bilingual phrase replacements to convert Japanese <-> Traditional Chinese <-> English
 * synchronously when a message generated in one language is played under another UI locale.
 */
const JA_TO_ZH_REPLACEMENTS: Array<[RegExp, string]> = [
  [/現在、お客様の承認（サイン）待ちとなっている申請書類は合計で\s*(\d+)\s*件ございます（画面上に概要カードが表示されています）。主な内容は以下のとおりです。/g, '目前等待您簽核的申請單據共有 $1 件，主要內容如下：'],
  [/現在、お客様の承認（サイン）待ちとなっている申請書類は合計で\s*(\d+)\s*件ございます。/g, '目前等待您簽核的申請單據共有 $1 件。'],
  [/現在、承認待ちの申請書が\s*(\d+)\s*件あります。/g, '目前有 $1 件待簽核的申請單。'],
  [/主な内容は以下のとおりです。/g, '主要內容如下：'],
  [/各カードの詳細確認ボタンから内容を確認して承認を行うか、私に「すべて承認」とお申し付けいただければ一括で代理承認を行うことも可能です。/g, '您可以點擊各張卡片的詳細確認按鈕進行簽核，或直接對我說「全部核准」由我為您批次簽核。'],
  [/押印申請書（契約関連）/g, '用印申請單（合約類）'],
  [/押印申請書（一般書類）/g, '用印申請單（一般類）'],
  [/押印申請書（請求書・インボイス）/g, '用印申請單（開立發票）'],
  [/経費申請書（部門版）/g, '費用申請單（部門版）'],
  [/製品プロジェクト経費申請書/g, '產品專案費用申請單'],
  [/出張申請書/g, '公出差旅申請單'],
  [/出張報告および旅費精算書/g, '出差報告暨旅費報支單'],
  [/購買依頼書/g, '請購單'],
  [/申請者：/g, '申請人：'],
  [/件名：/g, '主旨：'],
  [/金額：各/g, '金額：每筆'],
  [/(\d+)\s*件/g, '$1 筆'],
  [/第(\d+)四半期/g, '第 $1 季'],
  [/年度スマートパーク自動運転シャトルバス覚書（MOU）および秘密保持契約/g, '年度智慧園區自駕接駁車合作備忘錄 MOU 及保密協議'],
  [/自動運転認知アルゴリズム用クラウドGPUトレーニングクラスタおよび高精度地図アノテーションサービス費/g, '自駕感知演算法雲端 GPU 訓練叢集與高精地圖標註服務費'],
  [/新竹県竹北での自動運転バスLiDAR道路実測および車車間・路車間通信（V2X）統合テスト/g, '新竹縣竹北自駕巴士光達道路實測及車聯網 V2X 整合測試'],
  [/自動運転バス/g, '自駕巴士'],
  [/自動運転/g, '自動駕駛'],
  [/秘密保持契約/g, '保密協議'],
  [/覚書/g, '合作備忘錄'],
  [/統合テスト/g, '整合測試'],
  [/道路実測/g, '道路實測'],
  [/承認待ち/g, '待簽核'],
  [/承認完了/g, '已完成簽核'],
  [/および/g, '及'],
  [/での/g, '之'],
];

const TO_EN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/現在、お客様の承認（サイン）待ちとなっている申請書類は合計で\s*(\d+)\s*件ございます（画面上に概要カードが表示されています）。主な内容は以下のとおりです。/g, 'You currently have $1 pending approval documents waiting for your signature. Here is a summary of the main items: '],
  [/目前等待您簽核的申請單據共有\s*(\d+)\s*件，主要內容如下：/g, 'You currently have $1 pending approval documents waiting for your signature. Here is a summary of the main items: '],
  [/目前您有\s*(\d+)\s*張待簽核單據/g, 'You currently have $1 pending approval documents'],
  [/現在、承認待ちの申請書が\s*(\d+)\s*件あります。/g, 'You currently have $1 pending approval documents. '],
  [/内容をご確認ください。/g, 'Please review the details.'],
  [/各カードの詳細確認ボタンから内容を確認して承認を行うか、私に「すべて承認」とお申し付けいただければ一括で代理承認を行うことも可能です。/g, 'You can review and approve each item from the detail cards, or tell me to Approve All to process them in batch.'],
  [/您可以點擊各張卡片的詳細確認按鈕進行簽核，或直接對我說「全部核准」由我為您批次簽核。/g, 'You can review and approve each item from the detail cards, or tell me to Approve All to process them in batch.'],
  [/押印申請書（契約関連）|用印申請單[（(]合約類[）)]/g, 'Seal Application for Contracts'],
  [/押印申請書（一般書類）|用印申請單[（(]一般類[）)]/g, 'General Seal Application'],
  [/押印申請書（請求書・インボイス）|用印申請單[（(]開立發票[）)]/g, 'Invoice Seal Application'],
  [/経費申請書（部門版）|費用申請單[（(]部門版[）)]/g, 'Department Expense Application'],
  [/製品プロジェクト経費申請書|產品專案費用申請單/g, 'Product Project Expense Application'],
  [/出張申請書|公出差旅申請單/g, 'Business Trip Application'],
  [/出張報告および旅費精算書|出差報告暨旅費報支單/g, 'Trip Report and Travel Expense Claim'],
  [/購買依頼書|請購單/g, 'Purchase Request'],
  [/申請者：|申請人：/g, 'Applicant: '],
  [/件名：|主旨：|摘要：/g, 'Subject: '],
  [/狀態：/g, 'Status: '],
  [/金額：各\s*/g, 'Amount: '],
  [/金額：每筆\s*/g, 'Amount: '],
  [/[(（](\d+)\s*[件筆張][)）]/g, '($1 items)'],
  [/(\d+)\s*[件筆張]/g, '$1 items'],
  [/2026年度スマートパーク自動運転シャトルバス覚書（MOU）および秘密保持契約|2026年度智慧園區自駕接駁車合作備忘錄[（(]MOU[）)]暨保密協議用印/g, '2026 Smart Park Autonomous Shuttle Bus MOU and Non-Disclosure Agreement'],
  [/第4四半期\s*自動運転認知アルゴリズム用クラウドGPUトレーニングクラスタおよび高精度地図アノテーションサービス費|第4季自駕感知演算法雲端GPU訓練叢集與高精地圖標註服務費/g, 'Q4 Cloud GPU Training Cluster for Autonomous Perception Algorithms and HD Map Annotation Service Fee'],
  [/新竹県竹北での自動運転バスLiDAR道路実測および車車間・路車間通信（V2X）統合テスト|新竹竹北自駕巴士光達道路實測暨車聯網V2X整合測試/g, 'Hsinchu Zhubei Autonomous Bus LiDAR Road Test and V2X Integration Test'],
  [/承認完了|已核准/g, 'Approved'],
  [/承認待ち|待簽核/g, 'Pending Approval'],
  [/已退回/g, 'Returned'],
];

const ZH_TO_JA_REPLACEMENTS: Array<[RegExp, string]> = [
  [/收到，已切換至繁體中文（臺灣商務用語），回覆維持清楚精簡，不使用星號與\s*Emoji。/g, '承知いたしました。これより日本語で分かりやすく簡潔にご案内いたします。'],
  [/請問目前進行中的「資產異動申請單」（轉移給([^）]+)）或「出差報告暨旅費報支單」需要繼續處理，或是您有其他採購、請款、簽核與規章查詢的需求？/g, '現在進行中の資産異動申請書、または出張報告および旅費精算書の処理を続けますか？それとも他に購買、請求、承認、社内規程に関するご用件がございますか？'],
  [/目前待您簽核的單據共有\s*(\d+)\s*[件張筆]（畫面[^）]*），(?:重點摘要|摘要重點)如下：/g, '現在、お客様の承認待ちとなっている申請書類は合計で $1 件ございます。主な内容は以下のとおりです。'],
  [/目前等待您簽核的申請單據共有\s*(\d+)\s*[件張筆]，主要內容如下：/g, '現在、お客様の承認待ちとなっている申請書類は合計で $1 件ございます。主な内容は以下のとおりです。'],
  [/目前您有\s*(\d+)\s*[張件筆]待簽核單據/g, '現在、承認待ちの申請書類が $1 件ございます'],
  [/您可以直接(?:點擊卡片|在卡片上)查看詳情[／與]簽核，或告訴我「全部核准」[^。！]*[。！]/g, '各カードの詳細確認ボタンから内容を確認して承認を行うか、私に「すべて承認」とお申し付けいただければ一括で代理承認を行うことも可能です。'],
  [/用印申請單[（(]合約類[）)]/g, '押印申請書（契約関連）'],
  [/用印申請單[（(]一般類[）)]/g, '押印申請書（一般書類）'],
  [/用印申請單[（(]開立發票[）)]/g, '押印申請書（請求書・インボイス）'],
  [/費用申請單[（(]部門版[）)]/g, '経費申請書（部門版）'],
  [/產品專案費用申請單/g, '製品プロジェクト経費申請書'],
  [/公出差旅申請單/g, '出張申請書'],
  [/出差報告暨旅費報支單/g, '出張報告および旅費精算書'],
  [/資產異動申請單/g, '資産異動申請書'],
  [/請購單/g, '購買依頼書'],
  [/申請人\s*[：:]?/g, '申請者：'],
  [/主旨：|摘要：/g, '件名：'],
  [/狀態：/g, 'ステータス：'],
  [/（(\d+)\s*[筆件張]）/g, '（$1件）'],
  [/待簽核/g, '承認待ち'],
  [/已核准/g, '承認済み'],
  [/已退回/g, '差戻し'],
];

/**
 * Strips Markdown syntax and normalizes bullet symbols so TTS reads naturally
 * and never misinterprets `・` (U+30FB) as Japanese katakana.
 */
export function cleanTextForSpeech(rawText: string): string {
  return (rawText || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[・•]/g, '，')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Maps the UI locale ('zh-Hant' | 'en' | 'ja') directly to the target speech language:
 * - 'zh-Hant' (button: 中) -> 'zh-TW'
 * - 'en'      (button: EN) -> 'en-US'
 * - 'ja'      (button: 日) -> 'ja-JP'
 *
 * When `uiLocale` is provided, it is strictly obeyed so the voice language ALWAYS
 * matches the language indicator button on screen.
 */
export function resolveSpeechLanguage(
  text: string,
  uiLocale?: Locale | 'zh-TW'
): SpeechLangCode {
  if (uiLocale === 'en') return 'en-US';
  if (uiLocale === 'ja') return 'ja-JP';
  if (uiLocale === 'zh-Hant' || uiLocale === 'zh-TW') return 'zh-TW';

  // Fallback only when uiLocale is omitted: inspect text content
  const sample = (text || '').replace(/https?:\/\/\S+/g, '').trim();
  if (!sample) return 'zh-TW';

  const kanaMatches = sample.match(JAPANESE_KANA_RE) ?? [];
  const hanMatches = sample.match(CJK_HAN_RE) ?? [];
  const latinMatches = sample.match(LATIN_WORD_RE) ?? [];

  if (kanaMatches.length >= 2) return 'ja-JP';
  if (hanMatches.length > 0) return 'zh-TW';
  if (latinMatches.length > 0) return 'en-US';
  return 'zh-TW';
}

/**
 * Checks whether `text` contains script/language content that conflicts with `targetLang`
 * (which would cause macOS/Chrome SpeechSynthesis to auto-switch to a different language voice).
 */
export function needsSpeechTranslation(text: string, targetLang: SpeechLangCode): boolean {
  const sample = cleanTextForSpeech(text);
  if (!sample) return false;

  const kanaCount = (sample.match(JAPANESE_KANA_RE) ?? []).length;
  const hanCount = (sample.match(CJK_HAN_RE) ?? []).length;
  const latinCount = (sample.match(LATIN_WORD_RE) ?? []).length;

  if (targetLang === 'zh-TW') {
    // Needs translation if it contains Japanese Kana or is predominantly English without Chinese
    return kanaCount > 0 || (hanCount === 0 && latinCount >= 3);
  }
  if (targetLang === 'en-US') {
    // Needs translation/romanization if it contains ANY Chinese or Japanese characters
    return hanCount > 0 || kanaCount > 0;
  }
  if (targetLang === 'ja-JP') {
    // Needs translation if it has no Japanese Kana and is written in Chinese or English
    return kanaCount === 0 && (hanCount >= 4 || latinCount >= 3);
  }
  return false;
}

/**
 * Synchronously adapts/translates `text` into `targetLang` so that:
 * - 'zh-TW' contains Traditional Chinese (zero Japanese Kana)
 * - 'en-US' contains pure English (zero CJK/Kana characters so macOS TTS never switches to Chinese/Japanese)
 * - 'ja-JP' contains natural Japanese
 */
export function adaptTextForSpeechLocaleSync(
  rawText: string,
  targetLang: SpeechLangCode
): string {
  let out = cleanTextForSpeech(rawText);
  if (!out) return '';

  const cacheKey = `${targetLang}::${out}`;
  const cached = speechTranslationCache.get(cacheKey);
  if (cached) return cached;

  if (targetLang === 'zh-TW') {
    for (const [re, rep] of JA_TO_ZH_REPLACEMENTS) {
      out = out.replace(re, rep);
    }
    // Strip any remaining Japanese Hiragana/Katakana so macOS never switches to a Japanese voice
    out = out.replace(/[\u3040-\u309F\u30A0-\u30FF\uFF66-\uFF9F]+/g, ' ');
    return out.replace(/\s+/g, ' ').trim();
  }

  if (targetLang === 'en-US') {
    for (const [re, rep] of TO_EN_REPLACEMENTS) {
      out = out.replace(re, rep);
    }
    for (const [cjkName, enName] of EMPLOYEE_NAME_EN_MAP) {
      out = out.split(cjkName).join(enName);
    }
    // Strip any remaining CJK or Japanese Kana characters so macOS English voice never falls back to Chinese/Japanese
    const stripped = out
      .replace(/[\u3040-\u30FF\uFF66-\uFF9F\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped || 'Here is the current assistant response.';
  }

  if (targetLang === 'ja-JP') {
    for (const [re, rep] of ZH_TO_JA_REPLACEMENTS) {
      out = out.replace(re, rep);
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  return out;
}

/**
 * Calls `/api/tts/translate` to translate a message into `targetLang` and caches it.
 */
export async function translateTextForSpeechAsync(
  rawText: string,
  targetLang: SpeechLangCode
): Promise<string> {
  const cleaned = cleanTextForSpeech(rawText);
  if (!cleaned) return '';

  if (!needsSpeechTranslation(cleaned, targetLang)) {
    return adaptTextForSpeechLocaleSync(cleaned, targetLang);
  }

  const cacheKey = `${targetLang}::${cleaned}`;
  const cached = speechTranslationCache.get(cacheKey);
  if (cached) return cached;

  let inflight = speechTranslationInFlight.get(cacheKey);
  if (!inflight) {
    inflight = (async () => {
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 6000);
        const res = await fetch('/api/tts/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleaned, targetLang }),
          credentials: 'same-origin',
          signal: controller.signal,
        });
        window.clearTimeout(timer);
        if (!res.ok) return null;
        const data = (await res.json()) as { ok?: boolean; text?: string };
        if (data?.ok && data.text?.trim()) {
          const finalText = adaptTextForSpeechLocaleSync(data.text.trim(), targetLang);
          speechTranslationCache.set(cacheKey, finalText);
          return finalText;
        }
        return null;
      } catch {
        return null;
      } finally {
        speechTranslationInFlight.delete(cacheKey);
      }
    })();
    speechTranslationInFlight.set(cacheKey, inflight);
  }

  const remote = await inflight;
  if (remote) return remote;

  // Do NOT cache failed remote translations so the next click can retry
  return adaptTextForSpeechLocaleSync(cleaned, targetLang);
}

/**
 * Fetches (and caches) a translated + synthesized female voice MP3 data URL from `/api/tts/audio`.
 */
export async function fetchFemaleSpeechAudioAsync(
  rawText: string,
  targetLang: SpeechLangCode
): Promise<{ audioDataUrl: string; text: string } | null> {
  const cleaned = cleanTextForSpeech(rawText);
  if (!cleaned) return null;

  const cacheKey = `${targetLang}::${cleaned}`;
  const cachedAudio = speechAudioCache.get(cacheKey);
  if (cachedAudio) {
    return {
      audioDataUrl: cachedAudio,
      text: speechTranslationCache.get(cacheKey) || cleaned,
    };
  }

  let inflight = speechAudioInFlight.get(cacheKey);
  if (!inflight) {
    inflight = (async () => {
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 8000);
        const res = await fetch('/api/tts/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleaned, targetLang }),
          credentials: 'same-origin',
          signal: controller.signal,
        });
        window.clearTimeout(timer);
        if (!res.ok) return null;
        const data = (await res.json()) as {
          ok?: boolean;
          audioDataUrl?: string;
          text?: string;
        };
        if (data?.ok && data.audioDataUrl) {
          speechAudioCache.set(cacheKey, data.audioDataUrl);
          if (data.text) speechTranslationCache.set(cacheKey, data.text);
          return { audioDataUrl: data.audioDataUrl, text: data.text || cleaned };
        }
        return null;
      } catch {
        return null;
      } finally {
        speechAudioInFlight.delete(cacheKey);
      }
    })();
    speechAudioInFlight.set(cacheKey, inflight);
  }

  return inflight;
}

/**
 * Pre-warms the female TTS audio cache for the most recent visible model messages
 * when the user switches UI locale (中 / EN / 日).
 */
export function prewarmSpeechTranslations(
  texts: readonly string[],
  uiLocale: Locale
): void {
  if (typeof window === 'undefined') return;
  const targetLang = resolveSpeechLanguage('', uiLocale);
  for (const t of texts.slice(-2)) {
    const cleaned = cleanTextForSpeech(t);
    if (!cleaned) continue;
    void fetchFemaleSpeechAudioAsync(cleaned, targetLang);
  }
}

/**
 * Strictly identifies male TTS voices across macOS, iOS, Windows, Chrome, Edge, and Android
 * so they are NEVER selected.
 */
const MALE_VOICE_NAME_PATTERNS: RegExp[] = [
  /\b(male|man|boy|masculine)\b/i,
  /男|男聲|男性/,
  // macOS / iOS male voices (including novelty/multi-lingual male voices)
  /\b(eddy|reed|rocko|grandpa|alex|daniel|fred|ralph|bruce|junior|albert|thomas|jorge|diego|luca|yuri|xander|maged|tarik|majed|rishi|oliver|arthur|gordon|lee|aaron|tom|natan|martin|henrik|magnus|oskar|cem)\b/i,
  // Japanese male voices
  /\b(hattori|ichiro|otoya|keita|takumi|naoki|daichi|kenji|taro|show)\b/i,
  /服部|一郎|音也|慶太|拓海|直樹/,
  // Chinese / Taiwanese / Cantonese male voices
  /\b(yunxi|yunjian|yunyang|kangkang|zhiwei|yunze|yunhao|yunfeng|yundeng|wanlung|danny|yafeng|zhipeng|sin-ji|sinji)\b/i,
  /雲希|云希|雲健|云健|雲揚|云扬|康康|治威|雲澤|云泽|雲皓|云皓|雲楓|云枫|萬龍|万龙/,
  // English Windows / Edge / Google male voices
  /\b(david|mark|guy|eric|christopher|roger|steffan|ryan|liam|andrew|brian|connor|jacob|jason|tony|davis|brandon|mitchell|prabhat|willem)\b/i,
];

export function isMaleVoice(voice: VoiceLike): boolean {
  const haystack = `${voice.name} ${voice.voiceURI ?? ''}`;
  return MALE_VOICE_NAME_PATTERNS.some((re) => re.test(haystack));
}

/**
 * Ordered priority list of known high-quality FEMALE voices for each target language.
 */
const PREFERRED_FEMALE_VOICE_PATTERNS: Record<SpeechLangCode, RegExp[]> = {
  'zh-TW': [
    /meijia|美佳/i,
    /hsiaochen|曉臻|晓臻/i,
    /hsiaoyu|曉雨|晓雨/i,
    /google\s*國語|google.*taiwan|google.*zh[-_]?tw/i,
    /ting[-_ ]?ting|婷婷/i,
    /xiaoxiao|曉曉|晓晓/i,
    /xiaoyi|曉伊|晓伊/i,
    /hiugaai|曉佳|hiumaan|曉曼/i,
    /google\s*普通话|google.*mandarin/i,
    /\b(flo|shelley|sandy|grandma)\b/i,
  ],
  'en-US': [
    /\bsamantha\b/i,
    /\bava\b/i,
    /\ballison\b/i,
    /\bzoe\b/i,
    /\b(aria|jenny|michelle|emma|ana)\b/i,
    /google\s*us\s*english/i,
    /\b(nicky|susan|victoria|karen|moira|tessa|serena|veena|zira|sonia|libby)\b/i,
    /google\s*uk\s*english\s*female/i,
    /\b(flo|shelley|sandy|grandma)\b/i,
  ],
  'ja-JP': [
    /google\s*日本語|google.*ja/i,
    /kyoko|きょうこ|京子/i,
    /o-ren|oren/i,
    /nanami|七海/i,
    /mayu|真夕|aoi|葵|shiori|詩織/i,
    /haruka|遥|ayumi|歩美|sayaka|彩香/i,
    /\b(flo|shelley|sandy|grandma)\b/i,
  ],
};

function normalizeLangTag(lang: string): string {
  return (lang || '').trim().replace(/_/g, '-').toLowerCase();
}

function matchesLanguageFamily(voiceLang: string, targetLang: SpeechLangCode): boolean {
  const norm = normalizeLangTag(voiceLang);
  if (targetLang === 'zh-TW') {
    return norm.startsWith('zh') || norm.startsWith('cmn');
  }
  if (targetLang === 'en-US') {
    return norm.startsWith('en');
  }
  if (targetLang === 'ja-JP') {
    return norm.startsWith('ja');
  }
  return false;
}

function scoreFemaleCandidate<T extends VoiceLike>(
  voice: T,
  targetLang: SpeechLangCode
): number {
  if (isMaleVoice(voice)) return -10_000;
  if (!matchesLanguageFamily(voice.lang, targetLang)) return -5_000;

  let score = 0;
  const normLang = normalizeLangTag(voice.lang);
  const haystack = `${voice.name} ${voice.voiceURI ?? ''}`;

  // Exact regional locale match
  if (targetLang === 'zh-TW') {
    if (normLang === 'zh-tw' || normLang.includes('tw') || normLang.includes('hant')) {
      score += 200;
    } else if (normLang === 'zh-cn' || normLang.includes('cn') || normLang.includes('hans')) {
      score += 80;
    } else if (normLang === 'zh-hk') {
      score += 40;
    }
  } else if (targetLang === 'en-US') {
    if (normLang === 'en-us') {
      score += 200;
    } else if (normLang === 'en-gb' || normLang === 'en-au' || normLang === 'en-ca') {
      score += 120;
    } else {
      score += 80;
    }
  } else if (targetLang === 'ja-JP') {
    if (normLang === 'ja-jp' || normLang === 'ja') {
      score += 200;
    }
  }

  // Known female voice priority list
  const preferredList = PREFERRED_FEMALE_VOICE_PATTERNS[targetLang];
  for (let i = 0; i < preferredList.length; i++) {
    if (preferredList[i]!.test(haystack)) {
      score += 1000 - i * 60;
      break;
    }
  }

  // Explicit female marker in voice name
  if (/\b(female|woman|girl)\b/i.test(haystack) || /女|女聲|女性/.test(haystack)) {
    score += 300;
  }

  // Prefer natural/premium/enhanced voices when available
  if (/\b(natural|premium|enhanced|neural|siri)\b/i.test(haystack)) {
    score += 50;
  }

  return score;
}

/**
 * Selects the best FEMALE voice for the target language ('zh-TW' | 'en-US' | 'ja-JP').
 * Never returns a male voice or a voice from a different language family.
 */
export function selectFemaleVoice<T extends VoiceLike>(
  voices: readonly T[],
  targetLang: SpeechLangCode
): T | null {
  if (!voices || voices.length === 0) return null;

  let bestVoice: T | null = null;
  let bestScore = -1;

  for (const v of voices) {
    const sc = scoreFemaleCandidate(v, targetLang);
    if (sc > bestScore) {
      bestScore = sc;
      bestVoice = v;
    }
  }

  return bestScore >= 0 ? bestVoice : null;
}

/**
 * Loads available browser SpeechSynthesisVoices, waiting briefly for `voiceschanged`
 * if the browser initializes its voice list asynchronously on first call.
 */
async function getBrowserVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const existing = synth.getVoices();
  if (existing && existing.length > 0) return existing;

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener?.('voiceschanged', onVoicesChanged);
      resolve(synth.getVoices() ?? []);
    };
    const onVoicesChanged = () => finish();
    synth.addEventListener?.('voiceschanged', onVoicesChanged);
    window.setTimeout(finish, 250);
  });
}

let activeSpeakRequestId = 0;

function stopCurrentAudioElement(): void {
  if (activeAudioElement) {
    try {
      activeAudioElement.onended = null;
      activeAudioElement.onerror = null;
      activeAudioElement.pause();
      activeAudioElement.src = '';
    } catch {
      /* ignore */
    }
    activeAudioElement = null;
  }
}

/**
 * Speaks the given text with:
 * 1. Strict UI locale matching:
 *    - 'zh-Hant' (中) -> 'zh-TW' (Female Taiwanese Mandarin voice)
 *    - 'en'      (EN) -> 'en-US' (Female American English voice)
 *    - 'ja'      (日) -> 'ja-JP' (Female Japanese voice)
 * 2. Primary cloud-synthesized natural Female MP3 audio (`/api/tts/audio`) so playback
 *    never fails even when macOS local voices (like `Kyoko`) are not downloaded on the machine
 * 3. Web Speech API fallback with strict FEMALE voice selection (never male)
 */
export async function speakTextWithFemaleVoice(options: {
  text: string;
  uiLocale?: Locale;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}): Promise<void> {
  if (typeof window === 'undefined') {
    options.onError?.();
    return;
  }

  const reqId = ++activeSpeakRequestId;
  stopCurrentAudioElement();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  const cleaned = cleanTextForSpeech(options.text);
  if (!cleaned) {
    options.onEnd?.();
    return;
  }

  options.onStart?.();

  const targetLang = resolveSpeechLanguage(cleaned, options.uiLocale ?? 'zh-Hant');

  // Create HTMLAudioElement synchronously inside user gesture handler
  const audio = new Audio();
  activeAudioElement = audio;

  const cloudAudio = await fetchFemaleSpeechAudioAsync(cleaned, targetLang);
  if (reqId !== activeSpeakRequestId) {
    return;
  }

  if (cloudAudio?.audioDataUrl) {
    try {
      audio.src = cloudAudio.audioDataUrl;
      audio.playbackRate = targetLang === 'ja-JP' ? 1.05 : 1.08;
      audio.onended = () => {
        if (reqId === activeSpeakRequestId) {
          activeAudioElement = null;
          options.onEnd?.();
        }
      };
      audio.onerror = () => {
        if (reqId === activeSpeakRequestId) {
          activeAudioElement = null;
          options.onError?.();
        }
      };
      await audio.play();
      return;
    } catch {
      stopCurrentAudioElement();
      // Fall through to Web Speech API fallback below
    }
  }

  if (!('speechSynthesis' in window)) {
    options.onError?.();
    return;
  }

  const synth = window.speechSynthesis;
  const [voices, localizedText] = await Promise.all([
    getBrowserVoices(synth),
    translateTextForSpeechAsync(cleaned, targetLang),
  ]);

  if (reqId !== activeSpeakRequestId) {
    return;
  }

  const finalSpeechText = localizedText || adaptTextForSpeechLocaleSync(cleaned, targetLang);
  if (!finalSpeechText) {
    options.onEnd?.();
    return;
  }

  const femaleVoice = selectFemaleVoice(voices, targetLang);

  const utter = new SpeechSynthesisUtterance(finalSpeechText);
  utter.lang = targetLang;
  if (femaleVoice) {
    utter.voice = femaleVoice;
  }
  utter.rate = targetLang === 'ja-JP' ? 1.02 : 1.05;
  utter.pitch = 1.05;

  utter.onend = () => {
    if (reqId === activeSpeakRequestId) options.onEnd?.();
  };
  utter.onerror = () => {
    if (reqId === activeSpeakRequestId) options.onError?.();
  };

  synth.cancel();
  synth.speak(utter);
}

export function stopActiveSpeech(): void {
  activeSpeakRequestId++;
  stopCurrentAudioElement();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
