import { CHAIRMAN_THRESHOLD } from '../chain';
import type { FlowDef } from './types';

/**
 * The hard-coded standard chain (申請單位主管 → 預算負責人 → 總經理 → 董事長
 * above NT$100,000) expressed as a flow. Used as the starting template when
 * existing forms move to configurable flows; equivalence with
 * generateApprovalChain is covered by tests.
 */
export function standardFlow(opts: { amountField: string; budgetField?: string }): FlowDef {
  return {
    version: 1,
    options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'auto_approve' },
    blocks: [
      {
        id: 'dept_manager',
        type: 'approver',
        label: '申請單位主管',
        source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 },
        onUnresolved: 'block',
      },
      ...(opts.budgetField
        ? [
            {
              id: 'budget_owner',
              type: 'approver' as const,
              label: '預算負責人',
              source: { kind: 'form_party' as const, party: 'budget_owner' as const, fieldId: opts.budgetField },
              onUnresolved: 'block' as const,
            },
          ]
        : []),
      {
        id: 'general_manager',
        type: 'approver',
        label: '總經理',
        source: { kind: 'job_role', jobRole: 'general_manager', scope: 'company' },
        onUnresolved: 'block',
      },
      {
        id: 'amount_check',
        type: 'condition',
        label: '金額',
        branches: [
          {
            id: 'over_threshold',
            label: `合計超過 ${CHAIRMAN_THRESHOLD.toLocaleString('en-US')} 元`,
            when: { field: opts.amountField, op: 'gt', value: CHAIRMAN_THRESHOLD },
            blocks: [
              {
                id: 'chairman',
                type: 'approver',
                label: '董事長',
                source: { kind: 'job_role', jobRole: 'chairman', scope: 'company' },
                onUnresolved: 'block',
              },
            ],
          },
        ],
        otherwise: { label: '其他', blocks: [] },
      },
    ],
  };
}
