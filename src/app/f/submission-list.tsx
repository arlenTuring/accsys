import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import type { SubmissionListItem } from '@/lib/custom-forms/queries';

const fmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

export function SubmissionList({ items, showName }: { items: SubmissionListItem[]; showName: boolean }) {
  if (items.length === 0) return <div className="card text-sm text-td-muted">目前沒有申請紀錄。</div>;
  return (
    <ul className="card divide-y divide-td-border !p-0">
      {items.map((s) => (
        <li key={s.id}>
          <Link
            href={`/f/${s.key}/${s.id}`}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-td-blue-light/40"
          >
            <span className="mono-case">{s.formNumber}</span>
            {showName && <span className="text-sm text-td-blue-dark">{s.name}</span>}
            <span className={STATUS_BADGE[s.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[s.status] ?? s.status}</span>
            <span className="text-sm text-td-muted">{s.totalAmount === null ? '' : `NT$ ${s.totalAmount.toLocaleString()}`}</span>
            <span className="text-sm text-td-muted">{fmt.format(s.createdAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
