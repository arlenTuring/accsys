import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function HomePage() {
  const employee = await getCurrentEmployee();
  redirect(employee ? '/tools/ai-chat' : '/login');
}
