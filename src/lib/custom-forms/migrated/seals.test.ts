import { describe, expect, it } from 'vitest';
import { CHAIRMAN_THRESHOLD, generateApprovalChain, withoutFiler, type ApprovalChainStep } from '@/lib/approval/chain';
import { resolveFlow } from '@/lib/approval/flow/resolve';
import type { OrgSnapshot } from '@/lib/approval/flow/types';
import { parseContractSealInput } from '@/lib/contract-seals/validate';
import { parseGeneralSealInput } from '@/lib/general-seals/validate';
import { parseInvoiceSealInput } from '@/lib/invoice-seals/validate';
import { parseDefinition } from '../definition';
import { withApplicantConfirmation } from '../on-behalf';
import type { FormSchema } from '../schema';
import { validateSubmission } from '../validate';
import { MIGRATION_BATCHES } from '.';
import { CONTRACT_SEAL_FORM, GENERAL_SEAL_FORM, INVOICE_SEAL_FORM, SEAL_FORMS } from './seals';
import type { MigratedForm } from './types';

// Parity checklist for batch 1: the designer definitions accept and reject
// the same submissions as the hard-coded parsers, and resolve the same chain.

const TODAY = '2026-10-13';
const EMP = '22222222-2222-4222-8222-222222222222';

function parsed(form: MigratedForm): { schema: FormSchema; flow: ReturnType<typeof parseDefinition> } {
  const r = parseDefinition(form.schema, form.flow);
  if (!r.ok) throw new Error(`${form.key}: ${r.errors.join('；')}`);
  return { schema: r.schema, flow: r };
}

describe('batch 1 definitions', () => {
  it('parse cleanly, are 代為申請 forms and replace distinct hard-coded forms', () => {
    for (const f of SEAL_FORMS) {
      const { schema } = parsed(f);
      expect(schema.onBehalf).toBe(true);
      expect(f.categoryKey).toBe('seal');
    }
    expect(new Set(SEAL_FORMS.map((f) => f.legacyFormType)).size).toBe(3);
    expect(new Set(SEAL_FORMS.map((f) => f.numberPrefix)).size).toBe(3);
    expect(MIGRATION_BATCHES[1].forms).toBe(SEAL_FORMS);
  });
});

type Case = { name: string; old: Record<string, unknown>; next: Record<string, unknown>; ok: boolean };

function parity(
  label: string,
  form: MigratedForm,
  oldParse: (input: Record<string, unknown>) => { ok: boolean; error?: string },
  oldBase: Record<string, unknown>,
  newBase: Record<string, unknown>,
  cases: Case[]
) {
  describe(`${label}: old parser vs designer definition`, () => {
    const { schema } = parsed(form);
    for (const c of cases) {
      it(c.name, () => {
        const before = oldParse({ ...oldBase, ...c.old });
        const after = validateSubmission(schema, { ...newBase, ...c.next }, TODAY);
        expect({ old: before.ok, error: before.ok ? undefined : before.error }).toMatchObject({ old: c.ok });
        expect({ next: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ next: c.ok });
      });
    }
  });
}

const timingCases = (extraOld: Record<string, unknown> = {}, extraNew: Record<string, unknown> = {}): Case[] => [
  { name: 'accepts a complete form', old: extraOld, next: extraNew, ok: true },
  { name: '一般件 needs two days of lead time', old: { expectedCompletionDate: '2026-10-14' }, next: { expectedCompletionDate: '2026-10-14' }, ok: false },
  {
    name: '急件 may be due tomorrow with a reason',
    old: { urgency: 'urgent', expectedCompletionDate: '2026-10-14', remark: '客戶明天簽約' },
    next: { urgency: 'urgent', expectedCompletionDate: '2026-10-14', urgentReason: '客戶明天簽約' },
    ok: true,
  },
  {
    name: '急件 needs a reason',
    old: { urgency: 'urgent', expectedCompletionDate: '2026-10-14', remark: '無' },
    next: { urgency: 'urgent', expectedCompletionDate: '2026-10-14', urgentReason: '' },
    ok: false,
  },
  {
    name: 'expected date cannot be in the past',
    old: { urgency: 'urgent', expectedCompletionDate: '2026-10-12', remark: '趕件' },
    next: { urgency: 'urgent', expectedCompletionDate: '2026-10-12', urgentReason: '趕件' },
    ok: false,
  },
  { name: 'urgency is required', old: { urgency: '' }, next: { urgency: '' }, ok: false },
  { name: 'at least one seal', old: { seals: [] }, next: { seals: [] }, ok: false },
  { name: 'lending needs an explanation', old: { lendSeal: 'yes', lendSealNote: '無' }, next: { lendSeal: true, lendSealNote: '' }, ok: false },
  {
    name: 'lending with an explanation',
    old: { lendSeal: 'yes', lendSealNote: '借給律師事務所，週五歸還' },
    next: { lendSeal: true, lendSealNote: '借給律師事務所，週五歸還' },
    ok: true,
  },
];

