export enum LimitWindowType {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export interface LagosWindow {
  windowType: LimitWindowType;
  windowKey: string;
  windowStart: Date;
  windowEnd: Date;
}

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+1 no DST

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/**
 * Convert UTC date to Lagos wall time as a Date whose UTC components equal Lagos wall components.
 * Lagos wall time = UTC + 1h, so we add 1h and read UTC fields.
 */
function toLagosWall(date: Date): Date {
  return new Date(date.getTime() + LAGOS_OFFSET_MS);
}

/**
 * Create a UTC instant that corresponds to a Lagos wall time at given Y/M/D H:M:S
 * by building a UTC timestamp then subtracting the offset.
 */
function lagosWallToUtc(year: number, monthIndex0: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): Date {
  const utcMs = Date.UTC(year, monthIndex0, day, hour, minute, second, ms) - LAGOS_OFFSET_MS;
  return new Date(utcMs);
}

function isoWeekForLagosDate(lagosWall: Date): { isoYear: number; isoWeek: number } {
  // lagosWall is wall time represented as UTC date (so its UTC Y/M/D are Lagos Y/M/D)
  // Use UTC-based ISO week calculation
  const d = new Date(Date.UTC(lagosWall.getUTCFullYear(), lagosWall.getUTCMonth(), lagosWall.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Monday 1.. Sunday 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { isoYear: d.getUTCFullYear(), isoWeek: weekNo };
}

export function getLagosWindow(now: Date, windowType: LimitWindowType | string): LagosWindow {
  const wt = String(windowType).toUpperCase() as LimitWindowType;
  if (!Object.values(LimitWindowType).includes(wt)) {
    throw new Error(`Invalid windowType ${windowType}`);
  }
  const lagos = toLagosWall(now);
  const year = lagos.getUTCFullYear();
  const month = lagos.getUTCMonth(); // 0-indexed
  const day = lagos.getUTCDate();

  if (wt === LimitWindowType.DAILY) {
    const start = lagosWallToUtc(year, month, day, 0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const key = `${year}-${pad(month + 1)}-${pad(day)}:DAILY:Africa/Lagos`;
    return { windowType: wt, windowKey: key, windowStart: start, windowEnd: end };
  }

  if (wt === LimitWindowType.WEEKLY) {
    // Find Monday of this Lagos week
    const dow = lagos.getUTCDay(); // 0 Sun ..6 Sat
    const daysSinceMonday = (dow + 6) % 7; // Monday 0
    const mondayWallMs = Date.UTC(year, month, day, 0, 0, 0, 0) - daysSinceMonday * 86400000;
    const mondayWall = new Date(mondayWallMs);
    const mYear = mondayWall.getUTCFullYear();
    const mMonth = mondayWall.getUTCMonth();
    const mDay = mondayWall.getUTCDate();
    // Validate via wall representation
    const start = lagosWallToUtc(mYear, mMonth, mDay, 0, 0, 0, 0);
    const end = new Date(start.getTime() + 7 * 86400000);
    const { isoYear, isoWeek } = isoWeekForLagosDate(lagos);
    const key = `${isoYear}-W${pad(isoWeek, 2)}:WEEKLY:Africa/Lagos`;
    // Also ensure monday start aligns with isoYear/week — for first/last week of year, Monday may be in previous/next year but ISO year reflects Thursday's year, which is correct
    return { windowType: wt, windowKey: key, windowStart: start, windowEnd: end };
  }

  if (wt === LimitWindowType.MONTHLY) {
    const start = lagosWallToUtc(year, month, 1, 0, 0, 0, 0);
    const nextMonth = month === 11 ? lagosWallToUtc(year + 1, 0, 1, 0, 0, 0, 0) : lagosWallToUtc(year, month + 1, 1, 0, 0, 0, 0);
    const key = `${year}-${pad(month + 1)}:MONTHLY:Africa/Lagos`;
    return { windowType: wt, windowKey: key, windowStart: start, windowEnd: nextMonth };
  }

  // YEARLY
  const start = lagosWallToUtc(year, 0, 1, 0, 0, 0, 0);
  const end = lagosWallToUtc(year + 1, 0, 1, 0, 0, 0, 0);
  const key = `${year}:YEARLY:Africa/Lagos`;
  return { windowType: wt, windowKey: key, windowStart: start, windowEnd: end };
}

export function dimensionToWindowType(dimension: string): LimitWindowType | null {
  const d = String(dimension).toUpperCase();
  if (d.startsWith('DAILY_')) return LimitWindowType.DAILY;
  if (d.startsWith('WEEKLY_')) return LimitWindowType.WEEKLY;
  if (d.startsWith('MONTHLY_')) return LimitWindowType.MONTHLY;
  if (d.startsWith('YEARLY_')) return LimitWindowType.YEARLY;
  return null;
}

export function getWindowForDimension(now: Date, dimension: string): LagosWindow | null {
  const wt = dimensionToWindowType(dimension);
  if (!wt) return null;
  return getLagosWindow(now, wt);
}

export function isWindowedDimension(dimension: string): boolean {
  return dimensionToWindowType(dimension) !== null;
}

// For tests: expose helper to create window from explicit Lagos date string YYYY-MM-DD
export function getLagosWindowForLagosDate(lagosDateStr: string, windowType: LimitWindowType): LagosWindow {
  // lagosDateStr expected YYYY-MM-DD interpreted as Lagos wall date
  const [y, m, d] = lagosDateStr.split('-').map(Number);
  const fakeNow = lagosWallToUtc(y!, m! - 1, d!, 12, 0, 0, 0); // noon Lagos ensures same wall date
  return getLagosWindow(fakeNow, windowType);
}
