import { notFound } from 'next/navigation';
import { getDesignerData } from '@/lib/form-builder/queries';
import { DesignerRoot } from './designer';

export default async function FormDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDesignerData(id);
  if (!data) notFound();
  return <DesignerRoot data={data} />;
}
