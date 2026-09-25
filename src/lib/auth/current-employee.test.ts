import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getCurrentEmployee } from './current-employee';
import { getSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}));

function mockSession(email?: string) {
  vi.mocked(getSession).mockResolvedValue({ email, isLoggedIn: !!email } as never);
}

function mockEmployeeRow(row: Record<string, unknown> | null) {
  vi.mocked(getDb).mockReturnValue({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => (row ? [row] : []),
          }),
        }),
      }),
    }),
  } as never);
}

describe('getCurrentEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when there is no logged-in user', async () => {
    mockSession(undefined);
    const result = await getCurrentEmployee();
    expect(result).toBeNull();
  });

  it('returns null when the email has no matching employee row', async () => {
    mockSession('nobody@turingdrive.ai');
    mockEmployeeRow(null);
    const result = await getCurrentEmployee();
    expect(result).toBeNull();
  });

  it('maps the employee row to a CurrentEmployee', async () => {
    mockSession('user@turingdrive.ai');
    mockEmployeeRow({
      id: 'emp-1',
      employeeCode: '0091',
      name: '李盈萱',
      email: 'user@turingdrive.ai',
      title: '工程師',
      departmentId: 'dept-1',
      departmentCode: 'RD',
      departmentName: '研發部',
      role: 'admin',
      isGeneralManager: false,
      isChairman: false,
    });

    const result = await getCurrentEmployee();

    expect(result).toEqual({
      id: 'emp-1',
      employeeCode: '0091',
      name: '李盈萱',
      email: 'user@turingdrive.ai',
      title: '工程師',
      departmentId: 'dept-1',
      departmentCode: 'RD',
      departmentName: '研發部',
      role: 'admin',
      isGeneralManager: false,
      isChairman: false,
    });
  });
});
