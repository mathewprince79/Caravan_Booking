import type { Env } from '../env';
import { escapeHtml } from './util';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends through Resend. Without RESEND_API_KEY the message is logged instead. */
export async function sendEmail(env: Env, message: EmailMessage): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:skipped] to=${message.to} subject=${message.subject}`);
    return { ok: false, skipped: true };
  }
  const from = env.EMAIL_FROM || `${env.APP_NAME || 'Bookings'} <onboarding@resend.dev>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
    });
    if (!response.ok) {
      console.error('[email:failed]', response.status, await response.text());
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.error('[email:error]', error);
    return { ok: false };
  }
}

export interface EmailContent {
  orgName: string;
  heading: string;
  intro: string;
  rows?: { label: string; value: string }[];
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const rows = (content.rows ?? [])
    .map(
      (row) =>
        `<tr><td style="padding:6px 0;color:#64748b;font-size:14px;width:130px;vertical-align:top">${escapeHtml(row.label)}</td>` +
        `<td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('');

  const button =
    content.ctaUrl && content.ctaLabel
      ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(content.ctaUrl)}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(content.ctaLabel)}</a></p>`
      : '';

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e2e8f0">
    <tr><td>
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;font-weight:700">${escapeHtml(content.orgName)}</p>
      <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a">${escapeHtml(content.heading)}</h1>
      <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6">${escapeHtml(content.intro)}</p>
      ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px">${rows}</table>` : ''}
      ${content.body ? `<div style="color:#334155;font-size:15px;line-height:1.6">${content.body}</div>` : ''}
      ${button}
      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">${escapeHtml(content.footer ?? 'You are receiving this because you have a booking with us.')}</p>
    </td></tr>
  </table>
</body></html>`;

  const lines = [
    content.heading,
    '',
    content.intro,
    '',
    ...(content.rows ?? []).map((row) => `${row.label}: ${row.value}`),
    ...(content.body ? ['', content.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()] : []),
    ...(content.ctaUrl ? ['', `${content.ctaLabel ?? 'Open'}: ${content.ctaUrl}`] : []),
    '',
    content.footer ?? content.orgName,
  ];
  return { html, text: lines.join('\n') };
}
