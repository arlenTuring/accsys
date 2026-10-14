import { notFound, redirect } from 'next/navigation';
import { getAttachments } from '@/lib/attachments/queries';
import { getSubmissionDetail } from '@/lib/custom-forms/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { CustomForm } from '../../../custom-form';

export default async function EditDesignerFormPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const detail = await getSubmissionDetail(id, { withOptions: true });
  if (!detail) notFound();
  if (detail.key !== key) redirect(`/f/${detail.key}/${id}/edit`);
  // The server re-checks; this only keeps people off a form they cannot change.
  if (!detail.options || (!detail.canEdit && !detail.canResubmit)) redirect(`/f/${detail.key}/${id}`);
  const attachments = await getAttachments('custom', id);
  return (
    <main className="page-shell">
      <CustomForm
        formKey={detail.key}
        name={detail.name}
        description={detail.canResubmit ? '已退回：修改後重新送出，會依目前的組織資料重新產生簽核流程。' : ''}
        schema={detail.schema}
        options={detail.options}
        today={taipeiToday()}
        mode={{ kind: detail.canResubmit ? 'resubmit' : 'update', id, version: detail.version, existingAttachmentCount: attachments.length }}
        initial={detail.data}
      />
    </main>
  );
}
