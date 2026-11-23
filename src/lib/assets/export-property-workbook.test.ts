import { describe, expect, it } from 'vitest';
import { buildPropertyRegisterWorkbookBuffer } from '@/lib/assets/export-property-workbook';
import { PROPERTY_REGISTER_COLUMNS } from '@/lib/assets/field-catalog';
import { parsePropertyRegisterWorkbook } from '@/lib/assets/parse-property-workbook';
import type { RegisterRow } from '@/lib/assets/queries';

describe('buildPropertyRegisterWorkbookBuffer (第 33、34、35 條)', () => {
  const sampleRow: RegisterRow = {
    id: '00000000-0000-0000-0000-000000000101',
    tag: 'TD-IT-0054-01',
    name: 'MacBook Pro 16 吋研發筆電',
    quantity: 1,
    custodianEmployeeId: 'f7991f3d-47cc-4e58-9046-ac6e8d8db9de',
    custodianName: '阮振瑋',
    custodianDepartment: '自動駕駛系統部',
    custodyDepartmentId: 'dece5491-3f24-4596-a7b3-faf0397bdfaf',
    custodyDepartmentName: '自動駕駛系統部',
    location: '台北辦公室 3F 自動駕駛系統部',
    status: 'in_custody',
    remark: '主力研發機',
    itemKind: '電腦設備',
    description: 'Apple M3 Max / 64GB / 2TB',
    unit: '台',
    accountingSubject: '生財器具',
    acquiredOn: '2024-05-20',
    voucherNo: '1130520001',
    projectLabel: 'TD2601',
    tagAffixed: 'V',
    disposalVoucherNo: '',
    changeRequest: '',
    physicalQuantity: 1,
    invMatchesBooks: 'V',
    invIdleDisposable: 'X',
    invUnusableScrap: 'X',
    invDispositionNote: '正常使用中',
    inventoryConfirmStage: 'reviewer_confirmed',
    custodianConfirmedAt: '2026-11-13T08:00:00.000Z',
    custodianConfirmedById: 'f7991f3d-47cc-4e58-9046-ac6e8d8db9de',
    custodianConfirmedByName: '阮振瑋',
    custodianConfirmedStatus: 'in_custody',
    reviewerConfirmedAt: '2026-11-13T09:00:00.000Z',
    reviewerConfirmedById: '1fa988cf-1112-48d0-83ff-b632707478e0',
    reviewerConfirmedByName: '許雲茹',
    reviewerNote: '盤點核對無誤',
    updatedAt: new Date('2026-11-13T09:00:00.000Z'),
  };

  it('exports all 23 Excel columns + 4 two-stage confirmation columns and round-trips through parsePropertyRegisterWorkbook', async () => {
    const buffer = await buildPropertyRegisterWorkbookBuffer([sampleRow], {
      scopeLabel: '全公司財產清冊',
      exportedBy: '許雲茹',
    });
    expect(buffer.byteLength).toBeGreaterThan(1000);

    const parsed = await parsePropertyRegisterWorkbook(buffer);
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0]!;
    expect(row.tag).toBe('TD-IT-0054-01');
    expect(row.core.name).toBe('MacBook Pro 16 吋研發筆電');
    expect(row.core.itemKind).toBe('電腦設備');
    expect(row.core.description).toBe('Apple M3 Max / 64GB / 2TB');
    expect(row.core.quantity).toBe(1);
    expect(row.core.unit).toBe('台');
    expect(row.core.custodyDepartmentLabel).toBe('自動駕駛系統部');
    expect(row.core.custodianLabel).toBe('阮振瑋');
    expect(row.core.location).toBe('台北辦公室 3F 自動駕駛系統部');
    expect(row.core.remark).toBe('主力研發機');
    expect(row.assetFields.accounting_subject).toBe('生財器具');
    expect(row.assetFields.acquired_on).toBe('2024-05-20');
    expect(row.assetFields.voucher_no).toBe('1130520001');
    expect(row.assetFields.project_label).toBe('TD2601');
    expect(row.assetFields.tag_affixed).toBe('yes');
    expect(row.inventory.physicalQuantity).toBe(1);
    expect(row.inventory.answers.inv_matches_books).toBe('yes');
    expect(row.inventory.answers.inv_idle_disposable).toBe('no');
    expect(row.inventory.answers.inv_unusable_scrap).toBe('no');
    expect(row.inventory.answers.inv_disposition_note).toBe('正常使用中');
    expect(PROPERTY_REGISTER_COLUMNS).toHaveLength(23);
  });
});
