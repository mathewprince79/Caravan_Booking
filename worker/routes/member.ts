import { Hono } from 'hono';
import type { AppBindings } from '../env';
import { requireActive, requireUser } from '../lib/auth';
import { loadSettings } from '../lib/settings';
import { bookingSummary, bookingToJson, itemToJson, lastUsedFromRow, mapUser } from '../lib/map';
import { bookingsInWindow, validateBooking } from '../lib/rules';
import { loadMe } from '../lib/me';
import { storeUpload } from '../lib/storage';
import { readBody } from '../lib/http';
import { normalizePhone, nowISO, uid } from '../lib/util';
import { addDays, addMonths, formatDate, ISO_DATE, startOfMonth, todayInTz } from '../../shared/dates';

export const memberRoutes = new Hono<AppBindings>();

const BOOKING_SELECT = `
  SELECT b.*, i.name AS item_name, u.name AS user_name,
    (SELECT COUNT(*) FROM reports r WHERE r.booking_id = b.id AND r.kind = 'start') AS has_start,
    (SELECT COUNT(*) FROM reports r WHERE r.booking_id = b.id AND r.kind = 'end') AS has_end,
    (SELECT COUNT(*) FROM returns rt WHERE rt.booking_id = b.id) AS has_address
  FROM bookings b
  JOIN items i ON i.id = b.item_id
  JOIN users u ON u.id = b.user_id
`;

memberRoutes.get('/me', requireUser, async (c) => {
  return c.json({ me: await loadMe(c.env, c.get('user')) });
});

memberRoutes.patch('/me', requireUser, async (c) => {
  const user = c.get('user');
  const body = await readBody(c);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : user.name;
  const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : user.phone;

  if (phone && phone.replace(/\D/g, '').length < 6) {
    return c.json({ error: 'Please enter a valid phone number.' }, 400);
  }

  await c.env.DB.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').bind(name, phone ?? null, user.id).run();
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<any>();
  return c.json({ me: await loadMe(c.env, mapUser(row)) });
});

memberRoutes.get('/config', async (c) => {
  const settings = await loadSettings(c.env);
  return c.json({
    orgName: settings.orgName,
    timezone: settings.timezone,
    googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    emailEnabled: Boolean(c.env.RESEND_API_KEY),
    approvalRequired: settings.requireApproval,
  });
});

memberRoutes.get('/items', requireActive, async (c) => {
  const user = c.get('user');
  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);

  const [items, access, current, last] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM items WHERE active = 1 ORDER BY name').all<any>(),
    c.env.DB.prepare('SELECT item_id FROM item_access WHERE user_id = ?').bind(user.id).all<any>(),
    c.env.DB.prepare(
      `SELECT b.id, b.item_id, b.user_id, b.start_date, b.end_date, b.status, u.name AS user_name
       FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.status = 'confirmed' AND b.start_date <= ? AND b.end_date >= ?`,
    )
      .bind(today, today)
      .all<any>(),
    c.env.DB.prepare(
      `SELECT item_id, user_id, user_name, start_date, end_date FROM (
         SELECT b.item_id, b.user_id, u.name AS user_name, b.start_date, b.end_date,
                ROW_NUMBER() OVER (PARTITION BY b.item_id ORDER BY b.end_date DESC, b.created_at DESC) AS rn
         FROM bookings b JOIN users u ON u.id = b.user_id
         WHERE b.status = 'confirmed' AND b.end_date < ?
       ) WHERE rn = 1`,
    )
      .bind(today)
      .all<any>(),
  ]);

  const allowed = new Set(access.results.map((row) => row.item_id));
  const currentByItem = new Map(current.results.map((row) => [row.item_id, bookingSummary(row)]));
  const lastByItem = new Map(last.results.map((row) => [row.item_id, lastUsedFromRow(row)]));
  const isAdmin = user.role === 'admin';

  const list = items.results.map((row) => {
    const item = itemToJson(row, settings);
    item.canBook = isAdmin || allowed.has(row.id);
    item.currentBooking = currentByItem.get(row.id) ?? null;
    item.lastUsed = lastByItem.get(row.id) ?? null;
    return item;
  });

  return c.json({
    today,
    items: isAdmin ? list : list.filter((item) => item.canBook),
    allItemsCount: items.results.length,
  });
});

