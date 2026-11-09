import type { Env } from '../env';
import { daysInclusive, formatDate, formatRange } from '../../shared/dates';
import { escapeHtml } from './util';
import { renderEmail, sendEmail } from './email';
import { loadSettings } from './settings';

function origin(env: Env): string {
  return env.APP_URL ? String(env.APP_URL).replace(/\/$/, '') : '';
}

interface BookingEmailRow {
  id: string;
  start_date: string;
  end_date: string;
  item_name: string;
  user_name: string;
  user_email: string;
}

const BOOKING_EMAIL_SELECT = `
  SELECT b.id, b.start_date, b.end_date, i.name AS item_name, u.name AS user_name, u.email AS user_email
  FROM bookings b
  JOIN items i ON i.id = b.item_id
  JOIN users u ON u.id = b.user_id
`;

async function bookingFor(env: Env, id: string): Promise<BookingEmailRow | null> {
  return env.DB.prepare(`${BOOKING_EMAIL_SELECT} WHERE b.id = ?`).bind(id).first<BookingEmailRow>();
}

/** Deep link that opens My bookings with that report form already open. */
export function reportLink(base: string, bookingId: string, kind: 'start' | 'end'): string | null {
  if (!base) return null;
  return `${base}/my-bookings?report=${encodeURIComponent(bookingId)}&kind=${kind}`;
}

function linkBlock(href: string | null, label: string): string {
  if (!href) return '';
  return `<p style="margin:6px 0"><a href="${href}" style="color:#0f766e;font-weight:600">${escapeHtml(label)}</a><br><span style="font-size:11px;color:#94a3b8">${escapeHtml(href)}</span></p>`;
}

export interface ConfirmationInput {
  orgName: string;
  base: string;
  booking: {
    id: string;
    startDate: string;
    endDate: string;
    itemName: string;
    userName: string;
  };
}

/** The confirmation email body: dates plus a link to the before and after report forms. */
export function buildBookingConfirmation(input: ConfirmationInput): { subject: string; html: string; text: string } {
  const { booking, base, orgName } = input;
  const span = daysInclusive(booking.startDate, booking.endDate);
  const startLink = reportLink(base, booking.id, 'start');
  const endLink = reportLink(base, booking.id, 'end');

  const reportBlock = `<p style="margin:16px 0 4px;font-weight:600;color:#0f172a">Condition reports</p>
    <p style="margin:0 0 6px;color:#334155;font-size:14px">Two photos or videos are needed: one before you set off, one when you return it. Each link opens the right form.</p>
    ${linkBlock(startLink, `Start condition report — opens ${formatDate(booking.startDate, 'medium')}`)}
    ${linkBlock(endLink, `End condition report — opens ${formatDate(booking.endDate, 'medium')}`)}`;

  const { html, text } = renderEmail({
    orgName,
    heading: `Booking confirmed: ${booking.itemName}`,
    intro: `Hi ${booking.userName}, your booking of ${booking.itemName} is confirmed.`,
    rows: [
      { label: 'Item', value: booking.itemName },
      { label: 'Dates', value: formatRange(booking.startDate, booking.endDate) },
      { label: 'Days', value: `${span} day${span === 1 ? '' : 's'}` },
    ],
    body: reportBlock,
    ctaLabel: 'Open my bookings',
    ctaUrl: base ? `${base}/my-bookings` : undefined,
    footer: `Sent by ${orgName}.`,
  });

  return {
    subject: `Booking confirmed: ${booking.itemName} (${formatDate(booking.startDate, 'short')} – ${formatDate(booking.endDate, 'short')})`,
    html,
    text,
  };
}

/** Sent whenever a booking becomes confirmed: new booking, or admin approval. */
export async function sendBookingConfirmation(env: Env, bookingId: string): Promise<{ ok: boolean; skipped?: boolean }> {
  const booking = await bookingFor(env, bookingId);
  if (!booking) return { ok: false };

  const settings = await loadSettings(env);
  const email = buildBookingConfirmation({
    orgName: settings.orgName,
    base: origin(env),
    booking: {
      id: booking.id,
      startDate: booking.start_date,
      endDate: booking.end_date,
      itemName: booking.item_name,
      userName: booking.user_name,
    },
  });

  return sendEmail(env, { to: booking.user_email, ...email });
}

/** Sent to every active admin when a booking needs manual approval. */
export async function notifyAdminsOfPendingBooking(env: Env, bookingId: string, reasons: string[]): Promise<void> {
  const booking = await bookingFor(env, bookingId);
  if (!booking) return;

  const settings = await loadSettings(env);
  const base = origin(env);
  const admins = await env.DB.prepare(`SELECT email FROM users WHERE role = 'admin' AND status = 'active'`).all<{
    email: string;
  }>();

  for (const admin of admins.results) {
    const { html, text } = renderEmail({
      orgName: settings.orgName,
      heading: 'Booking waiting for approval',
      intro: `${booking.user_name} (${booking.user_email}) booked ${booking.item_name} and needs an admin to approve it.`,
      rows: [
        { label: 'Item', value: booking.item_name },
        { label: 'Dates', value: formatRange(booking.start_date, booking.end_date) },
        { label: 'Why', value: reasons.join(' ') || 'This booking needs approval.' },
      ],
      ctaLabel: 'Review pending bookings',
      ctaUrl: base ? `${base}/admin/bookings` : undefined,
      footer: `Sent by ${settings.orgName}.`,
    });
    await sendEmail(env, {
      to: admin.email,
      subject: `Approval needed: ${booking.item_name} for ${booking.user_name}`,
      html,
      text,
    });
  }
}
