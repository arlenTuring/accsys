import { describe, expect, it } from 'vitest';
import {
  adaptTextForSpeechLocaleSync,
  cleanTextForSpeech,
  isMaleVoice,
  resolveSpeechLanguage,
  selectFemaleVoice,
  type VoiceLike,
} from './speech';

describe('speech language resolution & female voice selection', () => {
  it('strictly obeys UI locale button (中 -> zh-TW, EN -> en-US, 日 -> ja-JP) regardless of text script', () => {
    const japaneseMsg =
      '現在、お客様の承認（サイン）待ちとなっている申請書類は合計で 6 件ございます。';
    const englishMsgWithChineseNames =
      'Here are your 6 pending approval documents: 1. Seal Request — Applicant: 阮振瑋, 許雲茹, 陳維隆.';
    const chineseMsgWithBullets =
      '目前您有 6 張待簽核單據：\n・20261117BT0001 公出差旅申請單（阮振瑋）';

    // When UI button is 中 (zh-Hant) -> ALWAYS zh-TW
    expect(resolveSpeechLanguage(japaneseMsg, 'zh-Hant')).toBe('zh-TW');
    expect(resolveSpeechLanguage(englishMsgWithChineseNames, 'zh-Hant')).toBe('zh-TW');
    expect(resolveSpeechLanguage(chineseMsgWithBullets, 'zh-Hant')).toBe('zh-TW');

    // When UI button is EN (en) -> ALWAYS en-US (never overridden by Chinese names!)
    expect(resolveSpeechLanguage(japaneseMsg, 'en')).toBe('en-US');
    expect(resolveSpeechLanguage(englishMsgWithChineseNames, 'en')).toBe('en-US');
    expect(resolveSpeechLanguage(chineseMsgWithBullets, 'en')).toBe('en-US');

    // When UI button is 日 (ja) -> ALWAYS ja-JP
    expect(resolveSpeechLanguage(japaneseMsg, 'ja')).toBe('ja-JP');
    expect(resolveSpeechLanguage(englishMsgWithChineseNames, 'ja')).toBe('ja-JP');
    expect(resolveSpeechLanguage(chineseMsgWithBullets, 'ja')).toBe('ja-JP');
  });

  it('adapts text into target language and strips conflicting script characters so OS TTS never switches voices', () => {
    const japaneseScreenshotMsg =
      '現在、お客様の承認（サイン）待ちとなっている申請書類は合計で 6 件ございます（画面上に概要カードが表示されています）。主な内容は以下のとおりです。\n1. 押印申請書（契約関連）(2件)\n申請者：阮振瑋';

    // Switching UI to 中 (zh-TW) converts the Japanese message to Traditional Chinese with zero Japanese Kana
    const zhAdapted = adaptTextForSpeechLocaleSync(japaneseScreenshotMsg, 'zh-TW');
    expect(zhAdapted).toContain('目前等待您簽核的申請單據共有 6 件');
    expect(zhAdapted).toContain('用印申請單（合約類）');
    expect(/[\u3041-\u3096\u30A1-\u30FA]/.test(zhAdapted)).toBe(false);

    // Switching UI to EN (en-US) converts the message to pure English and romanizes 阮振瑋 -> Zhen-Wei Ruan
    const enAdapted = adaptTextForSpeechLocaleSync(japaneseScreenshotMsg, 'en-US');
    expect(enAdapted).toContain('You currently have 6 pending approval documents');
    expect(enAdapted).toContain('Seal Application for Contracts');
    expect(enAdapted).toContain('Zhen-Wei Ruan');
    expect(/[\u4E00-\u9FFF\u3040-\u30FF]/.test(enAdapted)).toBe(false);
  });

  it('selects female voices for zh-TW, en-US, and ja-JP and strictly rejects male voices', () => {
    const mockVoices: VoiceLike[] = [
      // Chinese male & female
      { name: 'Eddy (Chinese (Taiwan))', lang: 'zh-TW' },
      { name: 'Reed (Chinese (Taiwan))', lang: 'zh-TW' },
      { name: 'Microsoft Yunxi Online (Natural) - Chinese (Mainland)', lang: 'zh-CN' },
      { name: 'Meijia', lang: 'zh-TW' },
      { name: 'Tingting', lang: 'zh-CN' },
      // English male & female
      { name: 'Daniel', lang: 'en-GB' },
      { name: 'Alex', lang: 'en-US' },
      { name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US' },
      { name: 'Samantha', lang: 'en-US' },
      // Japanese male & female
      { name: 'Otoya', lang: 'ja-JP' },
      { name: 'Hattori', lang: 'ja-JP' },
      { name: 'Microsoft Keita Online - Japanese (Japan)', lang: 'ja-JP' },
      { name: 'Kyoko', lang: 'ja-JP' },
    ];

    const zhVoice = selectFemaleVoice(mockVoices, 'zh-TW');
    expect(zhVoice?.name).toBe('Meijia');
    expect(isMaleVoice(zhVoice!)).toBe(false);

    const enVoice = selectFemaleVoice(mockVoices, 'en-US');
    expect(enVoice?.name).toBe('Samantha');
    expect(isMaleVoice(enVoice!)).toBe(false);

    const jaVoice = selectFemaleVoice(mockVoices, 'ja-JP');
    expect(jaVoice?.name).toBe('Kyoko');
    expect(isMaleVoice(jaVoice!)).toBe(false);
  });

  it('never returns a male voice even if only male voices exist for that language', () => {
    const onlyMaleVoices: VoiceLike[] = [
      { name: 'Eddy (Chinese (Taiwan))', lang: 'zh-TW' },
      { name: 'Otoya', lang: 'ja-JP' },
      { name: 'Daniel', lang: 'en-US' },
    ];
    expect(selectFemaleVoice(onlyMaleVoices, 'zh-TW')).toBeNull();
    expect(selectFemaleVoice(onlyMaleVoices, 'ja-JP')).toBeNull();
    expect(selectFemaleVoice(onlyMaleVoices, 'en-US')).toBeNull();
  });

  it('cleans markdown and middle dots for smooth speech synthesis', () => {
    const cleaned = cleanTextForSpeech('### **標題**\n・項目一：`TD2601` 專案');
    expect(cleaned).not.toContain('**');
    expect(cleaned).not.toContain('・');
    expect(cleaned).toContain('標題');
    expect(cleaned).toContain('TD2601');
  });
});
