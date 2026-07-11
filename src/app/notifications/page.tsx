import Link from 'next/link';
import { getMyNotifications } from '@/lib/notifications/queries';
import { MarkReadButton } from './notification-actions';

export default async function NotificationsPage() {
  const notifications = await getMyNotifications();
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-bold">通知</h1>
      {notifications.length === 0 ? (
        <p className="text-gray-500">目前沒有通知。</p>
      ) : (
        <ul className="divide-y rounded border">
          {notifications.map((n) => (
            <li key={n.id} className={`flex items-center justify-between p-4 ${n.isRead ? '' : 'bg-blue-50'}`}>
              <Link href={`/requests/${n.formId}`} className="flex-1 hover:underline">
                <span className="font-mono text-sm text-gray-500">{n.caseNumber}</span>
                <span className="ml-2">{n.message}</span>
              </Link>
              {!n.isRead && <MarkReadButton notificationId={n.id} />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
