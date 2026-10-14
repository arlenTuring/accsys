import { describe, expect, it } from 'vitest';
import { resolveFlow } from '@/lib/approval/flow/resolve';
import type { OrgSnapshot } from '@/lib/approval/flow/types';
import { escalateIfSelfManaged, generateAssetTransferChain, type AssetTransferParties } from '@/lib/asset-transfers/chain';
import { MAX_ASSET_TRANSFER_LINES } from '@/lib/asset-transfers/constants';
import { parseAssetTransferInput, type AssetTransferInput, type AssetTransferItemInput } from '@/lib/asset-transfers/validate';
import { parseDefinition } from '../definition';
import { validateSubmission, type TableValue } from '../validate';
import { MIGRATION_BATCHES } from '.';
import { ASSET_TRANSFER_FORM } from './asset-transfer';

// Parity checklist for batch 4: the designer definition accepts and rejects
// the same submissions as parseAssetTransferInput, and resolves the same
// chain as generateAssetTransferChain + escalateIfSelfManaged. Register checks
// (custodian coverage, busy assets) run in the shared server module and are
// covered by the integration test.

const TODAY = '2026-10-14';
const DEPT = '11111111-1111-4111-8111-111111111111';
const BUDGET = '22222222-2222-4222-8222-222222222222';
const asset = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P1 = '33333333-3333-4333-8333-333333333331';
const P2 = '33333333-3333-4333-8333-333333333332';
const P3 = '33333333-3333-4333-8333-333333333333';

function definition() {
  const r = parseDefinition(ASSET_TRANSFER_FORM.schema, ASSET_TRANSFER_FORM.flow);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r;
}

type Patch = Partial<Omit<AssetTransferInput, 'items'>> & { items?: Partial<AssetTransferItemInput>[] };

function oldInput(p: Patch = {}): AssetTransferInput {
  const { items, ...header } = p;
  return {
    departmentId: DEPT,
    useDepartmentId: DEPT,
    useBudgetCodeId: BUDGET,
    transferTypes: ['custodian_change'],
    remark: '',
    items: (items ?? [{}]).map((i, n) => ({ assetId: asset(n + 1), reason: 'custodian_change', newCustodianEmployeeId: P2, newLocation: '總部 3F', ...i })),
    originalCustodianEmployeeId: P1,
    newCustodianEmployeeId: P2,
    otherCustodianEmployeeId: '',
    ...header,
  };
}

/** Same submission as the designer form sends it. */
function newInput(p: Patch = {}): Record<string, unknown> {
  const o = oldInput(p);
  return {
    useDepartmentId: o.useDepartmentId,
    useBudgetCodeId: o.useBudgetCodeId,
    transferTypes: o.transferTypes,
    remark: o.remark,
    items: { rows: o.items, total: null },
    originalCustodianEmployeeId: o.originalCustodianEmployeeId,
    newCustodianEmployeeId: o.newCustodianEmployeeId,
    otherCustodianEmployeeId: o.otherCustodianEmployeeId,
  };
}

