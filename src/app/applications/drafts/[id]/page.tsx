import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDraftForOwner } from '@/lib/ai-chat/drafts';
import { DraftFullEditor } from './draft-full-editor';

export default async function ApplicationDraftEditPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const { id } = await params;
  const draft = await getDraftForOwner(id, employee.id);
  if (!draft) notFound();

  return (
    <main className="page-shell space-y-4">
      <p className="text-sm">
        <Link href="/applications/drafts" className="underline">
          ← 草稿庫
        </Link>
        {' · '}
        <Link href={`/tools/ai-chat?draft=${encodeURIComponent(id)}`} className="underline">
          在 AI 助手開啟
        </Link>
      </p>
      <section>
        <p className="section-title">我的申請</p>
        <h1 className="page-title">{draft.title || '草稿'}</h1>
        <p className="page-subtitle">
          完整編輯頁與 AI 助手共用同一 draft ID（{draft.id.slice(0, 8)}…）。狀態：{draft.status} · 版本{' '}
          {draft.version}
        </p>
      </section>
      {draft.status !== 'draft' ? (
        <p className="card p-4 text-sm text-td-muted">
          此草稿已{draft.status === 'submitted' ? '送出' : '放棄'}，不可再編輯。請從原單據流程撤回或補件。
        </p>
      ) : (
        <DraftFullEditor draftId={draft.id} conversationId={draft.conversationId} initialVersion={draft.version} />
      )}
    </main>
  );
}
