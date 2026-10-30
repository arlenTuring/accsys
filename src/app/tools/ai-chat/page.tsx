import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { AiChatApp } from './ai-chat-app';

export default async function ToolsAiAssistantPage() {
  if (!(await getCurrentEmployee())) redirect('/login?returnTo=/tools/ai-chat');
  return <AiChatApp />;
}
