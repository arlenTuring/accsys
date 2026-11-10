/** Sentence-level diff for showing what the co-author changed in a paragraph. */

export type DiffPart = { type: 'same' | 'added' | 'removed'; text: string };

export function splitSentences(text: string): string[] {
  const parts = text.match(/[^。！？；!?;，,\n]+[。！？；!?;，,]*\n?|\n/g) ?? [];
  return parts.filter((p) => p.length > 0);
}

export function diffSentences(before: string, after: string): DiffPart[] {
  const a = splitSentences(before);
  const b = splitSentences(after);
  const key = (s: string) => s.replace(/\s+/g, '');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = key(a[i]) === key(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const prev = out[out.length - 1];
    if (prev && prev.type === type) prev.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) {
      push('same', b[j]);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('removed', a[i]);
      i += 1;
    } else {
      push('added', b[j]);
      j += 1;
    }
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);
  return out;
}

export function countVisibleChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}
