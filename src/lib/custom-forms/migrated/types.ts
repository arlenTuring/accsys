import type { FlowDef } from '@/lib/approval/flow/types';

/** A hard-coded form rebuilt as a designer definition (published by `npm run forms:migrate`). */
export type MigratedForm = {
  key: string;
  name: string;
  description: string;
  categoryKey: string;
  numberPrefix: string;
  sortOrder: number;
  /** form_type of the hard-coded form it replaces. */
  legacyFormType: string;
  /** Raw schema JSON; parseFormSchema checks it on publish (and in the unit tests). */
  schema: { version: 1; onBehalf?: boolean; sections: unknown[] };
  flow: FlowDef;
};
