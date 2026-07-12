function parseISO(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function countBusinessDaysBetween(startIso: string, endIso: string): number {
  const start = parseISO(startIso);
  const end = parseISO(endIso);
  if (end.getTime() <= start.getTime()) return 0;
  let count = 0;
  const cursor = new Date(start.getTime());
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function computeDefaultExpectedPaymentDate(invoiceMonth: string): string {
  const [year, month] = invoiceMonth.split('-').map(Number);
  return toISO(new Date(Date.UTC(year, month, 25)));
}

function nextSupplierBatchDate(desired: Date): Date {
  const day = desired.getUTCDate();
  const year = desired.getUTCFullYear();
  const month = desired.getUTCMonth();
  if (day <= 25) return new Date(Date.UTC(year, month, 25));
  return new Date(Date.UTC(year, month + 1, 25));
}

function nextEmployeeBatchDate(desired: Date): Date {
  const day = desired.getUTCDate();
  const year = desired.getUTCFullYear();
  const month = desired.getUTCMonth();
  const secondBatchDay = Math.min(30, lastDayOfMonth(year, month));
  if (day <= 15) return new Date(Date.UTC(year, month, 15));
  if (day <= secondBatchDay) return new Date(Date.UTC(year, month, secondBatchDay));
  return new Date(Date.UTC(year, month + 1, 15));
}

export function computePaymentBatchDate(input: {
  payeeType: 'employee' | 'supplier';
  referenceDate: string;
  expectedPaymentDate: string | null;
  invoiceMonth: string | null;
}): { batchDate: string; isPastNormalDeadline: boolean; isUrgent: boolean } {
  const desiredIso =
    input.expectedPaymentDate ??
    (input.invoiceMonth ? computeDefaultExpectedPaymentDate(input.invoiceMonth) : input.referenceDate);
  const desired = parseISO(desiredIso);
  const batch =
    input.payeeType === 'supplier' ? nextSupplierBatchDate(desired) : nextEmployeeBatchDate(desired);
  const batchDate = toISO(batch);
  const businessDaysRemaining = countBusinessDaysBetween(input.referenceDate, batchDate);
  return {
    batchDate,
    isPastNormalDeadline: businessDaysRemaining < 5,
    isUrgent: businessDaysRemaining < 2,
  };
}
