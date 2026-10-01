/**
 * Date/time utilities.
 *
 * Storage policy:
 *  - Timestamps: epoch milliseconds (UTC).
 *  - Date-only business fields: 'YYYY-MM-DD' strings in Asia/Dhaka local time.
 * Asia/Dhaka has no DST; offset is a fixed +06:00.
 */

export const DHAKA_OFFSET_MINUTES = 360;
const MS_PER_DAY = 86_400_000;

export function dhakaOffsetMs(at: number = Date.now()): number {
  void at; // fixed offset; parameter kept for future zone-data support
  return DHAKA_OFFSET_MINUTES * 60_000;
}

/** Convert epoch ms (UTC) to 'YYYY-MM-DD' in Asia/Dhaka. */
export function epochToDhakaDate(epochMs: number): string {
  const local = new Date(epochMs + dhakaOffsetMs(epochMs));
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse 'YYYY-MM-DD' (Dhaka) to the epoch ms of 00:00 Dhaka that day. */
export function dhakaDateToEpoch(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error(`Invalid date: ${date}`);
  return Date.UTC(y, m - 1, d) - dhakaOffsetMs();
}

/** [startInclusive, endExclusive) epoch range for a Dhaka calendar day. */
export function dhakaDayRange(date: string): { start: number; end: number } {
  const start = dhakaDateToEpoch(date);
  return { start, end: start + MS_PER_DAY };
}

export function todayDhaka(now: number = Date.now()): string {
  return epochToDhakaDate(now);
}

/** Add days to a 'YYYY-MM-DD' string (Dhaka calendar, UTC math on the date parts). */
export function addDays(date: string, days: number): string {
  const epoch = dhakaDateToEpoch(date);
  return epochToDhakaDate(epoch + days * MS_PER_DAY);
}

export function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  try {
    dhakaDateToEpoch(date);
    return true;
  } catch {
    return false;
  }
}

/** Date presets used across lists/reports. Returns Dhaka day range boundaries. */
export type DatePreset = 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'all';

export function presetRange(
  preset: DatePreset,
  now: number = Date.now(),
): { start: number; end: number } | null {
  const today = todayDhaka(now);
  switch (preset) {
    case 'today':
      return dhakaDayRange(today);
    case 'last7':
      return { start: dhakaDateToEpoch(addDays(today, -6)), end: dhakaDateToEpoch(today) + MS_PER_DAY };
    case 'last30':
      return { start: dhakaDateToEpoch(addDays(today, -29)), end: dhakaDateToEpoch(today) + MS_PER_DAY };
    case 'last90':
      return { start: dhakaDateToEpoch(addDays(today, -89)), end: dhakaDateToEpoch(today) + MS_PER_DAY };
    case 'last365':
      return { start: dhakaDateToEpoch(addDays(today, -364)), end: dhakaDateToEpoch(today) + MS_PER_DAY };
    case 'all':
      return null;
  }
}

/** Dhaka day sequence between two dates inclusive (for report rows). */
export function eachDhakaDay(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 4000) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

export interface DhakaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function toDhakaParts(epochMs: number): DhakaParts {
  const d = new Date(epochMs + dhakaOffsetMs(epochMs));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** 'YYYY-MM-DD HH:mm' in Dhaka time — used for audit rows, backup names, print stamps. */
export function formatDhakaDateTime(epochMs: number, opts: { seconds?: boolean } = {}): string {
  const p = toDhakaParts(epochMs);
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  const sec = opts.seconds ? `:${String(p.second).padStart(2, '0')}` : '';
  return `${date} ${time}${sec}`;
}

/** Filesystem/backup-safe stamp: 20260930-184512 */
export function compactDhakaStamp(epochMs: number): string {
  const p = toDhakaParts(epochMs);
  return (
    `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}` +
    `-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}${String(p.second).padStart(2, '0')}`
  );
}

/** Human age from a Dhaka date of birth (floor). Returns null when dob invalid/absent. */
export function ageFromDob(dob: string, now: number = Date.now()): number | null {
  if (!isValidDateString(dob)) return null;
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const p = toDhakaParts(now);
  let age = p.year - by;
  if (p.month < bm || (p.month === bm && p.day < bd)) age--;
  return age >= 0 && age < 130 ? age : null;
}

export function formatDhakaDateHuman(date: string, locale = 'en-GB'): string {
  const epoch = dhakaDateToEpoch(date);
  const p = toDhakaParts(epoch);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(p.year, p.month - 1, p.day));
}

/** Minutes between two epoch values, rounded. */
export function minutesBetween(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) / 60_000));
}