const oldTiming = { applicantEmployeeId: EMP, departmentId: '', urgency: 'normal', expectedCompletionDate: '2026-10-15', remark: '無', lendSeal: 'no', lendSealNote: '無' };
const newTiming = { urgency: 'normal', expectedCompletionDate: '2026-10-15', remark: '', lendSeal: false };

parity(
  '用印申請單(合約類)',
  CONTRACT_SEAL_FORM,
  (i) => parseContractSealInput(i as never, TODAY),
  {
    ...oldTiming,
    documentType: 'contract',
    seals: ['contract_seal'],
    periodStart: '2026-11-01',
    periodEnd: '2026-12-31',
    totalAmount: '50000',
    counterparty: '甲公司',
    subject: '維護合約',
    ndaChecks: ['not_applicable'],
    mouChecks: ['not_applicable'],
    legalReviewConfirmed: true,
  },
  {
    ...newTiming,
    documentType: 'contract',
    seals: ['contract_seal'],
    legalReview: ['confirmed'],
    periodStart: '2026-11-01',
    periodEnd: '2026-12-31',
    totalAmount: '50000',
    counterparty: '甲公司',
    subject: '維護合約',
  },
  [
    ...timingCases(),
    { name: 'contract needs the legal review', old: { legalReviewConfirmed: false }, next: { legalReview: [] }, ok: false },
    { name: 'LOI needs the legal review too', old: { documentType: 'loi', legalReviewConfirmed: false }, next: { documentType: 'loi', legalReview: [] }, ok: false },
    {
      name: 'NDA with every item ticked, no legal review',
      old: { documentType: 'nda', legalReviewConfirmed: false, ndaChecks: ['mutual', 'ip_retained', 'penalty_reviewed'] },
      next: { documentType: 'nda', legalReview: [], ndaChecks: ['mutual', 'ip_retained', 'penalty_reviewed'] },
      ok: true,
    },
    {
      name: 'NDA with an item missing',
      old: { documentType: 'nda', ndaChecks: ['mutual', 'ip_retained'] },
      next: { documentType: 'nda', ndaChecks: ['mutual', 'ip_retained'] },
      ok: false,
    },
    {
      name: 'MOU with both items ticked',
      old: { documentType: 'mou', legalReviewConfirmed: false, mouChecks: ['non_binding', 'amount_range'] },
      next: { documentType: 'mou', mouChecks: ['non_binding', 'amount_range'] },
      ok: true,
    },
    { name: 'MOU with an item missing', old: { documentType: 'mou', mouChecks: ['non_binding'] }, next: { documentType: 'mou', mouChecks: ['non_binding'] }, ok: false },
    { name: 'end date before start date', old: { periodEnd: '2026-10-31' }, next: { periodEnd: '2026-10-31' }, ok: false },
    { name: 'same start and end date', old: { periodEnd: '2026-11-01' }, next: { periodEnd: '2026-11-01' }, ok: true },
    { name: 'amount 0 (no price)', old: { totalAmount: '0' }, next: { totalAmount: '0' }, ok: true },
    { name: 'negative amount', old: { totalAmount: '-1' }, next: { totalAmount: '-1' }, ok: false },
    { name: 'counterparty over 200 characters', old: { counterparty: 'x'.repeat(201) }, next: { counterparty: 'x'.repeat(201) }, ok: false },
    { name: 'subject is required', old: { subject: '' }, next: { subject: '' }, ok: false },
  ]
);

parity(
  '用印申請單(非合約類)',
  GENERAL_SEAL_FORM,
  (i) => parseGeneralSealInput(i as never, TODAY),
  { ...oldTiming, documentType: 'quotation', documentDescription: '報價單一份', seals: ['invoice_seal'] },
  { ...newTiming, documentType: 'quotation', documentDescription: '報價單一份', seals: ['invoice_seal'] },
  [
    ...timingCases(),
    { name: 'document type is required', old: { documentType: '' }, next: { documentType: '' }, ok: false },
    { name: 'description is required', old: { documentDescription: '' }, next: { documentDescription: '' }, ok: false },
    { name: 'unknown seal', old: { seals: ['nope'] }, next: { seals: ['nope'] }, ok: false },
  ]
);

const oldItem = (o: Record<string, unknown> = {}) => ({ itemName: '顧問服務', quantity: '2', currency: 'USD', unitPrice: '100', ...o });
const newRow = (o: Record<string, unknown> = {}) => ({ itemName: '顧問服務', quantity: '2', unitPrice: '100', ...o });

