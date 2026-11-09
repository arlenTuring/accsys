import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { TrackpadZoomFrame } from '../trackpad-zoom-frame';

export default async function FullPageFileViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; title?: string; mode?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect('/login?returnTo=/tools/project-assistant');
  }

  const params = await searchParams;
  const rawSrc = params.src ?? '';
  const title = params.title ?? '檔案預覽';
  const isEditMode = params.mode === 'edit';

  // Ensure only safe Google Drive / Docs preview or edit URLs can be embedded
  const isAllowedSrc =
    rawSrc.startsWith('https://drive.google.com/') ||
    rawSrc.startsWith('https://docs.google.com/');

  if (!isAllowedSrc) {
    redirect('/tools/project-assistant');
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-950">
      <TrackpadZoomFrame
        src={rawSrc}
        title={title}
        isEditMode={isEditMode}
        heightClassName="h-screen"
      />
    </main>
  );
}
