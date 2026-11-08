// Date helpers shared by the Worker and the React app.
// All booking dates are plain ISO calendar days (YYYY-MM-DD), inclusive.

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAYS_SHORT = WEEKDAYS.map((d) => d.slice(0, 3));

/** Today's calendar date in the given IANA timezone. */
export function todayInTz(tz = 'UTC'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

/** Inclusive day count, e.g. 3rd to 5th = 3. */
export function daysInclusive(start: string, end: string): number {
  return diffDays(start, end) + 1;
}

export function isDayInRange(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Six 7-day weeks, Monday first, with ISO dates for the whole grid. */
export function monthMatrix(month: string): { iso: string; inMonth: boolean }[][] {
  const first = parseISO(`${month}-01`);
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const gridStart = addDays(toISO(first), -offset);
  const weeks: { iso: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: { iso: string; inMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = addDays(gridStart, w * 7 + d);
      week.push({ iso, inMonth: iso.slice(0, 7) === month });
    }
    weeks.push(week);
  }
  return weeks;
}

export function weekdayLabels(): string[] {
  return WEEKDAYS_SHORT;
}

export function formatDate(iso: string, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const d = parseISO(iso);
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const short = MONTHS_SHORT[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const weekday = WEEKDAYS[(d.getUTCDay() + 6) % 7];
  if (style === 'short') return `${day} ${short}`;
  if (style === 'long') return `${weekday} ${day} ${month} ${year}`;
  return `${weekday.slice(0, 3)} ${day} ${short} ${year}`;
}

export function formatRange(start: string, end: string): string {
  if (start === end) return formatDate(start, 'long');
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  if (sameMonth) return `${formatDate(start, 'medium')} – ${parseISO(end).getUTCDate()} ${MONTHS_SHORT[parseISO(end).getUTCMonth()]} ${end.slice(0, 4)}`;
  if (sameYear) return `${formatDate(start, 'medium')} – ${formatDate(end, 'medium')}`;
  return `${formatDate(start, 'medium')} – ${formatDate(end, 'medium')}`;
}

export function relativeDays(day: string, today: string): string {
  const delta = diffDays(today, day);
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta === -1) return 'yesterday';
  if (delta > 1) return `in ${delta} days`;
  return `${Math.abs(delta)} days ago`;
}
