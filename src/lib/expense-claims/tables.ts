import {
  departmentExpenseItems,
  departmentExpenses,
  minorExpenseItems,
  minorExpenses,
  projectExpenseItems,
  projectExpenses,
  revenueExpenseItems,
  revenueExpenses,
} from '@/lib/db/schema';
import type { ExpenseEdition } from '@/lib/expense-claims/editions';

type HeaderTable = typeof departmentExpenses;
type ItemsTable = typeof departmentExpenseItems;

// Every pair comes from expenseClaimTables() in schema.ts: same columns, only the SQL table names differ,
// so the other pairs can be typed as the department ones.
const as = (header: unknown, items: unknown) => ({ header: header as HeaderTable, items: items as ItemsTable });

export const CLAIM_TABLES: Record<ExpenseEdition, { header: HeaderTable; items: ItemsTable }> = {
  department: { header: departmentExpenses, items: departmentExpenseItems },
  project: as(projectExpenses, projectExpenseItems),
  revenue: as(revenueExpenses, revenueExpenseItems),
  minor: as(minorExpenses, minorExpenseItems),
};
