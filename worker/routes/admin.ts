import { Hono } from 'hono';
import type { AppBindings } from '../env';
import { requireActive, requireAdmin, hashPassword } from '../lib/auth';
import { loadSettings, saveSettings } from '../lib/settings';
import { bookingToJson, itemToJson, mapUser, overridesFromRow } from '../lib/map';
import { runReminderSweep } from '../lib/cron';
import { renderEmail, sendEmail } from '../lib/email';
import { storeUpload } from '../lib/storage';
import { readBody } from '../lib/http';
import { isMediaType, mediaExtension, normalizePhone, nowISO, nullableInt, uid } from '../lib/util';
import { addDays, ISO_DATE, startOfMonth, todayInTz } from '../../shared/dates';

export const adminRoutes = new Hono<AppBindings>();

adminRoutes.use('*', requireActive, requireAdmin);

const ADMIN_BOOKING_SELECT = `
  SELECT b.*, i.name AS item_name, u.name AS user_name, u.email AS user_email,
    (SELECT COUNT(*) FROM reports r WHERE r.booking_id = b.id AND r.kind = 'start') AS has_start,
    (SELECT COUNT(*) FROM reports r WHERE r.booking_id = b.id AND r.kind = 'end') AS has_end,
    (SELECT COUNT(*) FROM returns rt WHERE rt.booking_id = b.id) AS has_address
  FROM bookings b
  JOIN items i ON i.id = b.item_id
  JOIN users u ON u.id = b.user_id
`;

// ---------------------------------------------------------------- users ----

adminRoutes.get('/users', async (c) => {
  const [users, access] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status = 'confirmed') AS booking_count
       FROM users u ORDER BY u.created_at DESC`,
    ).all<any>(),
    c.env.DB.prepare('SELECT user_id, item_id FROM item_access').all<any>(),
  ]);

  const byUser = new Map<string, string[]>();
  for (const row of access.results) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row.item_id);
    byUser.set(row.user_id, list);
  }

  return c.json({
    users: users.results.map((row) => ({
      ...mapUser(row),
      itemIds: byUser.get(row.id) ?? [],
      bookingCount: Number(row.booking_count ?? 0),
    })),
  });
});

adminRoutes.patch('/users/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readBody(c);
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!target) return c.json({ error: 'User not found.' }, 404);

  const role = body.role === 'admin' || body.role === 'user' ? body.role : target.role;
  const status =
    body.status === 'pending' || body.status === 'active' || body.status === 'suspended' ? body.status : target.status;
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : target.name;
  const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : target.phone;

  const adminCount = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).first<{ n: number }>();
  const lastAdmin = Number(adminCount?.n ?? 0) <= 1 && target.role === 'admin';
  if (lastAdmin && role !== 'admin') return c.json({ error: 'There must always be at least one admin.' }, 400);
  if (lastAdmin && status !== 'active') return c.json({ error: 'The last admin cannot be suspended.' }, 400);

  await c.env.DB.prepare('UPDATE users SET role = ?, status = ?, name = ?, phone = ? WHERE id = ?')
    .bind(role, status, name, phone || null, id)
    .run();

  if (status === 'active' && target.status !== 'active') {
    const settings = await loadSettings(c.env);
    const { html, text } = renderEmail({
      orgName: settings.orgName,
      heading: 'Your account is approved',
      intro: `Hi ${name}, you can now book shared items.`,
      ctaLabel: 'Open the booking calendar',
      ctaUrl: c.env.APP_URL,
      footer: `Sent by ${settings.orgName}.`,
    });
    c.executionCtx.waitUntil(sendEmail(c.env, { to: target.email, subject: 'Your booking account is approved', html, text }));
  }

  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  return c.json({ user: mapUser(row) });
});

adminRoutes.put('/users/:id/access', async (c) => {
  const id = c.req.param('id');
  const body = await readBody(c);
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((value: unknown) => typeof value === 'string') : [];

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!target) return c.json({ error: 'User not found.' }, 404);

  const statements = [c.env.DB.prepare('DELETE FROM item_access WHERE user_id = ?').bind(id)];
  for (const itemId of itemIds) {
    statements.push(c.env.DB.prepare('INSERT OR IGNORE INTO item_access (item_id, user_id) VALUES (?, ?)').bind(itemId, id));
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true, itemIds });
});

adminRoutes.post('/users/:id/password', async (c) => {
  const id = c.req.param('id');
  const body = await readBody(c);
  const password = String(body.password ?? '');
  if (password.length < 8) return c.json({ error: 'Passwords must be at least 8 characters.' }, 400);
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!target) return c.json({ error: 'User not found.' }, 404);

  const { hash, salt } = await hashPassword(password);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').bind(hash, salt, id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

adminRoutes.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  if (id === user.id) return c.json({ error: 'You cannot delete your own account.' }, 400);

  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!target) return c.json({ error: 'User not found.' }, 404);

  const bookings = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?').bind(id).first<{ n: number }>();
  if (Number(bookings?.n ?? 0) > 0) {
    return c.json({ error: 'This user has booking history. Suspend them instead, or delete their bookings first.' }, 409);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM item_access WHERE user_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- items ----

adminRoutes.get('/items', async (c) => {
  const settings = await loadSettings(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT i.*, (SELECT COUNT(*) FROM bookings b WHERE b.item_id = i.id) AS booking_count FROM items i ORDER BY i.name`,
  ).all<any>();
  return c.json({
    items: rows.results.map((row) => ({
      ...itemToJson(row, settings),
      archivedBookingCount: Number(row.booking_count ?? 0),
    })),
  });
});

