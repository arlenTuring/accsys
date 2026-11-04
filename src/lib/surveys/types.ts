export type QuestionType =
  | 'single_choice'
  | 'multi_choice'
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'rating';

export type SurveyQuestionInput = {
  stableKey: string;
  prompt: string;
  help?: string;
  questionType: QuestionType;
  required?: boolean;
  sortOrder?: number;
  options?: Array<{ id: string; label: string }>;
};

/** Allocate next unused qN stable key for a survey. */
export function nextStableKey(existing: string[]): string {
  let n = 1;
  const used = new Set(existing);
  while (used.has(`q${n}`)) n += 1;
  return `q${n}`;
}
