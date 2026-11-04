/** Pure date/location matching for trip companion candidates (unit-testable). */

export type MatchKind = 'full_overlap' | 'partial_overlap' | 'near' | 'same_dates_diff_project' | 'skip';

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return Math.round(ms / 86400000);
}

export function overlapDays(a0: string, a1: string, b0: string, b1: string): number {
  const start = a0 > b0 ? a0 : b0;
  const end = a1 < b1 ? a1 : b1;
  if (start > end) return 0;
  return daysBetween(start, end) + 1;
}

export function classifyCompanionMatch(input: {
  targetStart: string;
  targetEnd: string;
  targetLocation: string | null;
  candStart: string;
  candEnd: string;
  candLocation: string;
  nearDays: number;
}): { kind: MatchKind; reason: string; diff: string } {
  const { targetStart, targetEnd, targetLocation, candStart, candEnd, candLocation, nearDays } = input;
  const windowStart = new Date(targetStart);
  windowStart.setDate(windowStart.getDate() - nearDays);
  const windowEnd = new Date(targetEnd);
  windowEnd.setDate(windowEnd.getDate() + nearDays);
  const win0 = windowStart.toISOString().slice(0, 10);
  const win1 = windowEnd.toISOString().slice(0, 10);
  if (candEnd < win0 || candStart > win1) {
    return { kind: 'skip', reason: '超出鄰近範圍', diff: '' };
  }

  const ov = overlapDays(targetStart, targetEnd, candStart, candEnd);
  const locMatch = !!(
    targetLocation &&
    candLocation &&
    (candLocation.includes(targetLocation) || targetLocation.includes(candLocation))
  );

  if (ov > 0 && locMatch && candStart === targetStart && candEnd === targetEnd) {
    return { kind: 'full_overlap', reason: '同地點，日期完全符合', diff: '無日期差異' };
  }
  if (ov > 0 && locMatch) {
    let diff = '部分重疊';
    if (candStart < targetStart) diff = `提早 ${daysBetween(candStart, targetStart)} 天抵達`;
    else if (candStart > targetStart) diff = `晚 ${daysBetween(targetStart, candStart)} 天出發`;
    else if (candEnd > targetEnd) diff = `較晚 ${daysBetween(targetEnd, candEnd)} 天離開`;
    else if (candEnd < targetEnd) diff = `較早 ${daysBetween(candEnd, targetEnd)} 天結束`;
    return { kind: 'partial_overlap', reason: `同地點，日期重疊 ${ov} 天`, diff };
  }
  if (ov > 0 && !locMatch && targetLocation) {
    return {
      kind: 'same_dates_diff_project',
      reason: '日期重疊但地點不同',
      diff: candLocation ? `對方地點：${candLocation}` : '對方地點未填',
    };
  }
  if (locMatch) {
    const diff =
      candEnd < targetStart
        ? `早於目標行程 ${daysBetween(candEnd, targetStart)} 天`
        : `晚於目標行程 ${daysBetween(targetEnd, candStart)} 天`;
    return { kind: 'near', reason: '同地點，鄰近日期（無重疊）', diff };
  }
  return { kind: 'skip', reason: '地點不符且無重疊', diff: '' };
}
