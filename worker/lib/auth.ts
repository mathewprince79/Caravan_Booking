import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppBindings, Env } from '../env';
import type { User } from '../../shared/types';
import { fromBase64Url, nowISO, randomToken, sha256Hex, toBase64Url } from './util';
import { mapUser } from './map';

export const SESSION_COOKIE = 'cb_session';
export const OAUTH_STATE_COOKIE = 'cb_oauth_state';
const SESSION_DAYS = 30;

// Cloudflare's free plan allows 10ms of CPU per request, so PBKDF2 stays modest.
// Raise PBKDF2_ITERATIONS if you move to a paid plan.
const PBKDF2_ITERATIONS = 12_000;

export function isHttps(c: Context<AppBindings>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt ? fromBase64Url(salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes as unknown as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: toBase64Url(new Uint8Array(bits)), salt: salt ?? toBase64Url(saltBytes) };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, hash: string | null, salt: string | null): Promise<boolean> {
  if (!hash || !salt) return false;
  const candidate = await hashPassword(password, salt);
  return timingSafeEqual(candidate.hash, hash);
}

export async function createSession(c: Context<AppBindings>, userId: string): Promise<string> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(id, userId, nowISO(), expires, (c.req.header('user-agent') ?? '').slice(0, 200))
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
  return token;
}

export async function getSessionUser(c: Context<AppBindings>): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(id, nowISO())
    .first<any>();
  if (!row) return null;
  return mapUser(row);
}

export const requireUser = createMiddleware<AppBindings>(async (c, next) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Please sign in to continue.', code: 'unauthenticated' }, 401);
  c.set('user', user);
  await next();
});

export const requireActive = createMiddleware<AppBindings>(async (c, next) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Please sign in to continue.', code: 'unauthenticated' }, 401);
  if (user.status !== 'active') {
    return c.json({ error: 'Your account is waiting for admin approval.', code: user.status }, 403);
  }
  c.set('user', user);
  await next();
});

export const requireAdmin = createMiddleware<AppBindings>(async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Please sign in to continue.', code: 'unauthenticated' }, 401);
  if (user.role !== 'admin' || user.status !== 'active') {
    return c.json({ error: 'Admin access required.', code: 'forbidden' }, 403);
  }
  await next();
});

export async function clearSessionCookie(c: Context<AppBindings>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const id = await sha256Hex(token);
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
  }
  setCookie(c, SESSION_COOKIE, '', { httpOnly: true, secure: isHttps(c), sameSite: 'Lax', path: '/', maxAge: 0 });
}

// ---- login throttling -------------------------------------------------------

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export async function tooManyAttempts(env: Env, key: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT count, first_at FROM auth_attempts WHERE key = ?').bind(key).first<any>();
  if (!row) return false;
  if (Date.now() - Date.parse(row.first_at) > WINDOW_MS) {
    await env.DB.prepare('DELETE FROM auth_attempts WHERE key = ?').bind(key).run();
    return false;
  }
  return Number(row.count) >= MAX_ATTEMPTS;
}

export async function recordFailure(env: Env, key: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO auth_attempts (key, count, first_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1`,
  )
    .bind(key, nowISO())
    .run();
}

export async function clearFailures(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM auth_attempts WHERE key = ?').bind(key).run();
}