adminRoutes.post('/items', async (c) => {
  const body = await readBody(c);
  const name = String(body.name ?? '').trim().slice(0, 80);
  if (name.length < 2) return c.json({ error: 'Give the item a name.' }, 400);

  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO items (id, name, description, category, active, max_days, max_bookings_per_period, period_days, min_gap_days, advance_days, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      name,
      body.description ? String(body.description).slice(0, 1000) : null,
      body.category ? String(body.category).slice(0, 40) : null,
      nullableInt(body.maxDays),
      nullableInt(body.maxBookingsPerPeriod),
      nullableInt(body.periodDays),
      nullableInt(body.minGapDays),
      nullableInt(body.advanceDays),
      nowISO(),
    )
    .run();

  const settings = await loadSettings(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<any>();
  return c.json({ item: { ...itemToJson(row, settings), archivedBookingCount: 0 } }, 201);
});

adminRoutes.patch('/items/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readBody(c);
  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<any>();
  if (!item) return c.json({ error: 'Item not found.' }, 404);

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : item.name;
  const description =
    typeof body.description === 'string' ? body.description.slice(0, 1000) : item.description;
  const category = typeof body.category === 'string' ? body.category.slice(0, 40) : item.category;
  const active = typeof body.active === 'boolean' ? (body.active ? 1 : 0) : item.active;

  const override = (key: string, current: number | null) => (key in body ? nullableInt(body[key]) : current);

  await c.env.DB.prepare(
    `UPDATE items SET name = ?, description = ?, category = ?, active = ?,
       max_days = ?, max_bookings_per_period = ?, period_days = ?, min_gap_days = ?, advance_days = ?
     WHERE id = ?`,
  )
    .bind(
      name,
      description ?? null,
      category ?? null,
      active,
      override('maxDays', item.max_days),
      override('maxBookingsPerPeriod', item.max_bookings_per_period),
      override('periodDays', item.period_days),
      override('minGapDays', item.min_gap_days),
      override('advanceDays', item.advance_days),
      id,
    )
    .run();

  const settings = await loadSettings(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<any>();
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM bookings WHERE item_id = ?').bind(id).first<{ n: number }>();
  return c.json({ item: { ...itemToJson(row, settings), archivedBookingCount: Number(count?.n ?? 0) } });
});

adminRoutes.delete('/items/:id', async (c) => {
  const id = c.req.param('id');
  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<any>();
  if (!item) return c.json({ error: 'Item not found.' }, 404);

  const bookings = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM bookings WHERE item_id = ?').bind(id).first<{ n: number }>();
  if (Number(bookings?.n ?? 0) > 0) {
    await c.env.DB.prepare('UPDATE items SET active = 0 WHERE id = ?').bind(id).run();
    return c.json({ archived: true, message: 'This item has booking history, so it was retired instead of deleted.' });
  }

  if (item.photo_key) await c.env.MEDIA.delete(item.photo_key);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM item_access WHERE item_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id),
  ]);
  return c.json({ archived: false, ok: true });
});

