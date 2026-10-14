import { ASSET_TRANSFER_FORM } from './asset-transfer';
import { EXPENSE_CLAIM_FORMS } from './expense-claims';
import { SEAL_FORMS } from './seals';
import { TRAVEL_EXPENSE_FORM } from './travel';
import type { MigratedForm } from './types';

export type { MigratedForm };

/** Migration batches (design doc §9.2), in the order they switch over. */
export const MIGRATION_BATCHES: Record<number, { title: string; forms: MigratedForm[] }> = {
  1: { title: '用印申請（合約類、非合約類、開立發票）', forms: SEAL_FORMS },
  2: { title: '出差報告暨旅費報支單', forms: [TRAVEL_EXPENSE_FORM] },
  3: { title: '費用申請單（部門版、部門版_單筆一萬元以下、產品專案版、營收專案版）', forms: EXPENSE_CLAIM_FORMS },
  4: { title: '資產異動申請單', forms: [ASSET_TRANSFER_FORM] },
};
