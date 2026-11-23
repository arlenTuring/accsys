import { describe, expect, it } from 'vitest';
import { parseFilingAgent } from '@/lib/admin/org/validate';
import { deriveDraftTitle } from '@/lib/form-drafts/service';

describe('Common Form Features (Part 3: 表單共通功能)', () => {
  const empA = '11111111-1111-4111-8111-111111111111';
  const empB = '22222222-2222-4222-8222-222222222222';
  const deptX = '33333333-3333-4333-8333-333333333333';

  describe('parseFilingAgent (第 18 條：經辦人設定)', () => {
    it('accepts assigning an employee as filing agent for another employee', () => {
      const res = parseFilingAgent({
        agentEmployeeId: empA,
        targetType: 'employee',
        targetEmployeeId: empB,
        note: '業務同仁差旅代辦',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.agentEmployeeId).toBe(empA);
        expect(res.value.targetType).toBe('employee');
        expect(res.value.targetEmployeeId).toBe(empB);
        expect(res.value.targetDepartmentId).toBeNull();
      }
    });

    it('accepts assigning an employee as filing agent for an entire department', () => {
      const res = parseFilingAgent({
        agentEmployeeId: empA,
        targetType: 'department',
        targetDepartmentId: deptX,
        note: '全研發部門庶務經辦',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.agentEmployeeId).toBe(empA);
        expect(res.value.targetType).toBe('department');
        expect(res.value.targetDepartmentId).toBe(deptX);
        expect(res.value.targetEmployeeId).toBeNull();
      }
    });

    it('rejects assigning an employee as their own filing agent', () => {
      const res = parseFilingAgent({
        agentEmployeeId: empA,
        targetType: 'employee',
        targetEmployeeId: empA,
      });
      expect(res.ok).toBe(false);
    });
  });

  describe('deriveDraftTitle (第 20 條：暫存草稿標題摘要)', () => {
    it('extracts purpose or subject from top-level fields', () => {
      expect(
        deriveDraftTitle('出差報告及報支單', {
          purpose: '拜訪高雄自駕車客戶專案會議',
        })
      ).toBe('拜訪高雄自駕車客戶專案會議');
    });

    it('extracts first item description from table rows when top-level fields are blank', () => {
      expect(
        deriveDraftTitle('請購單', {
          items: {
            rows: [{ description: 'NVIDIA Jetson AGX Orin 開發套件', quantity: '2' }],
          },
        })
      ).toBe('NVIDIA Jetson AGX Orin 開發套件');
    });

    it('falls back to formLabel + 暫存草稿 when all fields are empty', () => {
      expect(deriveDraftTitle('公出申請單', {})).toBe('公出申請單（暫存草稿）');
    });
  });
});
