import { describe, expect, it } from 'vitest';
import { dedupeDraftReferenceBlocks, sanitizeBlocks, type AiMessageBlock } from './blocks';

describe('sanitizeBlocks', () => {
  const conv = '11111111-1111-4111-8111-111111111111';
  const draftA = '22222222-2222-4222-8222-222222222222';
  const draftB = '33333333-3333-4333-8333-333333333333';

  it('keeps valid choice blocks and drops HTML/script payloads', () => {
    const blocks = sanitizeBlocks(
      [
        {
          kind: 'choice',
          id: 'c1',
          prompt: '選表單',
          options: [
            { id: 'a', label: '費用', value: 'department-expense' },
            { id: 'b', label: '<script>', value: 'x' },
          ],
          conversationId: conv,
        },
        { kind: 'text', id: 't1', text: '<img onerror=alert(1)>' },
        { kind: 'evil', id: 'e1', html: '<b>no</b>' },
      ],
      conv
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'choice', prompt: '選表單' });
    expect(blocks[1]).toMatchObject({ kind: 'text' });
  });

  it('rejects invalid draft references', () => {
    const blocks = sanitizeBlocks(
      [{ kind: 'draft_reference', id: 'd1', draftId: 'not-uuid', formKey: 'x', formName: 'y', version: 1, status: 'draft' }],
      conv
    );
    expect(blocks).toHaveLength(0);
  });

  it('keeps one draft_reference per draftId with the latest version', () => {
    const blocks = sanitizeBlocks(
      [
        {
          kind: 'draft_reference',
          id: 'd_v1',
          draftId: draftA,
          formKey: 'travel-expense',
          formName: '出差報告暨旅費報支單',
          version: 1,
          status: 'draft',
        },
        {
          kind: 'action_result',
          id: 'ar1',
          action: 'create_application_draft',
          ok: true,
          message: '已建立',
        },
        {
          kind: 'draft_reference',
          id: 'd_v2',
          draftId: draftA,
          formKey: 'travel-expense',
          formName: '出差報告暨旅費報支單',
          version: 2,
          status: 'draft',
        },
      ],
      conv
    );
    const refs = blocks.filter((b) => b.kind === 'draft_reference');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ draftId: draftA, version: 2 });
    expect(blocks.some((b) => b.kind === 'action_result')).toBe(true);
  });

  it('keeps separate cards for different draftIds with the same name', () => {
    const blocks = sanitizeBlocks(
      [
        {
          kind: 'draft_reference',
          id: 'a',
          draftId: draftA,
          formKey: 'travel-expense',
          formName: '出差報告暨旅費報支單',
          version: 1,
          status: 'draft',
        },
        {
          kind: 'draft_reference',
          id: 'b',
          draftId: draftB,
          formKey: 'travel-expense',
          formName: '出差報告暨旅費報支單',
          version: 1,
          status: 'draft',
        },
      ],
      conv
    );
    expect(blocks.filter((b) => b.kind === 'draft_reference')).toHaveLength(2);
  });
});

describe('dedupeDraftReferenceBlocks', () => {
  const draftA = '22222222-2222-4222-8222-222222222222';

  it('is idempotent for already-unique lists', () => {
    const blocks: AiMessageBlock[] = [
      {
        kind: 'draft_reference',
        id: 'd1',
        draftId: draftA,
        formKey: 'travel-expense',
        formName: '報支',
        version: 3,
        status: 'draft',
      },
    ];
    expect(dedupeDraftReferenceBlocks(blocks)).toEqual(blocks);
  });
});