adminRoutes.post('/items/:id/photo', async (c) => {
  const id = c.req.param('id');
  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<any>();
  if (!item) return c.json({ error: 'Item not found.' }, 404);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'Upload a photo with the form.' }, 400);
  }
  const file = form.get('photo');
  if (!(file instanceof File)) return c.json({ error: 'Choose a photo to upload.' }, 400);

  try {
    const stored = await storeUpload(c.env, file, `items/${id}`, { imagesOnly: true, maxBytes: 12 * 1024 * 1024 });
    await c.env.DB.prepare('UPDATE items SET photo_key = ? WHERE id = ?').bind(stored.key, id).run();
    if (item.photo_key) await c.env.MEDIA.delete(item.photo_key);
    return c.json({ ok: true, photoKey: stored.key });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Upload failed.' }, 400);
  }
});

adminRoutes.delete('/items/:id/photo', async (c) => {
  const id = c.req.param('id');
  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<any>();
  if (!item) return c.json({ error: 'Item not found.' }, 404);
  if (item.photo_key) await c.env.MEDIA.delete(item.photo_key);
  await c.env.DB.prepare('UPDATE items SET photo_key = NULL WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// -------------------------------------------------------------- bookings ---

adminRoutes.get('/bookings', async (c) => {
  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);
  const filters: string[] = [];
  const params: unknown[] = [];

  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const itemId = c.req.query('itemId') ?? '';
  const userId = c.req.query('userId') ?? '';
  const status = c.req.query('status') ?? '';

  if (ISO_DATE.test(from)) {
    filters.push('b.end_date >= ?');
    params.push(from);
  }
  if (ISO_DATE.test(to)) {
    filters.push('b.start_date <= ?');
    params.push(to);
  }
  if (itemId) {
    filters.push('b.item_id = ?');
    params.push(itemId);
  }
  if (userId) {
    filters.push('b.user_id = ?');
    params.push(userId);
  }
  if (status === 'confirmed' || status === 'cancelled') {
    filters.push('b.status = ?');
    params.push(status);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const statement = c.env.DB.prepare(`${ADMIN_BOOKING_SELECT} ${where} ORDER BY b.start_date DESC LIMIT 400`).bind(...params);
  const rows = await statement.all<any>();
  return c.json({ today, bookings: rows.results.map((row) => bookingToJson(row, today)) });
});

adminRoutes.post('/bookings', async (c) => {
  const admin = c.get('user');
  const body = await readBody(c);
  const itemId = String(body.itemId ?? '');
  const userId = String(body.userId ?? admin.id);
  const start = String(body.startDate ?? '');
  const end = String(body.endDate ?? '');
  const notes = body.notes ? String(body.notes).slice(0, 1000) : null;

  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return c.json({ error: 'Pick valid dates.' }, 400);
  if (end < start) return c.json({ error: 'The end date must be on or after the start date.' }, 400);

  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first<any>();
  if (!item) return c.json({ error: 'Item not found.' }, 404);
  const member = await c.env.DB.prepare('SELECT id, status FROM users WHERE id = ?').bind(userId).first<any>();
  if (!member) return c.json({ error: 'Member not found.' }, 404);

  const conflict = await c.env.DB.prepare(
    `SELECT b.id, b.start_date, b.end_date, u.name AS user_name FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.item_id = ? AND b.status = 'confirmed' AND b.start_date <= ? AND b.end_date >= ? LIMIT 1`,
  )
    .bind(itemId, end, start)
    .first<any>();
  if (conflict) {
    return c.json(
      { error: `Overlaps ${conflict.user_name}'s booking (${conflict.start_date} to ${conflict.end_date}).` },
      400,
    );
  }

  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO bookings (id, item_id, user_id, start_date, end_date, status, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
  )
    .bind(id, itemId, userId, start, end, notes, admin.id, nowISO())
    .run();

  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);
  const row = await c.env.DB.prepare(`${ADMIN_BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<any>();
  return c.json({ booking: bookingToJson(row, today) }, 201);
});

adminRoutes.patch('/bookings/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readBody(c);
  const booking = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<any>();
  if (!booking) return c.json({ error: 'Booking not found.' }, 404);

  const itemId = typeof body.itemId === 'string' && body.itemId ? body.itemId : booking.item_id;
  const userId = typeof body.userId === 'string' && body.userId ? body.userId : booking.user_id;
  const start = ISO_DATE.test(String(body.startDate ?? '')) ? String(body.startDate) : booking.start_date;
  const end = ISO_DATE.test(String(body.endDate ?? '')) ? String(body.endDate) : booking.end_date;
  const status = body.status === 'cancelled' || body.status === 'confirmed' ? body.status : booking.status;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : booking.notes;

  if (end < start) return c.json({ error: 'The end date must be on or after the start date.' }, 400);

  if (status === 'confirmed') {
    const conflict = await c.env.DB.prepare(
      `SELECT b.id, b.start_date, b.end_date, u.name AS user_name FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.item_id = ? AND b.id <> ? AND b.status = 'confirmed' AND b.start_date <= ? AND b.end_date >= ? LIMIT 1`,
    )
      .bind(itemId, id, end, start)
      .first<any>();
    if (conflict) {
      return c.json(
        { error: `Overlaps ${conflict.user_name}'s booking (${conflict.start_date} to ${conflict.end_date}).` },
        400,
      );
    }
  }

  await c.env.DB.prepare(
    `UPDATE bookings SET item_id = ?, user_id = ?, start_date = ?, end_date = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(itemId, userId, start, end, status, notes, nowISO(), id)
    .run();

  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);
  const row = await c.env.DB.prepare(`${ADMIN_BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<any>();
  return c.json({ booking: bookingToJson(row, today) });
});

adminRoutes.delete('/bookings/:id', async (c) => {
  const id = c.req.param('id');
  const booking = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<any>();
  if (!booking) return c.json({ error: 'Booking not found.' }, 404);

  const reports = await c.env.DB.prepare('SELECT media_key FROM reports WHERE booking_id = ?').bind(id).all<{ media_key: string }>();
  for (const report of reports.results) await c.env.MEDIA.delete(report.media_key);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM reports WHERE booking_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM returns WHERE booking_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM reminders WHERE booking_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// --------------------------------------------------------- reports & logs --

adminRoutes.get('/reports', async (c) => {
  const [reports, returns] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.*, i.name AS item_name, u.name AS user_name, b.start_date, b.end_date
       FROM reports r
       JOIN items i ON i.id = r.item_id
       JOIN users u ON u.id = r.user_id
       JOIN bookings b ON b.id = r.booking_id
       ORDER BY r.created_at DESC LIMIT 200`,
    ).all<any>(),
    c.env.DB.prepare(
      `SELECT rt.*, i.name AS item_name, u.name AS user_name, b.start_date, b.end_date
       FROM returns rt
       JOIN bookings b ON b.id = rt.booking_id
       JOIN items i ON i.id = b.item_id
       JOIN users u ON u.id = rt.user_id
       ORDER BY rt.created_at DESC LIMIT 200`,
    ).all<any>(),
  ]);

  return c.json({
    reports: reports.results.map((row) => ({
      id: row.id,
      bookingId: row.booking_id,
      itemId: row.item_id,
      itemName: row.item_name,
      userId: row.user_id,
      userName: row.user_name,
      kind: row.kind,
      mediaKey: row.media_key,
      mediaType: row.media_type,
      notes: row.notes ?? null,
      createdAt: row.created_at,
      startDate: row.start_date,
      endDate: row.end_date,
    })),
    returns: returns.results.map((row) => ({
      bookingId: row.booking_id,
      address: row.address,
      notes: row.notes ?? null,
      createdAt: row.created_at,
      userName: row.user_name,
      itemName: row.item_name,
      startDate: row.start_date,
      endDate: row.end_date,
    })),
  });
});

// -------------------------------------------------------------- settings ---

adminRoutes.get('/settings', async (c) => {
  return c.json({ settings: await loadSettings(c.env) });
});

adminRoutes.put('/settings', async (c) => {
  const body = await readBody(c);
  const settings = await saveSettings(c.env, body);
  return c.json({ settings });
});

adminRoutes.post('/run-reminders', async (c) => {
  const summary = await runReminderSweep(c.env);
  return c.json({ summary });
});