memberRoutes.get('/items/:id', requireActive, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);

  const row = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'That item could not be found.' }, 404);

  const isAdmin = user.role === 'admin';
  const granted = isAdmin
    ? true
    : Boolean(await c.env.DB.prepare('SELECT 1 AS ok FROM item_access WHERE item_id = ? AND user_id = ?').bind(id, user.id).first());
  if (!granted) {
    return c.json({ error: 'You do not have access to this item yet. Ask an admin to grant it.' }, 403);
  }

  const fromParam = c.req.query('from') ?? '';
  const toParam = c.req.query('to') ?? '';
  const from = ISO_DATE.test(fromParam) ? fromParam : startOfMonth(today);
  const to = ISO_DATE.test(toParam) ? toParam : addDays(startOfMonth(addMonths(today, 2)), -1);

  const [bookings, myBookings, current, last] = await Promise.all([
    bookingsInWindow(c.env, id, from, to),
    c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.user_id = ? AND b.item_id = ? ORDER BY b.start_date DESC LIMIT 30`)
      .bind(user.id, id)
      .all<any>(),
    c.env.DB.prepare(
      `SELECT b.id, b.item_id, b.user_id, b.start_date, b.end_date, b.status, u.name AS user_name
       FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.item_id = ? AND b.status = 'confirmed' AND b.start_date <= ? AND b.end_date >= ? LIMIT 1`,
    )
      .bind(id, today, today)
      .first<any>(),
    c.env.DB.prepare(
      `SELECT b.item_id, b.user_id, u.name AS user_name, b.start_date, b.end_date
       FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.item_id = ? AND b.status = 'confirmed' AND b.end_date < ?
       ORDER BY b.end_date DESC, b.created_at DESC LIMIT 1`,
    )
      .bind(id, today)
      .first<any>(),
  ]);

  const item = itemToJson(row, settings);
  item.canBook = true;
  item.currentBooking = current ? bookingSummary(current) : null;
  item.lastUsed = lastUsedFromRow(last);

  return c.json({
    item,
    today,
    bookings: bookings.map((booking) => bookingSummary(booking)),
    myBookings: myBookings.results.map((booking) => bookingToJson(booking, today)),
  });
});

memberRoutes.post('/items/:id/bookings', requireActive, async (c) => {
  const user = c.get('user');
  const itemId = c.req.param('id');
  const body = await readBody(c);
  const start = String(body.startDate ?? '');
  const end = String(body.endDate ?? '');
  const notes = body.notes ? String(body.notes).slice(0, 1000) : null;

  const row = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first<any>();
  if (!row) return c.json({ error: 'That item could not be found.' }, 404);

  const isAdmin = user.role === 'admin';
  if (!isAdmin) {
    const granted = await c.env.DB.prepare('SELECT 1 AS ok FROM item_access WHERE item_id = ? AND user_id = ?')
      .bind(itemId, user.id)
      .first();
    if (!granted) return c.json({ error: 'You do not have access to this item yet.' }, 403);
  }

  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);
  const problem = await validateBooking(c.env, { item: row, userId: user.id, start, end, today, isAdmin });
  if (problem) return c.json({ error: problem }, 400);

  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO bookings (id, item_id, user_id, start_date, end_date, status, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
  )
    .bind(id, itemId, user.id, start, end, notes, user.id, nowISO())
    .run();

  const created = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<any>();
  return c.json({ booking: bookingToJson(created, today) }, 201);
});

memberRoutes.get('/my-bookings', requireActive, async (c) => {
  const user = c.get('user');
  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);
  const rows = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.user_id = ? ORDER BY b.start_date DESC LIMIT 120`)
    .bind(user.id)
    .all<any>();
  return c.json({ today, bookings: rows.results.map((row) => bookingToJson(row, today)) });
});

