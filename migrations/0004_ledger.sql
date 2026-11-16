-- Per-item money ledger: shared expenses paid by a member, and income the item
-- earns from outside hires. Each entry is split across the members chosen when
-- it was added; shares are stored in cents so balances never drift.

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- 'expense' | 'income'
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,  -- always positive
  paid_by TEXT NOT NULL,          -- member who paid (expense) or received the money (income)
  entry_date TEXT NOT NULL,       -- YYYY-MM-DD
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_item ON ledger_entries (item_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_creator ON ledger_entries (created_by);

CREATE TABLE IF NOT EXISTS ledger_shares (
  entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  share_cents INTEGER NOT NULL,
  PRIMARY KEY (entry_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_shares_user ON ledger_shares (user_id);
