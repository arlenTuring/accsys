import { describe, expect, it, vi } from 'vitest';
import { getCurrentEmployee } from './current-employee';

function createMockSupabase(options: {
  email?: string;
  employeeRow?: Record<string, unknown> | null;
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.email ? { email: options.email } : null },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: options.employeeRow ?? null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe('getCurrentEmployee', () => {
  it('returns null when there is no logged-in user', async () => {
    const supabase = createMockSupabase({});
    const result = await getCurrentEmployee(supabase as never);
    expect(result).toBeNull();
  });

  it('returns null when the email has no matching employee row', async () => {
    const supabase = createMockSupabase({
      email: 'nobody@turingdrive.ai',
      employeeRow: null,
    });
    const result = await getCurrentEmployee(supabase as never);
    expect(result).toBeNull();
  });

  it('maps the employee row to a CurrentEmployee', async () => {
    const supabase = createMockSupabase({
      email: 'user@turingdrive.ai',
      employeeRow: {
        id: 'emp-1',
        employee_code: '0091',
        name: '李盈萱',
        department_id: 'dept-1',
        role: 'admin',
        is_general_manager: false,
        is_chairman: false,
      },
    });

    const result = await getCurrentEmployee(supabase as never);

    expect(result).toEqual({
      id: 'emp-1',
      employeeCode: '0091',
      name: '李盈萱',
      departmentId: 'dept-1',
      role: 'admin',
      isGeneralManager: false,
      isChairman: false,
    });
  });
});
