import { redirect } from 'next/navigation';

/** Legacy path — management lives under 系統管理. */
export default async function AnnouncementEditRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/announcements/${id}/edit`);
}
