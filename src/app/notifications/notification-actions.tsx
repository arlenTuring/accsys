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
      className="ml-2 rounded border px-2 py-1 text-xs"
    >
      標示為已讀
    </button>
  );
}
