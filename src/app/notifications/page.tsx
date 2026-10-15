import Link from 'next/link';
import { getMyNotifications } from '@/lib/notifications/queries';
import { FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { MarkReadButton } from './notification-actions';

export default async function NotificationsPage() {
  const notifications = await getMyNotifications();
  return (
    <main className="page-shell max-w-3xl space-y-5">
      <section>
        <p className="section-title">個人</p>
        <h1 className="page-title">通知</h1>
      </section>
      {notifications.length === 0 ? (
        <p className="card text-sm text-td-muted">目前沒有通知。</p>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {notifications.map((n) => (
            <li key={n.id} className={`flex items-center justify-between gap-3 px-5 py-4 first:rounded-t-card last:rounded-b-card ${n.isRead ? '' : 'bg-td-blue-light/60'}`}>
              <Link href={`${FORM_ROUTE_PREFIX[n.formType as FormType]}/${n.formId}`} className="flex-1 text-sm hover:text-td-blue">
                <span className="mono-case">{n.caseNumber}</span>
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