describe('批次 4 asset transfer definition', () => {
  it('is batch 4, replaces asset_transfer and parses', () => {
    expect(MIGRATION_BATCHES[4].forms.map((f) => f.legacyFormType)).toEqual(['asset_transfer']);
    const r = definition();
    expect(r.schema.assetRegister).toEqual(ASSET_TRANSFER_FORM.schema.assetRegister);
  });

  const many = (n: number) => Array.from({ length: n }, () => ({}));
  const cases: { name: string; patch: Patch; ok: boolean }[] = [
    { name: 'one row', patch: {}, ok: true },
    { name: 'several types, one row each', patch: { transferTypes: ['lend', 'scrap'], items: [{ reason: 'lend' }, { reason: 'scrap' }] }, ok: true },
    { name: 'other custodian named', patch: { otherCustodianEmployeeId: P3 }, ok: true },
    { name: 'no type ticked', patch: { transferTypes: [], items: [{ reason: '' }] }, ok: false },
    { name: 'other without remark', patch: { transferTypes: ['other'], items: [{ reason: 'other' }] }, ok: false },
    { name: 'other with remark', patch: { transferTypes: ['other'], remark: '移至實驗室', items: [{ reason: 'other' }] }, ok: true },
    { name: 'remark over 1000', patch: { remark: 'x'.repeat(1001) }, ok: false },
    { name: 'remark of 1000', patch: { remark: 'x'.repeat(1000) }, ok: true },
    { name: 'no rows', patch: { items: [] }, ok: false },
    { name: `${MAX_ASSET_TRANSFER_LINES} rows`, patch: { items: many(MAX_ASSET_TRANSFER_LINES) }, ok: true },
    { name: `${MAX_ASSET_TRANSFER_LINES + 1} rows`, patch: { items: many(MAX_ASSET_TRANSFER_LINES + 1) }, ok: false },
    { name: 'same asset twice', patch: { items: [{}, { assetId: asset(1) }] }, ok: false },
    { name: 'reason not ticked', patch: { items: [{ reason: 'scrap' }] }, ok: false },
    { name: 'ticked type unused', patch: { transferTypes: ['custodian_change', 'lend'] }, ok: false },
    { name: 'unknown reason', patch: { items: [{ reason: 'burn' }] }, ok: false },
    { name: 'no asset', patch: { items: [{ assetId: '' }] }, ok: false },
    { name: 'no new custodian on row', patch: { items: [{ newCustodianEmployeeId: '' }] }, ok: false },
    { name: 'no location', patch: { items: [{ newLocation: '  ' }] }, ok: false },
    { name: 'location of 30', patch: { items: [{ newLocation: '地'.repeat(30) }] }, ok: true },
    { name: 'location over 30', patch: { items: [{ newLocation: '地'.repeat(31) }] }, ok: false },
    { name: 'no original custodian', patch: { originalCustodianEmployeeId: '' }, ok: false },
    { name: 'no new custodian', patch: { newCustodianEmployeeId: '' }, ok: false },
    { name: 'no use department', patch: { useDepartmentId: '' }, ok: false },
    { name: 'no project / customer', patch: { useBudgetCodeId: '' }, ok: false },
  ];

  for (const c of cases) {
    it(`${c.name}: ${c.ok ? 'accepted' : 'rejected'} by both`, () => {
      const r = definition();
      const before = parseAssetTransferInput(oldInput(c.patch));
      const after = validateSubmission(r.schema, newInput(c.patch), TODAY);
      expect({ old: before.ok, error: before.ok ? undefined : before.error }).toMatchObject({ old: c.ok });
      expect({ next: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ next: c.ok });
      if (before.ok && after.ok) {
        const rows = (after.value.data.items as TableValue).rows;
        expect(rows.map((row) => [row.assetId, row.reason, row.newCustodianEmployeeId, row.newLocation])).toEqual(
          before.value.items.map((i) => [i.assetId, i.reason, i.newCustodianEmployeeId, i.newLocation])
        );
        expect(after.value.refs.assets).toEqual(before.value.items.map((i) => i.assetId));
        expect(after.value.data.otherCustodianEmployeeId ?? null).toBe(before.value.otherCustodianEmployeeId);
      }
    });
  }

  it('rejects a malformed asset id up front (the old form only failed at the register lookup)', () => {
    const after = validateSubmission(definition().schema, newInput({ items: [{ assetId: 'A-001' }] }), TODAY);
    expect(after.ok).toBe(false);
  });

  it('names the unused ticked type and the duplicate row', () => {
    const r = definition();
    const unused = validateSubmission(r.schema, newInput({ transferTypes: ['custodian_change', 'lend'] }), TODAY);
    expect(unused.ok ? '' : unused.errors.items).toContain('已勾選「借出」');
    const twice = validateSubmission(r.schema, newInput({ items: [{}, { assetId: asset(1) }] }), TODAY);
    expect(twice.ok ? '' : twice.errors['items.1.assetId']).toContain('與第 1 列重複');
  });
});

