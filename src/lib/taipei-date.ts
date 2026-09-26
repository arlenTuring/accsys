/** Today's date in Asia/Taipei as YYYY-MM-DD (business dates follow the Taipei calendar). */
export function taipeiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