memberRoutes.post('/bookings/:id/cancel', requireActive, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);

  const booking = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<any>();
  if (!booking) return c.json({ error: 'Booking not found.' }, 404);
  if (booking.user_id !== user.id && user.role !== 'admin') return c.json({ error: 'You cannot change that booking.' }, 403);
  if (booking.status === 'cancelled') return c.json({ error: 'That booking is already cancelled.' }, 400);
  if (user.role !== 'admin' && booking.start_date <= today) {
    return c.json({ error: 'Bookings that have already started can only be cancelled by an admin.' }, 400);
  }

  await c.env.DB.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?`).bind(nowISO(), id).run();
  return c.json({ ok: true });
});

memberRoutes.post('/bookings/:id/report', requireActive, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);

  const booking = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<any>();
  if (!booking) return c.json({ error: 'Booking not found.' }, 404);
  if (booking.user_id !== user.id && user.role !== 'admin') return c.json({ error: 'You cannot add a report to that booking.' }, 403);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'Attach a photo or video with the form.' }, 400);
  }

  const kind = String(form.get('kind') ?? '');
  if (kind !== 'start' && kind !== 'end') return c.json({ error: 'Choose the start or end report.' }, 400);

  const file = form.get('media');
  if (!(file instanceof File)) return c.json({ error: 'Attach a photo or video.' }, 400);

  if (user.role !== 'admin') {
    if (kind === 'start' && today < booking.start_date) {
      return c.json({ error: `The start report opens on ${formatDate(booking.start_date)}.` }, 400);
    }
    if (kind === 'end' && today < booking.end_date) {
      return c.json({ error: `The end report opens on ${formatDate(booking.end_date)}.` }, 400);
    }
  }

  let stored: { key: string; type: string };
  try {
    stored = await storeUpload(c.env, file, `reports/${booking.id}`);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Upload failed.' }, 400);
  }

  const notes = form.get('notes') ? String(form.get('notes')).slice(0, 1000) : null;
  const existing = await c.env.DB.prepare('SELECT id, media_key FROM reports WHERE booking_id = ? AND kind = ?')
    .bind(booking.id, kind)
    .first<any>();

  if (existing) {
    await c.env.DB.prepare('UPDATE reports SET media_key = ?, media_type = ?, notes = ?, created_at = ? WHERE id = ?')
      .bind(stored.key, stored.type, notes, nowISO(), existing.id)
      .run();
    await c.env.MEDIA.delete(existing.media_key);
  } else {
    await c.env.DB.prepare(
      `INSERT INTO reports (id, booking_id, item_id, user_id, kind, media_key, media_type, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(uid(), booking.id, booking.item_id, booking.user_id, kind, stored.key, stored.type, notes, nowISO())
      .run();
  }

  return c.json({ ok: true, mediaKey: stored.key });
});

memberRoutes.post('/bookings/:id/address', requireActive, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await readBody(c);
  const address = String(body.address ?? '').trim().slice(0, 400);
  const notes = body.notes ? String(body.notes).slice(0, 400) : null;
  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);

  const booking = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<any>();
  if (!booking) return c.json({ error: 'Booking not found.' }, 404);
  if (booking.user_id !== user.id && user.role !== 'admin') return c.json({ error: 'You cannot change that booking.' }, 403);
  if (address.length < 5) return c.json({ error: 'Please enter the full parking address.' }, 400);
  if (user.role !== 'admin' && booking.end_date > today) {
    return c.json({ error: 'You can add the parking address once the booking has finished.' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM returns WHERE booking_id = ?').bind(booking.id).first<any>();
  if (existing) {
    await c.env.DB.prepare('UPDATE returns SET address = ?, notes = ?, created_at = ? WHERE id = ?')
      .bind(address, notes, nowISO(), existing.id)
      .run();
  } else {
    await c.env.DB.prepare('INSERT INTO returns (id, booking_id, user_id, address, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(uid(), booking.id, booking.user_id, address, notes, nowISO())
      .run();
  }

  return c.json({ ok: true });
});

memberRoutes.get('/media/*', requireActive, async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/media\//, ''));
  if (!key) return c.json({ error: 'Not found' }, 404);
  const stored = await c.env.MEDIA.getWithMetadata<{ contentType?: string }>(key, 'arrayBuffer', {
    cacheTtl: 3600,
  });
  if (!stored.value) return c.json({ error: 'Not found' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', stored.metadata?.contentType ?? 'application/octet-stream');
  headers.set('Content-Length', String(stored.value.byteLength));
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(stored.value, { headers });
});
