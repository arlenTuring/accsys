'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { publishAnnouncementAction, withdrawAnnouncementAction } from '@/lib/announcements/actions';

export function AnnouncementManageActions(props: { id: string; version: number; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap gap-2 border-t pt-4 text-sm">
      {props.status !== 'published' && props.status !== 'withdrawn' && (
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await publishAnnouncementAction(props.id, props.version);
              if (!res.ok) setError(String(res.error));
              else router.refresh();
            })
          }
        >
          發布／排程
        </button>
      )}
      {props.status !== 'withdrawn' && (
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await withdrawAnnouncementAction(props.id, props.version);
              if (!res.ok) setError(String(res.error));
              else router.refresh();
            })
          }
        >
          撤下
        </button>
      )}
      {error && <p className="w-full text-amber-800">{error}</p>}
    </div>
  );
}
