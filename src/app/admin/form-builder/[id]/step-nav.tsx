'use client';

export type Tab = 'fields' | 'flow' | 'settings' | 'preview' | 'publish';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'fields', label: '欄位設計' },
  { id: 'flow', label: '簽核流程' },
  { id: 'settings', label: '發佈設定' },
  { id: 'preview', label: '預覽' },
  { id: 'publish', label: '版本與發佈' },
];

/**
 * Previous / next step of the designer. Next stays disabled, with the reason
 * next to it, until the step has real content; the last step publishes from
 * its own panel.
 */
export function StepNav({
  tab,
  goTo,
  blocked,
  onNext,
  nextLabel,
}: {
  tab: Tab;
  goTo: (t: Tab) => void;
  /** Why the next step is not available yet; null when it is. */
  blocked: string | null;
  /** Runs instead of going straight to the next step (e.g. save first). */
  onNext?: () => void;
  nextLabel?: string;
}) {
  const i = TABS.findIndex((t) => t.id === tab);
  const prev = TABS[i - 1];
  const next = TABS[i + 1];
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {prev && (
        <button type="button" className="btn-ghost !px-3 !py-2 mr-auto" onClick={() => goTo(prev.id)}>
          ← 上一步：{prev.label}
        </button>
      )}
      {next && blocked && <span className="text-xs text-amber-800">{blocked}</span>}
      {next ? (
        <button
          type="button"
          className="btn-primary"
          disabled={blocked !== null}
          onClick={() => (onNext ? onNext() : goTo(next.id))}
        >
          {nextLabel ?? `下一步：${next.label}`} →
        </button>
      ) : (
        <span className="text-xs text-td-muted">最後一步：確認上方的變更後按「發佈」。</span>
      )}
    </div>
  );
}
