import { hitRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const AI_CHAT_RATE_LIMITS = {
  ...RATE_LIMITS,
  aiChatMessagePerEmployee: { limit: 40, windowSeconds: 600 },
  aiChatInboxPerEmployee: { limit: 60, windowSeconds: 600 },
} as const;

/** Process-local concurrency guard (one in-flight model turn per employee). */
const inFlight = new Set<string>();

export function tryAcquireEmployeeTurn(employeeId: string): boolean {
  if (inFlight.has(employeeId)) return false;
  inFlight.add(employeeId);
  return true;
}

export function releaseEmployeeTurn(employeeId: string): void {
  inFlight.delete(employeeId);
}

export async function assertAiChatMessageRate(employeeId: string): Promise<void> {
  const { allowed } = await hitRateLimit(
    `ai-chat:msg:${employeeId}`,
    AI_CHAT_RATE_LIMITS.aiChatMessagePerEmployee
  );
  if (!allowed) {
    throw new Error('rate_limited');
  }
}
