import { notFound, redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getNewFormContext } from '@/lib/custom-forms/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { CustomForm } from '../../custom-form';

export default async function NewDesignerFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  const { key } = await params;
  const { source } = await searchParams;
  if (!(await getCurrentEmployee())) redirect(`/login?returnTo=/f/${encodeURIComponent(key)}/new`);
  const ctx = await getNewFormContext(key);
  if (!ctx) notFound();
  return (
    <main className="page-shell">
      <CustomForm
        formKey={ctx.key}
        name={ctx.name}
        description={ctx.description}
        schema={ctx.schema}
        options={ctx.options}
        today={taipeiToday()}
        mode={{ kind: 'create' }}
        currentEmployeeId={ctx.currentEmployeeId}
        presetSource={typeof source === 'string' ? source : undefined}
      />
    </main>
  );
}
