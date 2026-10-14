import { describe, expect, it } from 'vitest';
import { parseAssetStatus } from '@/lib/assets/parse-asset-workbook';
import { escalateIfSelfManaged, generateAssetTransferChain, type AssetTransferParties } from './chain';
import { checkCustodianCoverage, parseAssetTransferInput, type AssetTransferInput } from './validate';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [DEPT, BUDGET, ASSET_A, ASSET_B, ALICE, BOB, CAROL, MGR_A, MGR_B] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);

const base = (overrides: Partial<AssetTransferInput> = {}): AssetTransferInput => ({
  departmentId: DEPT,
  useDepartmentId: DEPT,
  useBudgetCodeId: BUDGET,
  transferTypes: ['custodian_change'],
  remark: '',
  items: [{ assetId: ASSET_A, reason: 'custodian_change', newCustodianEmployeeId: BOB, newLocation: '7F 研發區' }],
  originalCustodianEmployeeId: ALICE,
  newCustodianEmployeeId: BOB,
  otherCustodianEmployeeId: '',
  ...overrides,
});

const errorOf = (input: AssetTransferInput) => {
  const r = parseAssetTransferInput(input);
  return r.ok ? null : r.error;
};

describe('parseAssetTransferInput', () => {
  it('normalizes a valid custodian change', () => {
    const r = parseAssetTransferInput(base({ remark: '  交接  ' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.remark).toBe('交接');
    expect(r.value.otherCustodianEmployeeId).toBeNull();
  });

  it('does not take unit managers from the client', () => {
    const r = parseAssetTransferInput({ ...base(), originalManagerEmployeeId: MGR_A } as AssetTransferInput);
    expect(r.ok && 'originalManagerEmployeeId' in r.value).toBe(false);
  });

  it('returns transfer types in canonical order', () => {
    const r = parseAssetTransferInput(
      base({
        transferTypes: ['scrap', 'custodian_change'],
        items: [
          { assetId: ASSET_A, reason: 'custodian_change', newCustodianEmployeeId: BOB, newLocation: 'A' },
          { assetId: ASSET_B, reason: 'scrap', newCustodianEmployeeId: BOB, newLocation: '管理部' },
        ],
      })
    );
    expect(r.ok && r.value.transferTypes).toEqual(['custodian_change', 'scrap']);
  });

  it('requires at least one transfer type', () => {
    expect(errorOf(base({ transferTypes: [] }))).toContain('異動說明');
  });

  it('requires a remark when 其他 is checked', () => {
    const items = [{ assetId: ASSET_A, reason: 'other', newCustodianEmployeeId: BOB, newLocation: 'A' }];
    expect(errorOf(base({ transferTypes: ['other'], items }))).toContain('備註');
    expect(errorOf(base({ transferTypes: ['other'], items, remark: '送修' }))).toBeNull();
  });

  it('rejects a row reason that was not checked', () => {
    const items = [{ assetId: ASSET_A, reason: 'sell', newCustodianEmployeeId: BOB, newLocation: 'A' }];
    expect(errorOf(base({ items }))).toContain('異動原因');
  });

  it('rejects a checked type that no row uses', () => {
    expect(errorOf(base({ transferTypes: ['custodian_change', 'lend'] }))).toContain('借出');
  });

  it('rejects duplicate assets, empty locations and long locations', () => {
    const row = { assetId: ASSET_A, reason: 'custodian_change', newCustodianEmployeeId: BOB, newLocation: 'A' };
    expect(errorOf(base({ items: [row, row] }))).toContain('重複');
    expect(errorOf(base({ items: [{ ...row, newLocation: ' ' }] }))).toContain('新保管地點');
    expect(errorOf(base({ items: [{ ...row, newLocation: 'x'.repeat(31) }] }))).toContain('新保管地點');
  });

  it('requires the custodians', () => {
    expect(errorOf(base({ newCustodianEmployeeId: '' }))).toContain('新保管人');
    expect(errorOf(base({ originalCustodianEmployeeId: '' }))).toContain('原保管人');
  });
});

describe('checkCustodianCoverage', () => {
  const parsed = (overrides: Partial<AssetTransferInput> = {}) => {
    const r = parseAssetTransferInput(base(overrides));
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const tagOf = () => '10003';

  it('passes when the register custodian is the 原保管人', () => {
    expect(checkCustodianCoverage(parsed(), () => ALICE, tagOf)).toBeNull();
  });

  it('fails when the register custodian is not on the form', () => {
    expect(checkCustodianCoverage(parsed(), () => CAROL, tagOf)).toContain('10003');
  });

  it('accepts 其他保管人 on either side', () => {
    const form = parsed({
      otherCustodianEmployeeId: CAROL,
      items: [
        { assetId: ASSET_A, reason: 'custodian_change', newCustodianEmployeeId: BOB, newLocation: 'A' },
        { assetId: ASSET_B, reason: 'custodian_change', newCustodianEmployeeId: CAROL, newLocation: 'B' },
      ],
    });
    const current = (assetId: string) => (assetId === ASSET_A ? CAROL : ALICE);
    expect(checkCustodianCoverage(form, current, tagOf)).toBeNull();
  });

  it('rejects named custodians who are on no row (their manager would stand in for the GM escalation)', () => {
    expect(checkCustodianCoverage(parsed({ otherCustodianEmployeeId: CAROL }), () => ALICE, tagOf)).toContain('其他保管人');
    const viaOther = parsed({
      otherCustodianEmployeeId: CAROL,
      items: [{ assetId: ASSET_A, reason: 'custodian_change', newCustodianEmployeeId: BOB, newLocation: 'A' }],
    });
    expect(checkCustodianCoverage(viaOther, () => CAROL, tagOf)).toContain('原保管人');
    const unusedNew = parsed({
      otherCustodianEmployeeId: CAROL,
      items: [{ assetId: ASSET_A, reason: 'custodian_change', newCustodianEmployeeId: CAROL, newLocation: 'A' }],
    });
    expect(checkCustodianCoverage(unusedNew, () => ALICE, tagOf)).toContain('新保管人');
  });

  it('rejects a row whose new custodian is not on the form', () => {
    const form = parsed({ items: [{ assetId: ASSET_A, reason: 'custodian_change', newCustodianEmployeeId: CAROL, newLocation: 'A' }] });
    expect(checkCustodianCoverage(form, () => ALICE, tagOf)).toContain('新保管人員');
  });
});

describe('generateAssetTransferChain', () => {
  const parties = {
    applicantEmployeeId: CAROL,
    originalCustodianEmployeeId: ALICE,
    newCustodianEmployeeId: BOB,
    otherCustodianEmployeeId: null,
    originalManagerEmployeeId: MGR_A,
    newManagerEmployeeId: MGR_B,
    otherManagerEmployeeId: null,
  };

  it('orders custodians before their managers', () => {
    expect(generateAssetTransferChain(parties).map((s) => s.approverRole)).toEqual([
      'original_custodian',
      'new_custodian',
      'original_custodian_manager',
      'new_custodian_manager',
    ]);
  });

  it('skips the applicant and repeated people', () => {
    const chain = generateAssetTransferChain({
      ...parties,
      applicantEmployeeId: ALICE,
      newCustodianEmployeeId: ALICE,
      newManagerEmployeeId: MGR_A,
    });
    expect(chain).toEqual([{ approverEmployeeId: MGR_A, approverRole: 'original_custodian_manager' }]);
  });
});

describe('escalateIfSelfManaged', () => {
  const [GM, CHAIR] = [10, 11].map(id);
  const top: Parameters<typeof escalateIfSelfManaged>[2] = { generalManagerEmployeeId: GM, chairmanEmployeeId: CHAIR };
  const selfManaged: AssetTransferParties = {
    applicantEmployeeId: MGR_A,
    originalCustodianEmployeeId: MGR_A,
    newCustodianEmployeeId: MGR_A,
    otherCustodianEmployeeId: null,
    originalManagerEmployeeId: MGR_A,
    newManagerEmployeeId: MGR_A,
    otherManagerEmployeeId: null,
  };
  const escalate = (p: typeof selfManaged, t = top) => escalateIfSelfManaged(generateAssetTransferChain(p), p, t);

  it('keeps the chain when an independent unit manager signs', () => {
    const p = { ...selfManaged, newCustodianEmployeeId: BOB, newManagerEmployeeId: MGR_B };
    expect(escalate(p)?.map((s) => s.approverEmployeeId)).toEqual([BOB, MGR_B]);
  });

  it('adds the general manager when the applicant manages every unit (a scrap would otherwise have no signer)', () => {
    expect(escalate(selfManaged)).toEqual([{ approverEmployeeId: GM, approverRole: 'general_manager' }]);
  });

  it('adds the general manager after the custodians', () => {
    const p = { ...selfManaged, newCustodianEmployeeId: BOB };
    expect(escalate(p)?.map((s) => s.approverRole)).toEqual(['new_custodian', 'general_manager']);
  });

  it('falls back to the chairman when the applicant is the general manager', () => {
    const p = { ...selfManaged, applicantEmployeeId: GM, originalCustodianEmployeeId: GM, newCustodianEmployeeId: GM, originalManagerEmployeeId: GM, newManagerEmployeeId: GM };
    expect(escalate(p)).toEqual([{ approverEmployeeId: CHAIR, approverRole: 'chairman' }]);
  });

  it('does not add the general manager twice', () => {
    const p = { ...selfManaged, newCustodianEmployeeId: GM };
    expect(escalate(p)).toEqual([{ approverEmployeeId: GM, approverRole: 'new_custodian' }]);
  });

  it('returns null when nobody independent exists', () => {
    expect(escalate(selfManaged, { generalManagerEmployeeId: MGR_A, chairmanEmployeeId: null })).toBeNull();
  });
});

describe('parseAssetStatus', () => {
  it('accepts labels, codes and blanks', () => {
    expect(parseAssetStatus('出借中')).toBe('lent');
    expect(parseAssetStatus('scrapped')).toBe('scrapped');
    expect(parseAssetStatus('')).toBeNull();
    expect(parseAssetStatus('遺失')).toBe('invalid');
  });
});
