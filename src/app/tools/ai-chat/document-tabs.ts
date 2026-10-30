import type { OpenResourceEvent, OpenResourceType } from '@/lib/ai-chat/open-resource';

export type DocTab = {
  tabId: string;
  resourceType: OpenResourceType;
  resourceId: string;
  title: string;
  version?: number;
  formKey?: string;
  status?: string;
  loadState: 'loading' | 'ready' | 'error';
  saveState: 'clean' | 'dirty' | 'saving' | 'error';
  errorMessage?: string;
};

const PREF_KEY = 'accsys.ai.docTabs.v1';

export type DocTabsPref = {
  order: Array<{ resourceType: OpenResourceType; resourceId: string; title: string }>;
  activeKey: string | null;
};

export function tabKey(resourceType: string, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

export function loadDocTabsPref(): DocTabsPref {
  if (typeof window === 'undefined') return { order: [], activeKey: null };
  try {
    const raw = sessionStorage.getItem(PREF_KEY);
    if (!raw) return { order: [], activeKey: null };
    const parsed = JSON.parse(raw) as DocTabsPref;
    if (!parsed || !Array.isArray(parsed.order)) return { order: [], activeKey: null };
    return {
      order: parsed.order
        .filter(
          (t) =>
            t &&
            typeof t.resourceId === 'string' &&
            (t.resourceType === 'application_draft' ||
              t.resourceType === 'form_submission' ||
              t.resourceType === 'draft_library')
        )
        .slice(0, 12),
      activeKey: typeof parsed.activeKey === 'string' ? parsed.activeKey : null,
    };
  } catch {
    return { order: [], activeKey: null };
  }
}

export function saveDocTabsPref(tabs: DocTab[], activeTabId: string | null) {
  if (typeof window === 'undefined') return;
  const pref: DocTabsPref = {
    order: tabs
      .filter((t) => t.resourceType !== 'draft_library')
      .map((t) => ({
        resourceType: t.resourceType,
        resourceId: t.resourceId,
        title: t.title.slice(0, 80),
      })),
    activeKey: activeTabId,
  };
  try {
    sessionStorage.setItem(PREF_KEY, JSON.stringify(pref));
  } catch {
    // ignore quota
  }
}

export function openFromEvent(tabs: DocTab[], event: OpenResourceEvent): {
  tabs: DocTab[];
  activeTabId: string;
} {
  const key = tabKey(event.resourceType, event.resourceId);
  const existing = tabs.find((t) => tabKey(t.resourceType, t.resourceId) === key);
  if (existing) {
    return {
      tabs: tabs.map((t) => {
        if (t.tabId !== existing.tabId) return t;
        const nextVersion =
          typeof event.version === 'number'
            ? typeof t.version === 'number'
              ? Math.max(t.version, event.version)
              : event.version
            : t.version;
        return {
          ...t,
          title: event.title || t.title,
          version: nextVersion,
          formKey: event.formKey ?? t.formKey,
          status: event.status ?? t.status,
        };
      }),
      activeTabId: existing.tabId,
    };
  }
  const tab: DocTab = {
    tabId: key,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    title: event.title,
    version: event.version,
    formKey: event.formKey,
    status: event.status,
    loadState: 'loading',
    saveState: 'clean',
  };
  return { tabs: [...tabs, tab], activeTabId: tab.tabId };
}

export function openDraftLibraryTab(tabs: DocTab[]): { tabs: DocTab[]; activeTabId: string } {
  const existing = tabs.find((t) => t.resourceType === 'draft_library');
  if (existing) return { tabs, activeTabId: existing.tabId };
  const tab: DocTab = {
    tabId: 'draft_library',
    resourceType: 'draft_library',
    resourceId: 'library',
    title: '草稿庫',
    loadState: 'ready',
    saveState: 'clean',
  };
  return { tabs: [...tabs, tab], activeTabId: tab.tabId };
}
