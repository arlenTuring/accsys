import { createAppDb } from '@/lib/db/app-client';
import type { ProjectKind } from '@/lib/expense-claims/editions';

export type ProjectListItem = {
  id: string;
  code: string;
  name: string;
  kind: ProjectKind;
};

export async function getProjectList(): Promise<ProjectListItem[]> {
  const supabase = createAppDb();
  const { data } = await supabase.from('projects').select('id, code, name, kind').order('code');
  return (data ?? []) as ProjectListItem[];
}
