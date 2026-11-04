'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { listMentionEmployeesAction } from '@/lib/ai-chat/actions';

type MentionCandidate = {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string;
  departmentName: string;
  title: string | null;
};

const AVATAR_TONES = [
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-sky-100 text-sky-800 border-sky-200',
  'bg-emerald-100 text-emerald-800 border-emerald-200',
  'bg-violet-100 text-violet-800 border-violet-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-teal-100 text-teal-800 border-teal-200',
];

function avatarToneFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function shortDeptLabel(dept: string): string {
  return dept.replace(/(部|處|室|中心|課|組)$/, '') || dept;
}

function renderHighlightedText(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <>
      {before}
      <span className="font-semibold text-blue-600">{match}</span>
      {after}
    </>
  );
}

function detectActiveMention(text: string, caret: number): { start: number; end: number; query: string } | null {
  const prefix = text.slice(0, caret);
  // Match the last @ or ＠ before the caret, as long as it is not preceded by an ASCII letter/digit (e.g. email user@domain).
  // Allows Chinese characters right before @ such as "我想把資產轉移給@".
  const m = prefix.match(/(?:^|[^a-zA-Z0-9._%+-])([@＠]([^\s@＠,，。！!？?、；;：:（）()]{0,20}))$/);
  if (!m) return null;
  const fullToken = m[1];
  const query = m[2] ?? '';
  const start = caret - fullToken.length;
  return { start, end: caret, query };
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

type Props = {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFilesSelected: (files: FileList | null) => void;
  disabled?: boolean;
  sendDisabled?: boolean;
  sendTitle?: string;
  pending?: boolean;
  attachmentsBusy?: boolean;
  placeholder?: string;
  sendLabel?: string;
  modelLabel?: string;
};

export function ChatComposer({
  inputRef,
  value,
  onChange,
  onSend,
  onFilesSelected,
  disabled = false,
  sendDisabled = false,
  sendTitle,
  pending = false,
  attachmentsBusy = false,
  placeholder = '輸入訊息，或把檔案拖進來…（按兩次 Enter 傳送）',
  sendLabel = '傳送',
  modelLabel = 'Gemini',
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speechHint, setSpeechHint] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const enterArmedRef = useRef(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechHadOutputRef = useRef(false);
  const cancelledSpeechRef = useRef(false);
  const sendAfterSpeechRef = useRef(false);
  const initialBeforeSpeechRef = useRef('');
  const baseBeforeSpeechRef = useRef('');
  /** Latest result count seen so manual edits can skip all prior recognition segments. */
  const lastResultLenRef = useRef(0);
  const skipBelowIndexRef = useRef(0);
  /** Transcript present in `ev.results[skipBelowIndexRef]` at the moment the user edited text. */
  const skippedLeadingTextRef = useRef('');
  const latestRowTranscriptRef = useRef('');
  const latestValueRef = useRef(value);
  latestValueRef.current = value;
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const WAVE_SLOTS = 64;
  const [waveBars, setWaveBars] = useState<number[]>(() => Array.from({ length: WAVE_SLOTS }, () => 0));
  const [waveTick, setWaveTick] = useState(0);
  const [recordElapsedSec, setRecordElapsedSec] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const [mentionRoster, setMentionRoster] = useState<MentionCandidate[] | null>(null);
  const [mentionState, setMentionState] = useState<{ start: number; end: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionListRef = useRef<HTMLDivElement>(null);

  function ensureRosterLoaded() {
    if (mentionRoster !== null) return;
    void listMentionEmployeesAction().then((res) => {
      if (res.ok) setMentionRoster(res.employees);
    });
  }

  useEffect(() => {
    let cancelled = false;
    void listMentionEmployeesAction().then((res) => {
      if (!cancelled && res.ok) {
        setMentionRoster(res.employees);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Also re-evaluate whenever `value` changes (including HMR / external updates)
  useEffect(() => {
    const caret = inputRef.current?.selectionStart ?? value.length;
    const hit = detectActiveMention(value, caret);
    setMentionState(hit);
    setMentionIdx(0);
    if (hit && mentionRoster === null) {
      ensureRosterLoaded();
    }
  }, [value]);

  const filteredMentions = useMemo(() => {
    if (!mentionState || !mentionRoster) return [];
    const q = mentionState.query.trim().toLowerCase();
    if (!q) return mentionRoster.slice(0, 30);
    return mentionRoster
      .filter((emp) => {
        const shortDept = shortDeptLabel(emp.departmentName).toLowerCase();
        return (
          emp.name.toLowerCase().includes(q) ||
          emp.departmentName.toLowerCase().includes(q) ||
          shortDept.includes(q) ||
          emp.employeeCode.toLowerCase().includes(q) ||
          (emp.title?.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, 30);
  }, [mentionState, mentionRoster]);

  function refreshMentionFromTextarea(text: string, caretPos?: number | null) {
    const caret = typeof caretPos === 'number' ? caretPos : (inputRef.current?.selectionStart ?? text.length);
    const hit = detectActiveMention(text, caret);
    setMentionState(hit);
    setMentionIdx(0);
  }

  function applyMentionSelection(emp: MentionCandidate) {
    if (!mentionState) return;
    const before = value.slice(0, mentionState.start);
    const after = value.slice(mentionState.end);
    const inserted = `@${emp.name} `;
    const next = `${before}${inserted}${after.replace(/^\s+/, '')}`;
    const nextCaret = before.length + inserted.length;
    setMentionState(null);
    enterArmedRef.current = false;
    onChange(next);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function stopMeter() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) {
      void ctx.close().catch(() => undefined);
    }
  }

  function startMeter(stream: MediaStream) {
    stopMeter();
    setWaveBars(Array.from({ length: WAVE_SLOTS }, () => 0));
    setWaveTick(0);
    setRecordElapsedSec(0);
    const startedAt = performance.now();
    const Ctx =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    let analyser: AnalyserNode | null = null;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    if (Ctx) {
      try {
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => undefined);
        }
        const source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.55;
        source.connect(analyser);
        buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      } catch {
        analyser = null;
      }
    }
    let lastPush = 0;
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastPush < 50) return;
      lastPush = now;
      setRecordElapsedSec(Math.floor((now - startedAt) / 1000));
      setWaveTick((t) => (t + 1) % 10000);
      let level = 0;
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const d = Math.abs((buf[i]! - 128) / 128);
          sumSq += d * d;
          if (d > peak) peak = d;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        const energy = Math.max(rms * 1.4, peak * 0.85);
        level = energy < 0.012 ? 0 : Math.min(1, Math.pow(energy * 5.8, 0.7));
      }
      setWaveBars((prev) => {
        const next = prev.slice(1);
        next.push(level);
        return next;
      });
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function releaseStream() {
    stopMeter();
    const s = streamRef.current;
    streamRef.current = null;
    if (!s) return;
    for (const track of s.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {
        /* ignore */
      }
      releaseStream();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (mentionState && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIdx((i) => {
          const next = (i + 1) % filteredMentions.length;
          const row = mentionListRef.current?.children[next] as HTMLElement | undefined;
          row?.scrollIntoView({ block: 'nearest' });
          return next;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => {
          const next = (i - 1 + filteredMentions.length) % filteredMentions.length;
          const row = mentionListRef.current?.children[next] as HTMLElement | undefined;
          row?.scrollIntoView({ block: 'nearest' });
          return next;
        });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const chosen = filteredMentions[mentionIdx] ?? filteredMentions[0];
        if (chosen) applyMentionSelection(chosen);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    if (enterArmedRef.current) {
      enterArmedRef.current = false;
      onSend();
    } else {
      enterArmedRef.current = true;
    }
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer?.types?.includes('Files')) setDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragging(false);
    if (disabled) return;
    onFilesSelected(e.dataTransfer?.files ?? null);
  }

  function stopListening(opts?: { cancel?: boolean; send?: boolean }) {
    cancelledSpeechRef.current = Boolean(opts?.cancel);
    sendAfterSpeechRef.current = Boolean(opts?.send);
    setListening(false);
    if (opts?.cancel) {
      onChange(initialBeforeSpeechRef.current);
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    } else {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
        return;
      }
    } catch {
      /* ignore */
    }
    releaseStream();
    if (opts?.send && !opts?.cancel && latestValueRef.current.trim()) {
      requestAnimationFrame(() => onSendRef.current());
    }
  }

  async function requestMicAndStart() {
    if (disabled || pending || transcribing) return;
    if (listening) {
      stopListening();
      return;
    }
    setSpeechHint(null);
    setPermissionDenied(false);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSpeechHint('目前連線環境無法存取麥克風（需 localhost 或 HTTPS）。');
      return;
    }

    // Explicitly call getUserMedia inside the click gesture so the browser pops its native permission prompt.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const msg = err instanceof Error ? err.message : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermissionDenied(true);
        if (/permissions policy|feature policy/i.test(msg)) {
          setSpeechHint('頁面標頭尚未載入麥克風授權，請重新整理此頁（Cmd+R / F5）後再點麥克風。');
        } else {
          setSpeechHint(
            '無法取得麥克風權限。若網址列已開啟麥克風，請檢查系統設定（macOS「系統設定 → 隱私權與安全性 → 麥克風」需勾選您的瀏覽器），再點下方「重新請求權限」。'
          );
        }
      } else if (name === 'NotFoundError') {
        setSpeechHint('找不到麥克風裝置，請確認已連接麥克風。');
      } else {
        setSpeechHint(`無法啟動麥克風（${name || '未知錯誤'}），請檢查裝置或權限。`);
      }
      return;
    }

    streamRef.current = stream;
    initialBeforeSpeechRef.current = latestValueRef.current;
    baseBeforeSpeechRef.current = latestValueRef.current;
    cancelledSpeechRef.current = false;
    sendAfterSpeechRef.current = false;
    lastResultLenRef.current = 0;
    skipBelowIndexRef.current = 0;
    skippedLeadingTextRef.current = '';
    latestRowTranscriptRef.current = '';
    speechHadOutputRef.current = false;
    chunksRef.current = [];
    setListening(true);
    startMeter(stream);

    // 1) Start live browser speech-to-text when supported so words appear as the person speaks.
    const Ctor = getSpeechRecognitionCtor();
    if (Ctor) {
      try {
        const rec = new Ctor();
        recognitionRef.current = rec;
        rec.lang = 'zh-TW';
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (ev) => {
          lastResultLenRef.current = ev.results.length;
          const lastIdx = ev.results.length - 1;
          latestRowTranscriptRef.current = lastIdx >= 0 ? (ev.results[lastIdx]?.[0]?.transcript ?? '') : '';

          let spoken = '';
          for (let i = skipBelowIndexRef.current; i < ev.results.length; i++) {
            const row = ev.results[i];
            if (!row) continue;
            let piece = row[0]?.transcript ?? '';
            if (!piece) continue;
            if (i === skipBelowIndexRef.current && skippedLeadingTextRef.current) {
              if (piece.startsWith(skippedLeadingTextRef.current)) {
                piece = piece.slice(skippedLeadingTextRef.current.length);
              } else {
                continue;
              }
            }
            // Some Chromium builds emit cumulative transcripts on consecutive results; avoid doubling.
            if (spoken && piece.startsWith(spoken)) {
              spoken = piece;
            } else {
              spoken += piece;
            }
          }
          if (spoken) {
            speechHadOutputRef.current = true;
            onChange(`${baseBeforeSpeechRef.current}${spoken}`);
          }
        };
        rec.onerror = () => {
          // Recorder fallback below still captures audio for Gemini transcription.
        };
        rec.onend = () => {
          recognitionRef.current = null;
        };
        rec.start();
      } catch {
        recognitionRef.current = null;
      }
    }

    // 2) Record audio in parallel; when stopped, if browser STT produced nothing, Gemini transcribes the clip.
    if (typeof MediaRecorder !== 'undefined') {
      try {
        const mimeType = pickRecorderMime();
        const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        recorderRef.current = rec;
        rec.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
        };
        rec.onstop = () => {
          const recordedType = rec.mimeType || mimeType || 'audio/webm';
          recorderRef.current = null;
          releaseStream();
          const blob = new Blob(chunksRef.current, { type: recordedType });
          chunksRef.current = [];
          if (cancelledSpeechRef.current) return;
          if (speechHadOutputRef.current || blob.size < 400) {
            if (sendAfterSpeechRef.current && latestValueRef.current.trim()) {
              sendAfterSpeechRef.current = false;
              requestAnimationFrame(() => onSendRef.current());
            }
            return;
          }
          void transcribeWithGemini(blob, recordedType, sendAfterSpeechRef.current);
          sendAfterSpeechRef.current = false;
        };
        rec.start();
      } catch {
        recorderRef.current = null;
      }
    }
  }

  async function transcribeWithGemini(blob: Blob, mimeType: string, autoSend = false) {
    setTranscribing(true);
    setSpeechHint(null);
    try {
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const fd = new FormData();
      fd.set('audio', new File([blob], `voice.${ext}`, { type: mimeType }));
      const res = await fetch('/api/ai-chat/transcribe', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setSpeechHint(data?.error ?? '語音轉文字未完成，請再試一次。');
        return;
      }
      if (data.text) {
        const cur = latestValueRef.current;
        const sep = cur && !/\s$/.test(cur) ? ' ' : '';
        const merged = `${cur}${sep}${data.text}`;
        onChange(merged);
        if (autoSend && merged.trim()) {
          requestAnimationFrame(() => onSendRef.current());
        }
      } else {
        setSpeechHint('沒有辨識到語音內容，請靠近麥克風再試一次。');
      }
    } catch {
      setSpeechHint('語音轉文字連線失敗，請再試一次。');
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div
      className={`relative rounded-2xl border bg-white shadow-[0_8px_28px_rgba(15,23,42,0.08)] transition-[box-shadow,border-color,background-color] ${
        dragging
          ? 'border-td-blue bg-td-blue-light/40 shadow-[0_8px_28px_rgba(37,99,235,0.18)]'
          : 'border-td-border'
      } ${disabled ? 'opacity-70' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-td-blue bg-td-blue-light/50">
          <p className="text-base font-medium text-td-blue-dark">放開以上傳檔案</p>
        </div>
      )}

      {mentionState && (
        <div
          role="listbox"
          aria-label="標註公司員工"
          ref={mentionListRef}
          className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-60 overflow-y-auto rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-[0_10px_32px_rgba(15,23,42,0.14)]"
        >
          {mentionRoster === null ? (
            <div className="px-3 py-2.5 text-sm text-slate-500">正在載入公司員工名單…</div>
          ) : filteredMentions.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-slate-500">
              找不到符合「{mentionState.query}」的員工
            </div>
          ) : (
            filteredMentions.map((emp, idx) => {
              const active = idx === mentionIdx;
              const shortDept = shortDeptLabel(emp.departmentName);
              const avatarChar = emp.name.trim().slice(0, 1) || '員';
              return (
                <button
                  key={emp.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(ev) => {
                    // Prevent textarea blur before selection is applied
                    ev.preventDefault();
                    applyMentionSelection(emp);
                  }}
                  onMouseEnter={() => setMentionIdx(idx)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    active ? 'bg-slate-100/90' : 'hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${avatarToneFor(emp.id)}`}
                    aria-hidden
                  >
                    {avatarChar}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base text-slate-800">
                    <span className="text-slate-600">[{renderHighlightedText(shortDept, mentionState.query)}]</span>
                    <span>{renderHighlightedText(emp.name, mentionState.query)}</span>
                  </span>
                  {emp.title && (
                    <span className="shrink-0 text-xs text-slate-400">{emp.title}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}

      <textarea
        ref={inputRef}
        className="min-h-[3.25rem] w-full resize-none border-0 bg-transparent px-4 pb-2 pt-3 text-base text-td-blue-dark outline-none placeholder:text-td-muted"
        rows={2}
        value={value}
        onChange={(e) => {
          enterArmedRef.current = false;
          const next = e.target.value;
          const caret = e.target.selectionStart;
          if (listening) {
            // Treat manual edits/deletions while recording as the new baseline and ignore prior speech segments.
            baseBeforeSpeechRef.current = next;
            skipBelowIndexRef.current = Math.max(0, lastResultLenRef.current - 1);
            skippedLeadingTextRef.current = latestRowTranscriptRef.current;
          }
          onChange(next);
          refreshMentionFromTextarea(next, caret);
        }}
        onFocus={(e) => {
          ensureRosterLoaded();
          refreshMentionFromTextarea(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onClick={(e) => {
          ensureRosterLoaded();
          refreshMentionFromTextarea(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            refreshMentionFromTextarea(e.currentTarget.value, e.currentTarget.selectionStart);
          }
        }}
        onBlur={() => {
          enterArmedRef.current = false;
          setTimeout(() => setMentionState(null), 150);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="訊息"
        disabled={disabled}
      />

      {listening ? (
        <div
          role="status"
          aria-label="語音錄製中"
          className="flex items-center gap-2.5 border-t border-td-border px-3 py-2"
        >
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-td-blue-dark hover:bg-slate-200"
            aria-label="取消語音輸入"
            title="取消這次語音輸入"
            onClick={() => stopListening({ cancel: true })}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
              <path
                fill="currentColor"
                d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"
              />
            </svg>
          </button>

          <svg
            viewBox={`0 0 ${WAVE_SLOTS * 6} 28`}
            preserveAspectRatio="none"
            className="h-7 min-w-0 flex-1"
            aria-hidden
          >
            {waveBars.map((lvl, idx) => {
              // Gentle travelling ripple on the right half so the user always sees live motion,
              // plus strong vertical bars whenever the microphone picks up speech.
              const tailWeight = Math.max(0, (idx - WAVE_SLOTS * 0.35) / (WAVE_SLOTS * 0.65));
              const idleWave =
                tailWeight * (0.14 + 0.1 * Math.sin(waveTick * 0.45 - idx * 0.55));
              const effective = Math.max(lvl, idleWave);
              const isActive = lvl > 0.04 || tailWeight > 0.15;
              const h = isActive ? Math.max(4, Math.min(24, Math.round(3 + effective * 21))) : 3;
              const y = (28 - h) / 2;
              const x = idx * 6 + 1.5;
              const fill =
                lvl > 0.06
                  ? '#334155'
                  : isActive
                    ? '#64748b'
                    : '#cbd5e1';
              return (
                <rect
                  key={idx}
                  x={x}
                  y={y}
                  width={3}
                  height={h}
                  rx={1.5}
                  fill={fill}
                />
              );
            })}
          </svg>

          <span className="shrink-0 font-mono text-xs text-td-muted">
            {String(Math.floor(recordElapsedSec / 60)).padStart(1, '0')}:
            {String(recordElapsedSec % 60).padStart(2, '0')}
          </span>

          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-td-blue-dark hover:bg-slate-300"
            aria-label="停止錄音"
            title="停止錄音（保留文字）"
            onClick={() => stopListening()}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-td-blue-dark text-white hover:opacity-90 disabled:opacity-40"
            aria-label="完成語音並送出"
            title="完成語音並送出訊息"
            disabled={disabled || pending}
            onClick={() => stopListening({ send: true })}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
              <path
                fill="currentColor"
                d="M11 19V7.83l-4.88 4.88L4.7 11.3 12 4l7.3 7.3-1.42 1.41L13 7.83V19z"
              />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-td-blue-dark hover:bg-slate-100 disabled:opacity-50"
              aria-label="選擇檔案上傳"
              title="選擇檔案上傳（也可直接拖拉檔案進來）"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              disabled={disabled}
              onChange={(e) => {
                onFilesSelected(e.target.files);
                e.target.value = '';
              }}
            />
            <span className="hidden text-xs text-td-muted sm:inline">拖放任意檔案，或按 + 選擇檔案</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="hidden rounded-full bg-slate-100 px-2 py-1 text-xs text-td-muted sm:inline">{modelLabel}</span>
            <button
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
                transcribing ? 'bg-td-blue-light text-td-blue-dark' : 'text-td-blue-dark hover:bg-slate-100'
              } disabled:opacity-50`}
              aria-label="開始語音輸入"
              aria-pressed={false}
              title="點一下開始語音輸入（會詢問麥克風權限）"
              disabled={disabled || pending || transcribing}
              onClick={() => void requestMicAndStart()}
            >
              {transcribing ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"
                  />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-td-blue px-3 text-sm font-medium text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
              disabled={sendDisabled}
              title={sendTitle}
              onClick={() => onSend()}
            >
              {pending ? '…' : attachmentsBusy ? '處理中' : sendLabel}
            </button>
          </div>
        </div>
      )}

      {transcribing && (
        <p role="status" className="border-t border-td-border px-3 py-1.5 text-xs text-td-blue-dark">
          正在透過 Gemini 將語音轉成文字…
        </p>
      )}
      {speechHint && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-t border-td-border px-3 py-1.5 text-xs text-td-muted"
        >
          <span>{speechHint}</span>
          {permissionDenied && (
            <button
              type="button"
              className="shrink-0 rounded-md border border-td-border bg-slate-50 px-2 py-0.5 text-xs font-medium text-td-blue-dark hover:bg-slate-100"
              onClick={() => void requestMicAndStart()}
            >
              重新請求權限
            </button>
          )}
        </div>
      )}
    </div>
  );
}
