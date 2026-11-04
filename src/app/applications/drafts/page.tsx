import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ApplicationsDraftLibrary } from './applications-draft-library';

export default async function ApplicationsDraftsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/applications/drafts');

  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">我的申請</p>
        <h1 className="page-title">草稿庫</h1>
        <p className="page-subtitle">
          與 AI 助手共用同一草稿 ID 與權限。可在此搜尋、開啟完整編輯，或交給 AI 繼續處理。
        </p>
        <p className="mt-2 text-sm">
          <Link className="underline" href="/f">
            其他申請單
          </Link>
          {' · '}
          <Link className="underline" href="/tools/ai-chat">
            AI 助手
          </Link>
        </p>
      </section>
      <ApplicationsDraftLibrary />
    </main>
  );
}
