import type { Env } from '../env';
import type { Limits, Settings } from '../../shared/types';
import { addDays, daysInclusive, diffDays, formatDate, ISO_DATE } from '../../shared/dates';
import { effectiveLimits } from './map';

export interface BookingValidationInput {
  item: any;
  userId: string;
  start: string;
  end: string;
  today: string;
  isAdmin: boolean;
}

export function describeLimits(limits: Limits): string {
  const parts = [
    `Up to ${limits.maxDays} day${limits.maxDays === 1 ? '' : 's'} per booking`,
    `${limits.maxBookingsPerPeriod} booking${limits.maxBookingsPerPeriod === 1 ? '' : 's'} per ${limits.periodDays} days`,
    limits.minGapDays > 0 ? `${limits.minGapDays} day gap between your bookings` : null,
    `book up to ${limits.advanceDays} days ahead`,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Returns a human readable reason the booking is not allowed, or null. */
export async function validateBooking(env: Env, input: BookingValidationInput): Promise<string | null> {
  const { item, userId, start, end, today, isAdmin } = input;

  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return 'Pick a valid start and end date.';
  if (end < start) return 'The end date must be on or after the start date.';
  if (start < today) return 'Bookings cannot start in the past.';
  if (!item || !item.active) return 'This item is not currently available for booking.';

  const settings = await loadSettingsSafe(env);
  const limits = effectiveLimits(item, settings);
  const span = daysInclusive(start, end);

  if (span > limits.maxDays) {
    return `${item.name} can be booked for at most ${limits.maxDays} day${limits.maxDays === 1 ? '' : 's'} at a time.`;
  }
  if (diffDays(today, start) > limits.advanceDays) {
    return `Bookings open at most ${limits.advanceDays} days ahead.`;
  }

  // A peak period can cap a booking more tightly than the item default.
  const peaks = await peakPeriodsOverlapping(env, start, end);
  if (peaks.length > 0) {
    const peak = peaks[0];
    const cap = Number(peak.max_days);
    if (span > cap) {
      return `${item.name} can be booked for at most ${cap} day${cap === 1 ? '' : 's'} during ${peak.name}.`;
    }
  }

  const conflict = await env.DB.prepare(
    `SELECT b.id, b.start_date, b.end_date, u.name AS user_name
     FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.item_id = ? AND b.status IN ('confirmed', 'pending') AND b.start_date <= ? AND b.end_date >= ?
     LIMIT 1`,
  )
    .bind(item.id, end, start)
    .first<any>();

  if (conflict) {
    return `${item.name} is already booked by ${conflict.user_name} (${formatDate(conflict.start_date)} – ${formatDate(conflict.end_date)}). Pick another week or ask an admin to change it.`;
  }

  // Admins booking on behalf of the club skip the frequency rules.
  if (isAdmin) return null;

  // Rolling window: how many bookings has this member made in the window ending at `start`?
  const windowStart = addDays(start, -(limits.periodDays - 1));
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM bookings
     WHERE user_id = ? AND status IN ('confirmed', 'pending') AND start_date >= ? AND start_date <= ?`,
  )
    .bind(userId, windowStart, start)
    .first<any>();
  if (Number(recent?.n ?? 0) >= limits.maxBookingsPerPeriod) {
    return `You can make ${limits.maxBookingsPerPeriod} booking${limits.maxBookingsPerPeriod === 1 ? '' : 's'} every ${limits.periodDays} days. Try a later date or ask an admin.`;
  }

  if (limits.minGapDays > 0) {
    // Any booking of this item by the same member whose range, widened by the
    // required gap, touches the requested range means the gap is not met.
    const near = await env.DB.prepare(
      `SELECT start_date, end_date FROM bookings
       WHERE user_id = ? AND item_id = ? AND status IN ('confirmed', 'pending')
         AND start_date <= ? AND end_date >= ?
       ORDER BY start_date LIMIT 1`,
    )
      .bind(userId, item.id, addDays(end, limits.minGapDays), addDays(start, -limits.minGapDays))
      .first<any>();
    if (near) {
      return `You need at least ${limits.minGapDays} clear day${limits.minGapDays === 1 ? '' : 's'} between your bookings of ${item.name}. You already have it from ${formatDate(near.start_date)} to ${formatDate(near.end_date)}.`;
    }
  }

  const missingReport = await env.DB.prepare(
    `SELECT b.id, b.end_date, i.name
     FROM bookings b JOIN items i ON i.id = b.item_id
     WHERE b.user_id = ? AND b.status = 'confirmed' AND b.end_date < ?
       AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.booking_id = b.id AND r.kind = 'end')
     ORDER BY b.end_date LIMIT 1`,
  )
    .bind(userId, today)
    .first<any>();
  if (missingReport) {
    return `Upload the end-of-booking condition report for ${missingReport.name} (ended ${formatDate(missingReport.end_date)}) before booking again.`;
  }

  return null;
}

/** Peak periods a date range touches, most restrictive first. */
export async function peakPeriodsOverlapping(env: Env, start: string, end: string) {
  const rows = await env.DB.prepare(
    'SELECT * FROM peak_periods WHERE start_date <= ? AND end_date >= ? ORDER BY max_days ASC, start_date ASC',
  )
    .bind(end, start)
    .all<any>();
  return rows.results;
}

/**
 * Reasons a member booking needs an admin decision. An empty list means the
 * booking can be confirmed straight away. Admins never need approval.
 */
export async function evaluateApproval(
  env: Env,
  input: { userId: string; start: string; end: string; settings: Settings },
): Promise<string[]> {
  const { userId, start, end, settings } = input;
  const reasons: string[] = [];
  const year = start.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // A second peak-period booking in the same calendar year needs approval.
  const peaks = await peakPeriodsOverlapping(env, start, end);
  if (peaks.length > 0) {
    const prior = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM bookings b
       WHERE b.user_id = ? AND b.status IN ('confirmed', 'pending')
         AND b.start_date <= ? AND b.end_date >= ?
         AND EXISTS (
           SELECT 1 FROM peak_periods p
           WHERE b.start_date <= p.end_date AND b.end_date >= p.start_date
         )`,
    )
      .bind(userId, yearEnd, yearStart)
      .first<any>();
    if (Number(prior?.n ?? 0) > 0) {
      reasons.push(
        `This would be your second peak-period booking in ${year} (${peaks[0].name}), so an admin needs to approve it.`,
      );
    }
  }

  // Days already booked this calendar year, plus the days being requested.
  const rows = await env.DB.prepare(
    `SELECT start_date, end_date FROM bookings
     WHERE user_id = ? AND status IN ('confirmed', 'pending') AND start_date <= ? AND end_date >= ?`,
  )
    .bind(userId, yearEnd, yearStart)
    .all<any>();

  let booked = 0;
  for (const row of rows.results) {
    const from = row.start_date > yearStart ? row.start_date : yearStart;
    const to = row.end_date < yearEnd ? row.end_date : yearEnd;
    booked += daysInclusive(from, to);
  }
  const requestedFrom = start > yearStart ? start : yearStart;
  const requestedTo = end < yearEnd ? end : yearEnd;
  const requested = daysInclusive(requestedFrom, requestedTo);

  if (booked + requested > settings.yearlyMaxDays) {
    reasons.push(
      `This would take you to ${booked + requested} days in ${year}, over the ${settings.yearlyMaxDays}-day yearly allowance, so an admin needs to approve it.`,
    );
  }

  return reasons;
}

/** Small duplicate to avoid an import cycle between settings and rules. */
async function loadSettingsSafe(env: Env): Promise<Settings> {
  const { loadSettings } = await import('./settings');
  return loadSettings(env);
}

/** Bookings (with names) that overlap a window, used by the calendar. */
export async function bookingsInWindow(env: Env, itemId: string, from: string, to: string) {
  const rows = await env.DB.prepare(
    `SELECT b.id, b.item_id, b.user_id, b.start_date, b.end_date, b.status, u.name AS user_name
     FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.item_id = ? AND b.status = 'confirmed' AND b.start_date <= ? AND b.end_date >= ?
     ORDER BY b.start_date`,
  )
    .bind(itemId, to, from)
    .all<any>();
  return rows.results;
}
