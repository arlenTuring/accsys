import { afterEach, describe, expect, it, vi } from 'vitest';

const sendEmailMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/email/send', () => ({ sendEmail: sendEmailMock }));

function makeFakeDb(options: { recipientEmail: string | null; notifyInsertError?: string }) {
  const insertedRows: unknown[] = [];
  return {
    insertedRows,
    from(table: string) {
      if (table === 'notifications') {
        return {
          insert: (row: unknown) => {
            insertedRows.push(row);
            return Promise.resolve({
              error: options.notifyInsertError ? new Error(options.notifyInsertError) : null,
            });
          },
        };
      }
      if (table === 'employees') {
        const empBuilder = {
          select() {
            return empBuilder;
          },
          eq() {
            return empBuilder;
          },
          maybeSingle: async () => ({
            data: options.recipientEmail ? { google_email: options.recipientEmail } : null,
            error: null,
          }),
        };
        return empBuilder;
      }
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('notifyAndEmail', () => {
  afterEach(() => {
    sendEmailMock.mockClear();
  });

  it('inserts a notification row and emails the recipient', async () => {
    const db = makeFakeDb({ recipientEmail: 'approver@turing-drive.com' });
    const { notifyAndEmail } = await import('./notify');
    const result = await notifyAndEmail(db, {
      recipientEmployeeId: 'E1',
      type: 'approval_requested',
      formType: 'purchase_order',
      formId: 'PO1',
      caseNumber: 'CP1150700001',
      message: '採購單 CP1150700001 待您簽核',
    });
    expect(result).toEqual({ ok: true });
    expect(db.insertedRows).toEqual([
      {
        recipient_employee_id: 'E1',
        type: 'approval_requested',
        form_type: 'purchase_order',
        form_id: 'PO1',
        case_number: 'CP1150700001',
        message: '採購單 CP1150700001 待您簽核',
      },
    ]);
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: 'approver@turing-drive.com',
      subject: '【待簽核】CP1150700001',
      text: '採購單 CP1150700001 待您簽核',
    });
  });

  it('returns ok:false and skips the email when the notification insert fails', async () => {
    const db = makeFakeDb({ recipientEmail: 'approver@turing-drive.com', notifyInsertError: 'boom' });
    const { notifyAndEmail } = await import('./notify');
    const result = await notifyAndEmail(db, {
      recipientEmployeeId: 'E1',
      type: 'approval_requested',
      formType: 'purchase_order',
      formId: 'PO1',
      caseNumber: 'CP1150700001',
      message: '待簽核',
    });
    // The raw database message must not be passed through to callers.
    expect(result).toEqual({ ok: false, error: 'notification_insert_failed' });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('still returns ok:true when the recipient has no google_email (email skipped)', async () => {
    const db = makeFakeDb({ recipientEmail: null });
    const { notifyAndEmail } = await import('./notify');
    const result = await notifyAndEmail(db, {
      recipientEmployeeId: 'E1',
      type: 'request_returned',
      formType: 'purchase_order',
      formId: 'PO1',
      caseNumber: 'CP1150700001',
      message: '已退回',
    });
    expect(result).toEqual({ ok: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('still returns ok:true when sendEmail rejects (email is best-effort)', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('smtp down'));
    const db = makeFakeDb({ recipientEmail: 'approver@turing-drive.com' });
    const { notifyAndEmail } = await import('./notify');
    const result = await notifyAndEmail(db, {
      recipientEmployeeId: 'E1',
      type: 'request_approved',
      formType: 'purchase_order',
      formId: 'PO1',
      caseNumber: 'CP1150700001',
      message: '已核准',
    });
    expect(result).toEqual({ ok: true });
  });
});
