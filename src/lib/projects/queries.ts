import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ProjectListItem = {
  id: string;
  code: string;
  name: string;
};

export async function getProjectList(): Promise<ProjectListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('projects').select('id, code, name').order('code');
  return data ?? [];
}
