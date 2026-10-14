import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { PdfEditorLoader } from './pdf-editor-loader';

export default async function ToolsPdfEditorPage() {
  if (!(await getCurrentEmployee())) redirect('/login?returnTo=/tools/pdf-editor');
  return <PdfEditorLoader />;
}
