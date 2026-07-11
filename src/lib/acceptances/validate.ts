export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateAcceptanceInput(input: {
  items: { passFail: 'pass' | 'fail' }[];
}): ValidationResult {
  if (input.items.length === 0) {
    return { ok: false, error: '驗收單至少需要一個明細項次' };
  }
  return { ok: true };
}
