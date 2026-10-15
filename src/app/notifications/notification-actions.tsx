'use client';

import { useRouter } from 'next/navigation';
import { markNotificationRead } from '@/lib/notifications/actions';

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await markNotificationRead(notificationId);
        router.refresh();
      }}
      className="shrink-0 rounded border border-td-border bg-white px-2.5 py-1 text-xs font-semibold text-td-blue hover:bg-td-blue-light"
    >
      標示為已讀
    </button>
  );
}
