import { describe, expect, it } from 'vitest';
import { CHAIRMAN_THRESHOLD } from '@/lib/approval/chain';
import { resolveFlow } from '@/lib/approval/flow/resolve';
import type { OrgSnapshot } from '@/lib/approval/flow/types';
import { parseDefinition } from '../definition';
import { validateSubmission } from '../validate';
import { MIGRATION_BATCHES } from '.';
import { BUDGET_CHANGE_FORM, BUDGET_FORMS, BUDGET_REQUEST_FORM } from './budget';
import type { MigratedForm } from './types';

const TODAY = '2026-11-13';
const DEPT_ID = '11111111-1111-4111-8111-111111111111';
const BUDGET_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_BUDGET_ID = '22222222-2222-4222-8222-222222222223';
const EMP_ID = '33333333-3333-4333-8333-333333333333';

function parsed(form: MigratedForm) {
  const r = parseDefinition(form.schema, form.flow);
  if (!r.ok) throw new Error(`${form.key}: ${r.errors.join('；')}`);
  return r;
}

describe('批次 7 預算申請與預算變更 e 化（第 1 條）', () => {
  it('registers budget-request and budget-change in MIGRATION_BATCHES[7]', () => {
    expect(MIGRATION_BATCHES[7].forms).toBe(BUDGET_FORMS);
    expect(BUDGET_FORMS.map((f) => f.key)).toEqual(['budget-request', 'budget-change']);
    expect(BUDGET_FORMS.map((f) => f.numberPrefix)).toEqual(['BA', 'BC']);
    for (const f of BUDGET_FORMS) {
      const def = parsed(f);
      expect(def.schema.onBehalf).toBe(true);
    }
  });

  it('validates 預算申請單 submissions and computes total amount from items table', () => {
    const { schema } = parsed(BUDGET_REQUEST_FORM);
    const valid = validateSubmission(
      schema,
      {
        fiscalYear: '115',
        budgetScope: 'department',
        targetDepartmentId: DEPT_ID,
        ownerEmployeeId: EMP_ID,
        items: {
          rows: [
            { code: 'RD-115-001', category: '設備', description: '車規級固態光達 2 顆', annualBudgetAmount: '85000' },
            { code: 'RD-115-002', category: '勞務費', description: 'GPU 雲端訓練時數', annualBudgetAmount: '45000' },
          ],
          total: null,
        },
      },
      TODAY
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.flowFields.items).toBe('130000.00');
    }

    const missingDept = validateSubmission(
      schema,
      {
        fiscalYear: '115',
        budgetScope: 'department',
        ownerEmployeeId: EMP_ID,
        items: {
          rows: [{ code: 'RD-115-001', category: '雜項購置', description: '辦公雜支', annualBudgetAmount: '20000' }],
          total: null,
        },
      },
      TODAY
    );
    expect(missingDept.ok).toBe(false);
  });

  it('validates 預算變更申請單 submissions and requires sourceBudgetCodeId when reallocating', () => {
    const { schema } = parsed(BUDGET_CHANGE_FORM);
    const increase = validateSubmission(
      schema,
      {
        budgetCodeId: BUDGET_ID,
        changeType: 'increase',
        currentBudgetAmount: '500000',
        changeAmount: '120000',
        newBudgetAmount: '620000',
        reason: '因客戶新增車型測試需求，需追加測試治具與認證費用',
      },
      TODAY
    );
    expect(increase.ok).toBe(true);

    const reallocateMissingSource = validateSubmission(
      schema,
      {
        budgetCodeId: BUDGET_ID,
        changeType: 'reallocate',
        currentBudgetAmount: '500000',
        changeAmount: '50000',
        newBudgetAmount: '550000',
        reason: '跨科目流用',
      },
      TODAY
    );
    expect(reallocateMissingSource.ok).toBe(false);

    const reallocateWithSource = validateSubmission(
      schema,
      {
        budgetCodeId: BUDGET_ID,
        changeType: 'reallocate',
        sourceBudgetCodeId: SOURCE_BUDGET_ID,
        currentBudgetAmount: '500000',
        changeAmount: '50000',
        newBudgetAmount: '550000',
        reason: '跨科目流用',
      },
      TODAY
    );
    expect(reallocateWithSource.ok).toBe(true);
  });

  it('routes both budget forms through standard approval chain (dept_manager -> budget_owner -> GM -> >100k Chairman)', () => {
    const org: OrgSnapshot = {
      employees: new Map(
        ['APP', 'MGR', 'BO', 'GM', 'CH'].map((id) => [id, { id, name: id, departmentId: 'D1', active: true }])
      ),
      departments: new Map([['D1', { id: 'D1', name: '研發部', parentId: null, managerId: 'MGR', levelCode: null, active: true }]]),
      levels: new Map(),
      jobRoles: new Map([
        ['general_manager', { name: '總經理', active: true }],
        ['chairman', { name: '董事長', active: true }],
      ]),
      jobRoleBindings: [
        { jobRole: 'general_manager', departmentId: null, employeeId: 'GM', isPrimary: true },
        { jobRole: 'chairman', departmentId: null, employeeId: 'CH', isPrimary: true },
      ],
      groups: new Map(),
      delegations: [],
      budgetOwners: new Map([[BUDGET_ID, 'BO']]),
      assetCustodians: new Map(),
    };

    const reqDef = parsed(BUDGET_REQUEST_FORM);
    const under100k = resolveFlow(
      reqDef.flow,
      {
        applicantEmployeeId: 'APP',
        filerEmployeeId: 'APP',
        departmentId: 'D1',
        formKey: BUDGET_REQUEST_FORM.key,
        today: TODAY,
        fields: { ownerEmployeeId: 'BO', items: CHAIRMAN_THRESHOLD },
      },
      org
    );
    expect(under100k.ok).toBe(true);
    if (under100k.ok) {
      expect(under100k.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual(['MGR', 'BO', 'GM']);
    }

    const over100k = resolveFlow(
      reqDef.flow,
      {
        applicantEmployeeId: 'APP',
        filerEmployeeId: 'APP',
        departmentId: 'D1',
        formKey: BUDGET_REQUEST_FORM.key,
        today: TODAY,
        fields: { ownerEmployeeId: 'BO', items: CHAIRMAN_THRESHOLD + 1 },
      },
      org
    );
    expect(over100k.ok).toBe(true);
    if (over100k.ok) {
      expect(over100k.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual(['MGR', 'BO', 'GM', 'CH']);
    }

    const chgDef = parsed(BUDGET_CHANGE_FORM);
    const chgOver100k = resolveFlow(
      chgDef.flow,
      {
        applicantEmployeeId: 'APP',
        filerEmployeeId: 'APP',
        departmentId: 'D1',
        formKey: BUDGET_CHANGE_FORM.key,
        today: TODAY,
        fields: { budgetCodeId: BUDGET_ID, changeAmount: CHAIRMAN_THRESHOLD + 50000 },
      },
      org
    );
    expect(chgOver100k.ok).toBe(true);
    if (chgOver100k.ok) {
      expect(chgOver100k.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual(['MGR', 'BO', 'GM', 'CH']);
    }
  });
});
