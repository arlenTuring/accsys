import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  redirect(employee ? '/dashboard' : '/login');
}
