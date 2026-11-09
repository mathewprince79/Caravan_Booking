import type { Env } from '../env';
import { addDays, formatDate, todayInTz } from '../../shared/dates';
import { loadSettings } from './settings';
import { renderEmail, sendEmail } from './email';
import { clubName } from './bookingEmail';

export interface SweepSummary {
  date: string;
  startReports: number;
  endReports: number;
  addressPrompts: number;
  emailsSent: number;
  emailSkipped: number;
  errors: string[];
}

const MAX_ATTEMPTS = { start: 3, end: 5, address: 3 } as const;

async function claimReminder(env: Env, bookingId: string, kind: 'start' | 'end' | 'address', today: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT count, last_sent_at FROM reminders WHERE booking_id = ? AND kind = ?')
    .bind(bookingId, kind)
    .first<any>();
  const count = Number(row?.count ?? 0);
  if (count >= MAX_ATTEMPTS[kind]) return false;
  if (row?.last_sent_at && String(row.last_sent_at).slice(0, 10) === today) return false;
  await env.DB.prepare(
    `INSERT INTO reminders (booking_id, kind, count, last_sent_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(booking_id, kind) DO UPDATE SET count = count + 1, last_sent_at = excluded.last_sent_at`,
  )
    .bind(bookingId, kind, new Date().toISOString())
    .run();
  return true;
}

/**
 * Daily sweep: asks for the start condition report on the first day, the end
 * report on the last day, and the parking address once the booking is over.
 */
export async function runReminderSweep(env: Env): Promise<SweepSummary> {
  const settings = await loadSettings(env);
  const today = todayInTz(settings.timezone);
  const appUrl = (env as any).APP_URL ? String((env as any).APP_URL).replace(/\/$/, '') : '';
  const summary: SweepSummary = {
    date: today,
    startReports: 0,
    endReports: 0,
    addressPrompts: 0,
    emailsSent: 0,
    emailSkipped: 0,
    errors: [],
  };

  const rows = await env.DB.prepare(
    `SELECT b.id, b.item_id, b.start_date, b.end_date, i.name AS item_name, i.category AS item_category,
            u.name AS user_name, u.email AS user_email, u.id AS user_id,
            (SELECT COUNT(*) FROM reports r WHERE r.booking_id = b.id AND r.kind = 'start') AS start_reports,
            (SELECT COUNT(*) FROM reports r WHERE r.booking_id = b.id AND r.kind = 'end') AS end_reports,
            (SELECT COUNT(*) FROM returns rt WHERE rt.booking_id = b.id) AS return_records
     FROM bookings b
     JOIN items i ON i.id = b.item_id
     JOIN users u ON u.id = b.user_id
     WHERE b.status = 'confirmed' AND b.start_date <= ? AND b.end_date >= ?
     ORDER BY b.start_date`,
  )
    .bind(today, addDays(today, -45))
    .all<any>();

  for (const row of rows.results) {
    const dateRange = `${formatDate(row.start_date)} – ${formatDate(row.end_date)}`;
    const club = clubName(row.item_name, row.item_category, settings.orgName);
    const baseRows = [
      { label: 'Item', value: row.item_name },
      { label: 'Dates', value: dateRange },
    ];
    const ctaUrl = appUrl ? `${appUrl}/items/${row.item_id}` : undefined;

    try {
      // 1. Day the booking starts: pre-use condition report.
      if (row.start_date <= today && row.end_date >= today && Number(row.start_reports) === 0) {
        if (await claimReminder(env, row.id, 'start', today)) {
          const { html, text } = renderEmail({
            orgName: club,
            heading: `Condition report due today: ${row.item_name}`,
            intro: `Hi ${row.user_name}, your booking starts today. Please upload a photo or video of ${row.item_name} before you set off so we have a record of its condition.`,
            rows: baseRows,
            body: 'The report is required — you will be asked for it again when the booking ends.',
            ctaLabel: 'Upload the condition report',
            ctaUrl,
            footer: `Sent by ${club}.`,
          });
          const result = await sendEmail(env, {
            to: row.user_email,
            subject: `Condition report due today – ${row.item_name}`,
            html,
            text,
            fromName: club,
          });
          summary.startReports++;
          result.ok ? summary.emailsSent++ : summary.emailSkipped++;
        }
      }

      // 2. Last day of the booking: end-of-booking report.
      if (row.end_date <= today && Number(row.end_reports) === 0) {
        if (await claimReminder(env, row.id, 'end', today)) {
          const { html, text } = renderEmail({
            orgName: club,
            heading: `End-of-booking report due: ${row.item_name}`,
            intro: `Hi ${row.user_name}, your booking of ${row.item_name} has finished. Please upload a photo or video showing the condition it was returned in, and tell us where it is parked.`,
            rows: baseRows,
            body: 'The report is required before you can book another item.',
            ctaLabel: 'Upload the return report',
            ctaUrl,
            footer: `Sent by ${club}.`,
          });
          const result = await sendEmail(env, {
            to: row.user_email,
            subject: `End-of-booking condition report – ${row.item_name}`,
            html,
            text,
            fromName: club,
          });
          summary.endReports++;
          result.ok ? summary.emailsSent++ : summary.emailSkipped++;
        }
      }

      // 3. Booking finished: where is the item parked?
      if (row.end_date <= today && Number(row.return_records) === 0) {
        if (await claimReminder(env, row.id, 'address', today)) {
          const { html, text } = renderEmail({
            orgName: club,
            heading: `Where is ${row.item_name} parked?`,
            intro: `Hi ${row.user_name}, thanks for returning ${row.item_name}. Please add the address where it is parked so the next member can find it.`,
            rows: baseRows,
            ctaLabel: 'Add the parking address',
            ctaUrl,
            footer: `Sent by ${club}.`,
          });
          const result = await sendEmail(env, {
            to: row.user_email,
            subject: `Parking address for ${row.item_name}`,
            html,
            text,
            fromName: club,
          });
          summary.addressPrompts++;
          result.ok ? summary.emailsSent++ : summary.emailSkipped++;
        }
      }
    } catch (error) {
      summary.errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('[cron] reminder sweep', JSON.stringify(summary));
  return summary;
}
