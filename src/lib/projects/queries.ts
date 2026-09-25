import { createAppDb } from '@/lib/db/app-client';

export type ProjectListItem = {
  id: string;
  code: string;
  name: string;
};

export async function getProjectList(): Promise<ProjectListItem[]> {
  const supabase = createAppDb();
  const { data } = await supabase.from('projects').select('id, code, name').order('code');
  return (data ?? []) as ProjectListItem[];
}
