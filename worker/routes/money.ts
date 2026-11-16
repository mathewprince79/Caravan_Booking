import { Hono } from 'hono';
import type { AppBindings } from '../env';
import { requireActive } from '../lib/auth';
import { readBody } from '../lib/http';
import { nowISO, uid } from '../lib/util';
import { loadSettings } from '../lib/settings';
import { ISO_DATE, todayInTz } from '../../shared/dates';
import { computeBalances, formatMoney, simplifyDebts, splitCents } from '../../shared/money';
import type {
  ItemLedger,
  LedgerBalance,
  LedgerEntry,
  LedgerObligation,
  MoneySummary,
  User,
} from '../../shared/types';

export const moneyRoutes = new Hono<AppBindings>();

const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000
const MAX_LEDGER_ITEMS = 50;
const MAX_ENTRIES = 200;

const ENTRY_SELECT = `
  SELECT e.*, p.name AS paid_by_name, c.name AS created_by_name
  FROM ledger_entries e
  JOIN users p ON p.id = e.paid_by
  JOIN users c ON c.id = e.created_by
`;

/** The item's people: exactly the members an admin granted access to. */
async function loadMembers(env: AppBindings['Bindings'], itemId: string) {
  const rows = await env.DB.prepare(
    `SELECT u.id, u.name FROM item_access a JOIN users u ON u.id = a.user_id
     WHERE a.item_id = ? ORDER BY u.name`,
  )
    .bind(itemId)
    .all<{ id: string; name: string }>();
  return rows.results;
}

/** Membership only: the money side is never shown to anyone outside the item group. */
async function canSeeItem(env: AppBindings['Bindings'], user: User, itemId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM item_access WHERE item_id = ? AND user_id = ?')
    .bind(itemId, user.id)
    .first();
  return Boolean(row);
}

function memberOf(members: { id: string }[], userId: string): boolean {
  return members.some((member) => member.id === userId);
}

async function loadLedger(env: AppBindings['Bindings'], user: User, itemId: string): Promise<ItemLedger | null> {
  const item = await env.DB.prepare('SELECT id, name FROM items WHERE id = ?').bind(itemId).first<{ id: string; name: string }>();
  if (!item) return null;

  const [members, entries] = await Promise.all([
    loadMembers(env, itemId),
    env.DB.prepare(`${ENTRY_SELECT} WHERE e.item_id = ? ORDER BY e.entry_date DESC, e.created_at DESC LIMIT ${MAX_ENTRIES}`)
      .bind(itemId)
      .all<any>(),
  ]);

  const entryIds = entries.results.map((row) => row.id);
  const shareRows = entryIds.length
    ? await env.DB.prepare(
        `SELECT s.entry_id, s.user_id, s.share_cents, u.name AS user_name
         FROM ledger_shares s JOIN users u ON u.id = s.user_id
         WHERE s.entry_id IN (${entryIds.map(() => '?').join(', ')})
         ORDER BY u.name`,
      )
        .bind(...entryIds)
        .all<any>()
    : { results: [] as any[] };

  const sharesByEntry = new Map<string, { userId: string; userName: string; shareCents: number }[]>();
  for (const row of shareRows.results) {
    const list = sharesByEntry.get(row.entry_id) ?? [];
    list.push({ userId: row.user_id, userName: row.user_name, shareCents: Number(row.share_cents) });
    sharesByEntry.set(row.entry_id, list);
  }

  const mapped: LedgerEntry[] = entries.results.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    kind: row.kind === 'income' ? 'income' : row.kind === 'settlement' ? 'settlement' : 'expense',
    description: row.description,
    amountCents: Number(row.amount_cents),
    paidBy: row.paid_by,
    paidByName: row.paid_by_name,
    entryDate: row.entry_date,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    shares: sharesByEntry.get(row.id) ?? [],
  }));

  const balances: LedgerBalance[] = computeBalances(members, mapped);
  const settlements = simplifyDebts(balances);
  const mine = balances.find((balance) => balance.userId === user.id);

  return {
    itemId: item.id,
    itemName: item.name,
    members,
    entries: mapped,
    balances,
    settlements,
    myNetCents: mine?.netCents ?? 0,
    canContribute: memberOf(members, user.id),
  };
}