parity(
  '用印申請單(開立發票/Invoice)',
  INVOICE_SEAL_FORM,
  (i) => parseInvoiceSealInput(i as never),
  {
    applicantEmployeeId: EMP,
    departmentId: '',
    invoiceType: 'triplicate',
    seal: 'invoice_seal',
    customerName: '乙公司',
    customerTaxId: '12345678',
    customerAddress: '台北市',
    customerPhone: '02-1234-5678',
    items: [oldItem()],
    totalAmount: '210',
  },
  {
    invoiceType: 'triplicate',
    seal: 'invoice_seal',
    customerName: '乙公司',
    customerTaxId: '12345678',
    customerAddress: '台北市',
    customerPhone: '02-1234-5678',
    currency: 'USD',
    lines: { rows: [newRow()], total: null },
    totalWithTax: '210',
  },
  [
    { name: 'accepts a complete form', old: {}, next: {}, ok: true },
    { name: '三聯式 needs the tax id', old: { customerTaxId: '0' }, next: { customerTaxId: '' }, ok: false },
    { name: 'individuals have no tax id (old: 0, new: blank)', old: { invoiceType: 'duplicate', customerTaxId: '0' }, next: { invoiceType: 'duplicate', customerTaxId: '' }, ok: true },
    { name: 'tax id is 8 digits', old: { customerTaxId: '1234567' }, next: { customerTaxId: '1234567' }, ok: false },
    { name: 'whole quantities only', old: { items: [oldItem({ quantity: '1.5' })] }, next: { lines: { rows: [newRow({ quantity: '1.5' })] } }, ok: false },
    { name: 'quantity above 0', old: { items: [oldItem({ quantity: '0' })] }, next: { lines: { rows: [newRow({ quantity: '0' })] } }, ok: false },
    { name: 'unit price above 0', old: { items: [oldItem({ unitPrice: '0' })] }, next: { lines: { rows: [newRow({ unitPrice: '0' })] } }, ok: false },
    { name: 'total with tax below the untaxed total', old: { totalAmount: '199.99' }, next: { totalWithTax: '199.99' }, ok: false },
    { name: 'total with tax equal to the untaxed total', old: { totalAmount: '200' }, next: { totalWithTax: '200' }, ok: true },
    { name: 'at least one line', old: { items: [] }, next: { lines: { rows: [] } }, ok: false },
    {
      name: `at most ${50} lines`,
      old: { items: Array.from({ length: 51 }, () => oldItem({ unitPrice: '1' })), totalAmount: '200' },
      next: { lines: { rows: Array.from({ length: 51 }, () => newRow({ unitPrice: '1' })) }, totalWithTax: '200' },
      ok: false,
    },
    { name: 'customer phone is required', old: { customerPhone: '' }, next: { customerPhone: '' }, ok: false },
  ]
);

describe('批次 1 approval chains match the hard-coded chain', () => {
  const people = ['P1', 'P2', 'MGR', 'GM', 'CH'];
  const amounts = [0, 1, CHAIRMAN_THRESHOLD, CHAIRMAN_THRESHOLD + 0.01, 250000];

  function org(managerId: string): OrgSnapshot {
    return {
      employees: new Map(people.map((id) => [id, { id, name: id, departmentId: 'D1', active: true }])),
      departments: new Map([['D1', { id: 'D1', name: '部門', parentId: null, managerId, levelCode: null, active: true }]]),
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
      budgetOwners: new Map(),
      assetCustodians: new Map(),
    };
  }

  /** seal-requests/service excludeFiler, on top of generateApprovalChain. */
  function legacyChain(applicant: string, filer: string, manager: string, amount: number): ApprovalChainStep[] | null {
    const chain = generateApprovalChain({
      applicantEmployeeId: applicant,
      departmentManagerEmployeeId: manager,
      budgetOwnerEmployeeId: null,
      generalManagerEmployeeId: 'GM',
      chairmanEmployeeId: amount > CHAIRMAN_THRESHOLD ? 'CH' : applicant,
      totalAmount: amount,
    });
    if (filer === applicant) return chain;
    const rest = withoutFiler(chain, filer);
    if (rest.length === 0) return null;
    return [{ approverEmployeeId: applicant, approverRole: 'applicant_confirmation' }, ...rest];
  }

  const role = (r: string) => (r === 'department_manager' ? 'dept_manager' : r);

  for (const form of SEAL_FORMS) {
    it(form.name, () => {
      const flow = parsed(form).flow;
      if (!flow.ok) throw new Error('unreachable');
      const amountsFor = form === CONTRACT_SEAL_FORM ? amounts : [0];
      let cases = 0;
      for (const applicant of people)
        for (const filer of people)
          for (const manager of people)
            for (const amount of amountsFor) {
              const legacy = legacyChain(applicant, filer, manager, amount);
              const r = resolveFlow(
                flow.flow,
                { applicantEmployeeId: applicant, filerEmployeeId: filer, departmentId: 'D1', formKey: form.key, today: TODAY, fields: { totalAmount: amount.toFixed(2) } },
                org(manager)
              );
              expect(r.ok).toBe(true);
              if (!r.ok) return;
              const steps = withApplicantConfirmation(r.steps, { applicantId: applicant, filerId: filer, editorId: filer });
              const pending = steps?.filter((s) => s.status === 'pending').map((s) => [s.approverEmployeeId, s.blockId]) ?? null;
              expect(pending).toEqual(legacy?.map((s) => [s.approverEmployeeId, role(s.approverRole)]) ?? null);
              cases += 1;
            }
      expect(cases).toBeGreaterThan(100);
    });
  }
});
