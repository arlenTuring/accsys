/**
 * Controlled UI events telling the workspace to open a resource tab.
 * Never derive this from model prose — only from successful tool/action results.
 */

export const OPEN_RESOURCE_TYPES = ['application_draft', 'form_submission', 'draft_library'] as const;
export type OpenResourceType = (typeof OPEN_RESOURCE_TYPES)[number];

export type OpenResourceEvent = {
  /** Discriminator for frontend handlers. */
  type: 'open_resource';
  resourceType: OpenResourceType;
  resourceId: string;
  title: string;
  version?: number;
  /** Outcome of the operation that produced this open event. */
  operation: 'created' | 'updated' | 'opened' | 'submitted';
  formKey?: string;
  status?: string;
};

export function isOpenResourceEvent(v: unknown): v is OpenResourceEvent {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    o.type === 'open_resource' &&
    typeof o.resourceType === 'string' &&
    (OPEN_RESOURCE_TYPES as readonly string[]).includes(o.resourceType) &&
    typeof o.resourceId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(o.resourceId) &&
    typeof o.title === 'string' &&
    o.title.length > 0 &&
    o.title.length <= 160 &&
    (o.operation === 'created' ||
      o.operation === 'updated' ||
      o.operation === 'opened' ||
      o.operation === 'submitted')
  );
}

export function draftOpenResource(input: {
  draftId: string;
  title: string;
  version: number;
  operation: OpenResourceEvent['operation'];
  formKey?: string;
  status?: string;
}): OpenResourceEvent {
  return {
    type: 'open_resource',
    resourceType: 'application_draft',
    resourceId: input.draftId,
    title: input.title.slice(0, 160),
    version: input.version,
    operation: input.operation,
    formKey: input.formKey,
    status: input.status,
  };
}

/** Deduplicate by resourceType+resourceId keeping the last (most recent) event. */
export function mergeOpenResources(events: OpenResourceEvent[]): OpenResourceEvent[] {
  const map = new Map<string, OpenResourceEvent>();
  for (const e of events) {
    map.set(`${e.resourceType}:${e.resourceId}`, e);
  }
  return [...map.values()];
}
