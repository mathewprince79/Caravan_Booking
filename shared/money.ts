// Money maths shared by the Worker and the React app. Everything is integer
// cents so balances always add up to zero and settlements never leak a cent.

export interface MemberLike {
  id: string;
  name: string;
}

export interface ShareLike {
  userId: string;
  shareCents: number;
}

export interface EntryLike {
  amountCents: number;
  /** A settlement is a payment from one member to another, held as a single share. */
  kind: 'expense' | 'income' | 'settlement';
  paidBy: string;
  shares: ShareLike[];
}

export interface BalanceLike {
  userId: string;
  userName: string;
  netCents: number;
}

export interface SettlementLike {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
}

/**
 * Equal split with the leftover cents handed to the first participants, so the
 * shares always total exactly the entry amount.
 */
export function splitCents(amountCents: number, userIds: string[]): ShareLike[] {
  const ids = [...new Set(userIds)].sort();
  if (ids.length === 0 || !Number.isFinite(amountCents) || amountCents <= 0) return [];
  const base = Math.floor(amountCents / ids.length);
  const remainder = amountCents - base * ids.length;
  return ids.map((userId, index) => ({ userId, shareCents: base + (index < remainder ? 1 : 0) }));
}

/**
 * Positive net = the member is owed money; negative = the member owes money.
 * An expense credits whoever paid and charges the people it was split across.
 * Income received by a member does the opposite: they are holding group money.
 */
export function computeBalances(members: MemberLike[], entries: EntryLike[]): BalanceLike[] {
  const net = new Map<string, number>();
  for (const member of members) net.set(member.id, 0);

  const add = (userId: string, cents: number) => net.set(userId, (net.get(userId) ?? 0) + cents);

  for (const entry of entries) {
    if (entry.kind === 'income') {
      add(entry.paidBy, -entry.amountCents);
      for (const share of entry.shares) add(share.userId, share.shareCents);
    } else {
      // Expenses credit whoever paid and charge the people it was split across.
      // A settlement is the same shape: the payer's debt shrinks, the recipient's
      // credit shrinks by exactly what was handed over.
      add(entry.paidBy, entry.amountCents);
      for (const share of entry.shares) add(share.userId, -share.shareCents);
    }
  }

  return members.map((member) => ({
    userId: member.id,
    userName: member.name,
    netCents: net.get(member.id) ?? 0,
  }));
}

/**
 * Splitwise-style simplification: greedily match the biggest debtor with the
 * biggest creditor, which settles any group in at most (members - 1) transfers.
 */
export function simplifyDebts(balances: BalanceLike[]): SettlementLike[] {
  const creditors = balances
    .filter((balance) => balance.netCents > 0)
    .map((balance) => ({ userId: balance.userId, userName: balance.userName, remaining: balance.netCents }))
    .sort((a, b) => b.remaining - a.remaining || a.userName.localeCompare(b.userName));

  const debtors = balances
    .filter((balance) => balance.netCents < 0)
    .map((balance) => ({ userId: balance.userId, userName: balance.userName, remaining: -balance.netCents }))
    .sort((a, b) => b.remaining - a.remaining || a.userName.localeCompare(b.userName));

  const settlements: SettlementLike[] = [];
  let debtor = 0;
  let creditor = 0;

  while (debtor < debtors.length && creditor < creditors.length) {
    const owes = debtors[debtor];
    const isOwed = creditors[creditor];
    const amount = Math.min(owes.remaining, isOwed.remaining);
    if (amount > 0) {
      settlements.push({
        fromUserId: owes.userId,
        fromName: owes.userName,
        toUserId: isOwed.userId,
        toName: isOwed.userName,
        amountCents: amount,
      });
    }
    owes.remaining -= amount;
    isOwed.remaining -= amount;
    if (owes.remaining === 0) debtor += 1;
    if (isOwed.remaining === 0) creditor += 1;
  }

  return settlements;
}

/** "$12.50" — always from cents, never a float. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const value = Math.abs(Math.round(cents));
  const whole = Math.floor(value / 100).toLocaleString('en-AU');
  const rest = String(value % 100).padStart(2, '0');
  return `${sign}$${whole}.${rest}`;
}

/** Parses "12", "12.5", "12,50" or "$12.50" into cents. Returns null when unusable. */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,-]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}
