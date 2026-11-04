import { describe, expect, it } from 'vitest';
import { answersToCsv } from '@/lib/surveys/service';

describe('answersToCsv', () => {
  it('prefixes formula-like cells', () => {
    const csv = answersToCsv(
      [{ stableKey: 'note', prompt: '備註' }],
      [
        {
          employeeId: 'e1',
          submittedAt: new Date('2026-01-01T00:00:00Z'),
          answers: { note: '=cmd|' },
        },
      ]
    );
    expect(csv).toContain(`"'=cmd|"`);
  });
});
