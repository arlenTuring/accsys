import type { ReactNode } from 'react';
import type { BuilderStatus } from '@/lib/form-builder/queries';

export const STATUS_BADGE: Record<BuilderStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'badge-withdrawn' },
  published: { label: '已發佈', cls: 'badge-approved' },
  archived: { label: '已暫停', cls: 'badge-returned' },
};

export const fieldLabelCls = 'text-xs font-semibold text-td-blue-dark';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={fieldLabelCls}>{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-xs text-td-muted">{hint}</span>}
    </label>
  );
}
