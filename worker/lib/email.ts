import type { Env } from '../env';
import { escapeHtml } from './util';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface Sender {
  name: string;
  email: string;
}

interface Provider {
  name: 'resend' | 'brevo';
  base: string;
  path: string;
  headers: (key: string) => Record<string, string>;
  body: (message: EmailMessage, from: Sender) => unknown;
}

export interface EmailRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function parseSender(raw: string): Sender {
  const angled = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) return { name: angled[1] || 'Bookings', email: angled[2] };
  return { name: 'Bookings', email: raw.trim() };
}

function providerFor(env: Env): { provider: Provider; key: string } | null {
  if (env.RESEND_API_KEY) {
    return {
      key: env.RESEND_API_KEY,
      provider: {
        name: 'resend',
        base: 'https://api.resend.com',
        path: '/emails',
        headers: (key) => ({ Authorization: `Bearer ${key}`, 'content-type': 'application/json' }),
        body: (message, from) => ({
          from: `${from.name} <${from.email}>`,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      },
    };
  }
  if (env.BREVO_API_KEY) {
    return {
      key: env.BREVO_API_KEY,
      provider: {
        name: 'brevo',
        base: 'https://api.brevo.com',
        path: '/v3/smtp/email',
        headers: (key) => ({ 'api-key': key, 'content-type': 'application/json', accept: 'application/json' }),
        body: (message, from) => ({
          sender: from,
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
      },
    };
  }
  return null;
}

/** Builds the provider request. Returns null when email is not configured. */
export function buildEmailRequest(env: Env, message: EmailMessage): EmailRequest | null {
  const chosen = providerFor(env);
  if (!chosen) return null;

  const fallback = chosen.provider.name === 'resend' ? `${env.APP_NAME || 'Bookings'} <onboarding@resend.dev>` : '';
  const fromRaw = env.EMAIL_FROM || fallback;
  if (!fromRaw) return null;

  const base = (env.EMAIL_API_BASE || chosen.provider.base).replace(/\/+$/, '');
  return {
    url: `${base}${chosen.provider.path}`,
    headers: chosen.provider.headers(chosen.key),
    body: chosen.provider.body(message, parseSender(fromRaw)),
  };
}

/**
 * Sends through Resend or Brevo, whichever key is configured. With no key the
 * message is logged and skipped so local development never sends real mail.
 */
export async function sendEmail(env: Env, message: EmailMessage): Promise<{ ok: boolean; skipped?: boolean }> {
  const request = buildEmailRequest(env, message);
  if (!request) {
    console.log(`[email:skipped] to=${message.to} subject=${message.subject}`);
    return { ok: false, skipped: true };
  }

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
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
