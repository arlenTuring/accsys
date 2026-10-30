import { describe, expect, it } from 'vitest';
import { draftOpenResource, isOpenResourceEvent, mergeOpenResources } from './open-resource';

describe('open-resource', () => {
  it('accepts controlled open_resource payloads', () => {
    const ev = draftOpenResource({
      draftId: '11111111-1111-4111-8111-111111111111',
      title: '出差報支',
      version: 1,
      operation: 'created',
      formKey: 'travel-expense',
      status: 'draft',
    });
    expect(isOpenResourceEvent(ev)).toBe(true);
    expect(ev.resourceType).toBe('application_draft');
    expect(ev.resourceId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects guessing from prose-shaped objects', () => {
    expect(isOpenResourceEvent({ type: 'open_resource', message: '草稿已建立' })).toBe(false);
    expect(
      isOpenResourceEvent({
        type: 'open_resource',
        resourceType: 'application_draft',
        resourceId: 'not-a-uuid',
        title: 'x',
        operation: 'created',
      })
    ).toBe(false);
  });

  it('merges duplicate resources keeping the last event', () => {
    const a = draftOpenResource({
      draftId: '11111111-1111-4111-8111-111111111111',
      title: 'A',
      version: 1,
      operation: 'created',
    });
    const b = draftOpenResource({
      draftId: '11111111-1111-4111-8111-111111111111',
      title: 'B',
      version: 2,
      operation: 'updated',
    });
    const merged = mergeOpenResources([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.version).toBe(2);
    expect(merged[0]?.operation).toBe('updated');
  });
});
