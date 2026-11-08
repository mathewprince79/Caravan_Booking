import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppBindings, Env } from '../env';
import {
  clearFailures,
  clearSessionCookie,
  createSession,
  getSessionUser,
  hashPassword,
  isHttps,
  OAUTH_STATE_COOKIE,
  recordFailure,
  tooManyAttempts,
  verifyPassword,
} from '../lib/auth';
import { loadMe } from '../lib/me';
import { loadSettings } from '../lib/settings';
import { mapUser } from '../lib/map';
import { renderEmail, sendEmail } from '../lib/email';
import { normalizePhone, nowISO, randomToken, uid } from '../lib/util';
import { exchangeGoogleCode, verifyGoogleIdToken } from '../lib/google';
import { readBody } from '../lib/http';

export const authRoutes = new Hono<AppBindings>();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function adminEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function notifyAdminsOfSignup(env: Env, name: string, email: string): Promise<void> {
  const admins = await env.DB.prepare(`SELECT email FROM users WHERE role = 'admin' AND status = 'active'`).all<{ email: string }>();
  const settings = await loadSettings(env);
  for (const admin of admins.results) {
    const { html, text } = renderEmail({
      orgName: settings.orgName,
      heading: 'New member waiting for approval',
      intro: `${name} (${email}) has created an account and needs approval before they can book.`,
      ctaLabel: 'Review the account',
      ctaUrl: env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/admin` : undefined,
      footer: `Sent by ${settings.orgName}.`,
    });
    await sendEmail(env, { to: admin.email, subject: `New member: ${name}`, html, text });
  }
}

authRoutes.post('/signup', async (c) => {
  const body = await readBody(c);
  const name = String(body.name ?? '').trim().slice(0, 80);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const phone = body.phone ? normalizePhone(String(body.phone)) : null;

  if (name.length < 2) return c.json({ error: 'Please enter your name.' }, 400);
  if (!EMAIL_RE.test(email)) return c.json({ error: 'Please enter a valid email address.' }, 400);
  if (password.length < 8) return c.json({ error: 'Passwords must be at least 8 characters.' }, 400);
  if (phone && phone.replace(/\D/g, '').length < 6) return c.json({ error: 'Please enter a valid phone number.' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'An account with that email already exists. Try signing in.' }, 409);

  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const isFirstUser = Number(total?.n ?? 0) === 0;
  const isAdmin = isFirstUser || adminEmails(c.env).includes(email);
  const settings = await loadSettings(c.env);
  const status = isAdmin || !settings.requireApproval ? 'active' : 'pending';

  const { hash, salt } = await hashPassword(password);
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, phone, password_hash, password_salt, role, status, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, email, name, phone, hash, salt, isAdmin ? 'admin' : 'user', status, nowISO(), nowISO())
    .run();

  await createSession(c, id);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  const me = await loadMe(c.env, mapUser(user));

  if (status === 'pending') {
    c.executionCtx.waitUntil(notifyAdminsOfSignup(c.env, name, email).catch((error) => console.error(error)));
  }

  return c.json({ me, firstUser: isFirstUser }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await readBody(c);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!EMAIL_RE.test(email) || !password) return c.json({ error: 'Enter your email and password.' }, 400);

  const key = `login:${email}`;
  if (await tooManyAttempts(c.env, key)) {
    return c.json({ error: 'Too many attempts. Please try again in 15 minutes.' }, 429);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<any>();
  const valid = user ? await verifyPassword(password, user.password_hash ?? null, user.password_salt ?? null) : false;
  if (!user || !valid) {
    await recordFailure(c.env, key);
    return c.json({ error: 'Email or password is incorrect.' }, 401);
  }

  await clearFailures(c.env, key);
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowISO(), user.id).run();
  await createSession(c, user.id);
  return c.json({ me: await loadMe(c.env, mapUser({ ...user, last_login_at: nowISO() })) });
});

authRoutes.post('/logout', async (c) => {
  await clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ me: null }, 200);
  return c.json({ me: await loadMe(c.env, user) });
});

authRoutes.get('/google/start', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.redirect('/login?error=google_not_configured');
  }
  const state = randomToken(16);
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  });

  const origin = new URL(c.req.url).origin;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${origin}/api/auth/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return c.redirect(url.toString());
});

authRoutes.get('/google/callback', async (c) => {
  const url = new URL(c.req.url);
  if (url.searchParams.get('error')) return c.redirect('/login?error=google_cancelled');

  const state = url.searchParams.get('state');
  const cookieState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' });
  if (!state || !cookieState || state !== cookieState) return c.redirect('/login?error=google_state');

  const code = url.searchParams.get('code');
  if (!code) return c.redirect('/login?error=google_code');
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return c.redirect('/login?error=google_not_configured');

  try {
    const tokens = await exchangeGoogleCode({
      code,
      clientId: c.env.GOOGLE_CLIENT_ID,
      clientSecret: c.env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${url.origin}/api/auth/google/callback`,
    });
    const profile = await verifyGoogleIdToken(tokens.id_token, c.env.GOOGLE_CLIENT_ID);
    const email = profile.email.toLowerCase();

    let user = await c.env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(profile.sub).first<any>();
    if (!user) user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<any>();

    if (user) {
      await c.env.DB.prepare(
        `UPDATE users SET google_sub = COALESCE(google_sub, ?), avatar_url = COALESCE(?, avatar_url), last_login_at = ? WHERE id = ?`,
      )
        .bind(profile.sub, profile.picture ?? null, nowISO(), user.id)
        .run();
      await createSession(c, user.id);
      return c.redirect('/');
    }

    const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    const isFirstUser = Number(total?.n ?? 0) === 0;
    const isAdmin = isFirstUser || adminEmails(c.env).includes(email);
    const settings = await loadSettings(c.env);
    const status = isAdmin || !settings.requireApproval ? 'active' : 'pending';
    const id = uid();

    await c.env.DB.prepare(
      `INSERT INTO users (id, email, name, google_sub, avatar_url, role, status, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        email,
        (profile.name ?? email.split('@')[0]).slice(0, 80),
        profile.sub,
        profile.picture ?? null,
        isAdmin ? 'admin' : 'user',
        status,
        nowISO(),
        nowISO(),
      )
      .run();

    await createSession(c, id);
    if (status === 'pending') {
      c.executionCtx.waitUntil(notifyAdminsOfSignup(c.env, profile.name ?? email, email).catch((error) => console.error(error)));
    }
    return c.redirect('/');
  } catch (error) {
    console.error('[google]', error);
    return c.redirect('/login?error=google_failed');
  }
});
