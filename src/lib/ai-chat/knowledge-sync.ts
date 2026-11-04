import { invalidateAiCatalogCache } from '@/lib/ai-chat/draft-work';

export type AiKnowledgeDomain =
  | 'forms'
  | 'announcements'
  | 'surveys'
  | 'regulations'
  | 'assets';

type SyncSnapshot = {
  version: number;
  lastUpdatedAt: number;
  lastDomain: AiKnowledgeDomain | 'init';
  lastReason: string;
};

const state: SyncSnapshot = {
  version: 1,
  lastUpdatedAt: Date.now(),
  lastDomain: 'init',
  lastReason: 'boot',
};

const domainListeners = new Set<(snapshot: SyncSnapshot) => void>();

/**
 * Event-driven synchronization hook called whenever an admin publishes or updates:
 * - Designer forms or field definitions
 * - Company announcements
 * - Internal surveys
 * - Company regulations / policies
 * - Asset custom field definitions
 *
 * Immediately invalidates in-memory AI catalog & regulation caches so the very next
 * employee turn sees the newly published schema/policy without polling or stale cache.
 */
export function notifyAiKnowledgeUpdated(domain: AiKnowledgeDomain, reason = 'updated'): SyncSnapshot {
  state.version += 1;
  state.lastUpdatedAt = Date.now();
  state.lastDomain = domain;
  state.lastReason = reason;

  try {
    invalidateAiCatalogCache();
  } catch {
    // ignore
  }

  for (const fn of domainListeners) {
    try {
      fn({ ...state });
    } catch {
      // ignore listener errors
    }
  }

  return { ...state };
}

export function getAiKnowledgeSyncSnapshot(): SyncSnapshot {
  return { ...state };
}

export function onAiKnowledgeUpdated(listener: (snapshot: SyncSnapshot) => void): () => void {
  domainListeners.add(listener);
  return () => domainListeners.delete(listener);
}
