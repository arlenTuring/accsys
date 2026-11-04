'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acknowledgeAction, markReadAction } from '@/lib/announcements/actions';

export function AnnouncementViewerActions(props: {
  id: string;
  readAt: string | null;
  acknowledgedAt: string | null;
}) {
  const router = useRouter();
  const [, start] = useTransition();

  useEffect(() => {
    if (!props.readAt) {
      start(async () => {
        await markReadAction(props.id);
        router.refresh();
      });
    }
  }, [props.id, props.readAt, router]);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
      <span className="text-td-muted">{props.readAt ? '已閱讀' : '標記閱讀中…'}</span>
      {props.acknowledgedAt ? (
        <span className="text-td-muted">已確認知悉</span>
      ) : (
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            start(async () => {
              await acknowledgeAction(props.id);
              router.refresh();
            })
          }
        >
          確認知悉
        </button>
      )}
    </div>
  );
}