/** Every item the member can see, trimmed down to their own obligations. */
function obligationsFor(user: User, ledger: ItemLedger): { youOwe: LedgerObligation[]; owedToYou: LedgerObligation[] } {
  const youOwe: LedgerObligation[] = [];
  const owedToYou: LedgerObligation[] = [];

  for (const settlement of ledger.settlements) {
    if (settlement.fromUserId === user.id) {
      youOwe.push({
        itemId: ledger.itemId,
        itemName: ledger.itemName,
        userId: settlement.toUserId,
        userName: settlement.toName,
        amountCents: settlement.amountCents,
      });
    } else if (settlement.toUserId === user.id) {
      owedToYou.push({
        itemId: ledger.itemId,
        itemName: ledger.itemName,
        userId: settlement.fromUserId,
        userName: settlement.fromName,
        amountCents: settlement.amountCents,
      });
    }
  }

  return { youOwe, owedToYou };
}

async function visibleItemIds(env: AppBindings['Bindings'], user: User): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT i.id FROM item_access a JOIN items i ON i.id = a.item_id
     WHERE a.user_id = ? AND i.active = 1 ORDER BY i.name LIMIT ?`,
  )
    .bind(user.id, MAX_LEDGER_ITEMS)
    .all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

moneyRoutes.get('/', requireActive, async (c) => {
  const user = c.get('user');
  const ids = await visibleItemIds(c.env, user);

  const ledgers: ItemLedger[] = [];
  for (const id of ids) {
    const ledger = await loadLedger(c.env, user, id);
    if (ledger) ledgers.push(ledger);
  }

  const youOwe: LedgerObligation[] = [];
  const owedToYou: LedgerObligation[] = [];
  for (const ledger of ledgers) {
    const own = obligationsFor(user, ledger);
    youOwe.push(...own.youOwe);
    owedToYou.push(...own.owedToYou);
  }

  const sum = (list: LedgerObligation[]) => list.reduce((total, row) => total + row.amountCents, 0);
  const summary: MoneySummary = {
    netCents: sum(owedToYou) - sum(youOwe),
    youOwe: youOwe.sort((a, b) => b.amountCents - a.amountCents),
    owedToYou: owedToYou.sort((a, b) => b.amountCents - a.amountCents),
    items: ledgers,
  };
  return c.json(summary);
});

moneyRoutes.get('/items/:id', requireActive, async (c) => {
  const user = c.get('user');
  const itemId = c.req.param('id');
  if (!(await canSeeItem(c.env, user, itemId))) {
    return c.json({ error: 'You are not in this item group.' }, 403);
  }
  const ledger = await loadLedger(c.env, user, itemId);
  if (!ledger) return c.json({ error: 'That item could not be found.' }, 404);
  return c.json(ledger);
});

moneyRoutes.post('/items/:id', requireActive, async (c) => {
  const user = c.get('user');
  const itemId = c.req.param('id');
  if (!(await canSeeItem(c.env, user, itemId))) {
    return c.json({ error: 'You are not in this item group.' }, 403);
  }

  const item = await c.env.DB.prepare('SELECT id, name FROM items WHERE id = ?').bind(itemId).first<{ id: string; name: string }>();
  if (!item) return c.json({ error: 'That item could not be found.' }, 404);

  const members = await loadMembers(c.env, itemId);
  if (members.length === 0) {
    return c.json({ error: 'This item has no members yet, so there is nobody to split with.' }, 400);
  }
  if (!memberOf(members, user.id)) {
    return c.json({ error: 'Only members of this item group can add money to it.' }, 403);
  }

  const body = await readBody(c);
  const kind =
    body.kind === 'income'
      ? 'income'
      : body.kind === 'settlement'
        ? 'settlement'
        : body.kind === 'expense'
          ? 'expense'
          : null;
  if (!kind) return c.json({ error: 'Choose whether this is an expense, income or payment.' }, 400);

  let description = String(body.description ?? '').trim().slice(0, 120);
  if (kind !== 'settlement' && description.length < 2) {
    return c.json({ error: 'Describe what the money was for.' }, 400);
  }

  const amountCents = Math.round(Number(body.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return c.json({ error: 'Enter an amount greater than zero.' }, 400);
  }
  if (amountCents > MAX_AMOUNT_CENTS) {
    return c.json({ error: 'That amount is too large.' }, 400);
  }

  const settings = await loadSettings(c.env);
  const today = todayInTz(settings.timezone);
  const entryDate = ISO_DATE.test(String(body.entryDate ?? '')) ? String(body.entryDate) : today;

  const paidBy = String(body.paidBy ?? user.id);
  if (!memberOf(members, paidBy)) {
    return c.json({ error: 'Whoever paid must be a member of this item group.' }, 400);
  }

  let shares: { userId: string; shareCents: number }[];

  if (kind === 'settlement') {
    const toUserId = String(body.toUserId ?? '');
    const recipient = members.find((member) => member.id === toUserId);
    if (!recipient) return c.json({ error: 'Choose the member who was paid.' }, 400);
    if (recipient.id === paidBy) return c.json({ error: 'A payment needs two different people.' }, 400);

    // Only what is genuinely outstanding may be settled, so a typo cannot fling
    // the balances the other way.
    const current = await loadLedger(c.env, user, itemId);
    const owing = current?.settlements.find((row) => row.fromUserId === paidBy && row.toUserId === recipient.id);
    const payerName = members.find((member) => member.id === paidBy)?.name ?? 'That member';
    if (!owing) {
      return c.json({ error: `${payerName} does not owe ${recipient.name} anything at the moment.` }, 400);
    }
    if (amountCents > owing.amountCents) {
      return c.json({ error: `Only ${formatMoney(owing.amountCents)} is outstanding between those two.` }, 400);
    }

    description = description || `Paid ${recipient.name}`;
    shares = [{ userId: recipient.id, shareCents: amountCents }];
  } else {
    const requested: string[] = Array.isArray(body.participantIds)
      ? body.participantIds.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const participantIds = [...new Set(requested)].filter((id) => memberOf(members, id));
    if (participantIds.length === 0) {
      return c.json({ error: 'Choose at least one person to share this with.' }, 400);
    }
    shares = splitCents(amountCents, participantIds);
  }
  const id = uid();
  const created = nowISO();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO ledger_entries (id, item_id, kind, description, amount_cents, paid_by, entry_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, itemId, kind, description, amountCents, paidBy, entryDate, user.id, created),
    ...shares.map((share) =>
      c.env.DB.prepare('INSERT INTO ledger_shares (entry_id, user_id, share_cents) VALUES (?, ?, ?)').bind(
        id,
        share.userId,
        share.shareCents,
      ),
    ),
  ]);

  const ledger = await loadLedger(c.env, user, itemId);
  return c.json({ ok: true, ledger }, 201);
});

moneyRoutes.delete('/entries/:id', requireActive, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const entry = await c.env.DB.prepare('SELECT id, item_id, created_by FROM ledger_entries WHERE id = ?')
    .bind(id)
    .first<{ id: string; item_id: string; created_by: string }>();
  if (!entry) return c.json({ error: 'That entry could not be found.' }, 404);
  if (!(await canSeeItem(c.env, user, entry.item_id))) {
    return c.json({ error: 'You are not in this item group.' }, 403);
  }
  if (entry.created_by !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Only the person who added it, or an admin, can remove an entry.' }, 403);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM ledger_shares WHERE entry_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM ledger_entries WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});