describe('批次 4 approval chain matches generateAssetTransferChain + escalation', () => {
  const ROLE_TO_BLOCK: Record<string, string> = {
    original_custodian: 'original_custodian',
    new_custodian: 'new_custodian',
    other_custodian: 'other_custodian',
    original_custodian_manager: 'original_manager',
    new_custodian_manager: 'new_manager',
    other_custodian_manager: 'other_manager',
    general_manager: 'general_manager',
    chairman: 'chairman',
  };
  const people = ['A', 'B', 'C', 'GM', 'CH'];
  /** A and B in DA, C in DC, GM and CH in DG. */
  const deptOf: Record<string, string> = { A: 'DA', B: 'DA', C: 'DC', GM: 'DG', CH: 'DG' };

  function org(managers: Record<string, string>, top: { gm: boolean; ch: boolean }): OrgSnapshot {
    return {
      employees: new Map(people.map((id) => [id, { id, name: id, departmentId: deptOf[id], active: true }])),
      departments: new Map(
        ['DA', 'DC', 'DG'].map((d) => [d, { id: d, name: d, parentId: null, managerId: managers[d], levelCode: null, active: true }])
      ),
      levels: new Map(),
      jobRoles: new Map([
        ['general_manager', { name: '總經理', active: true }],
        ['chairman', { name: '董事長', active: true }],
      ]),
      jobRoleBindings: [
        ...(top.gm ? [{ jobRole: 'general_manager', departmentId: null, employeeId: 'GM', isPrimary: true }] : []),
        ...(top.ch ? [{ jobRole: 'chairman', departmentId: null, employeeId: 'CH', isPrimary: true }] : []),
      ],
      groups: new Map(),
      delegations: [],
      budgetOwners: new Map(),
      assetCustodians: new Map(),
    };
  }

  it('every applicant, custodian, unit manager and 總經理／董事長 setup', () => {
    const r = definition();
    let cases = 0;
    let refused = 0;
    for (const managers of [
      { DA: 'A', DC: 'C', DG: 'GM' },
      { DA: 'B', DC: 'A', DG: 'GM' },
      { DA: 'GM', DC: 'C', DG: 'CH' },
      { DA: 'A', DC: 'A', DG: 'A' },
    ])
      for (const top of [
        { gm: true, ch: true },
        { gm: false, ch: true },
        { gm: true, ch: false },
        { gm: false, ch: false },
      ])
        for (const applicant of people)
          for (const original of people)
            for (const next of people)
              for (const other of [null, ...people]) {
                const parties: AssetTransferParties = {
                  applicantEmployeeId: applicant,
                  originalCustodianEmployeeId: original,
                  newCustodianEmployeeId: next,
                  otherCustodianEmployeeId: other,
                  originalManagerEmployeeId: managers[deptOf[original] as 'DA'],
                  newManagerEmployeeId: managers[deptOf[next] as 'DA'],
                  otherManagerEmployeeId: other ? managers[deptOf[other] as 'DA'] : null,
                };
                const legacy = escalateIfSelfManaged(generateAssetTransferChain(parties), parties, {
                  generalManagerEmployeeId: top.gm ? 'GM' : null,
                  chairmanEmployeeId: top.ch ? 'CH' : null,
                });
                const resolved = resolveFlow(
                  r.flow,
                  {
                    applicantEmployeeId: applicant,
                    filerEmployeeId: applicant,
                    departmentId: deptOf[applicant],
                    formKey: ASSET_TRANSFER_FORM.key,
                    today: TODAY,
                    fields: { originalCustodianEmployeeId: original, newCustodianEmployeeId: next, otherCustodianEmployeeId: other },
                  },
                  org(managers, top)
                );
                const legacyRefused = legacy === null || legacy.length === 0;
                expect({ applicant, original, next, other, managers, top, refused: !resolved.ok }).toEqual({
                  applicant,
                  original,
                  next,
                  other,
                  managers,
                  top,
                  refused: legacyRefused,
                });
                if (resolved.ok && legacy) {
                  const pending = resolved.steps.filter((s) => s.status === 'pending').map((s) => [s.approverEmployeeId, s.blockId]);
                  expect(pending).toEqual(legacy.map((s) => [s.approverEmployeeId, ROLE_TO_BLOCK[s.approverRole]]));
                } else {
                  refused += 1;
                }
                cases += 1;
              }
    expect(cases).toBe(4 * 4 * people.length ** 3 * (people.length + 1));
    expect(refused).toBeGreaterThan(0);
  });
});
