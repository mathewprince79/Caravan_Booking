import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ItemLedger, LedgerKind, LedgerSettlement, MoneySummary } from '../../shared/types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner, Field, Modal, Spinner } from '../components/ui';
import { formatDate, todayInTz } from '../../shared/dates';
import { formatMoney, parseAmountToCents } from '../../shared/money';

export default function Money() {
  const { me } = useAuth();
  const [summary, setSummary] = useState<MoneySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api.get<MoneySummary>('/api/money');
    setSummary(data);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  async function removeEntry(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await api.del(`/api/money/entries/${id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const net = summary?.netCents ?? 0;
  const hasObligations = Boolean(summary && (summary.youOwe.length > 0 || summary.owedToYou.length > 0));

  return (
    <div className="page money-page">
      <div className="page-head">
        <div>
          <h1>Shared money</h1>
          <p>Repairs and running costs, plus any income the item earns from outside hires.</p>
        </div>
      </div>

      {error ? <Banner kind="error">{error}</Banner> : null}
      {!summary && !error ? <Spinner label="Loading balances" /> : null}

      {summary ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="row-between">
            <div>
              <h2 style={{ fontSize: 17 }}>
                {net > 0 ? `You are owed ${formatMoney(net)}` : net < 0 ? `You owe ${formatMoney(-net)}` : 'You are all square'}
              </h2>
              <p className="small muted">
                {hasObligations ? 'Simplified so each person makes as few transfers as possible.' : 'Nothing outstanding right now.'}
              </p>
            </div>
            <span className={`chip ${net > 0 ? 'chip-active' : net < 0 ? 'chip-pending' : ''}`}>
              {net > 0 ? 'In credit' : net < 0 ? 'In debt' : 'Settled'}
            </span>
          </div>

          {summary.youOwe.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <h3 className="money-section-title">You owe</h3>
              <div className="list">
                {summary.youOwe.map((row) => (
                  <div className="list-row" key={`${row.itemId}-${row.userId}`}>
                    <div>
                      <strong>{row.userName}</strong>
                      <span className="small muted"> · {row.itemName}</span>
                    </div>
                    <span className="money-amount money-amount-owe">{formatMoney(row.amountCents)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {summary.owedToYou.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <h3 className="money-section-title">Owed to you</h3>
              <div className="list">
                {summary.owedToYou.map((row) => (
                  <div className="list-row" key={`${row.itemId}-${row.userId}`}>
                    <div>
                      <strong>{row.userName}</strong>
                      <span className="small muted"> · {row.itemName}</span>
                    </div>
                    <span className="money-amount money-amount-credit">{formatMoney(row.amountCents)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {summary && summary.items.length === 0 ? (
        <div className="empty">
          <h3>No shared items yet</h3>
          <p>
            An admin needs to add you to an item group before its expenses and balances show up here. See{' '}
            <Link to="/">items</Link>.
          </p>
        </div>
      ) : null}

      <div className="stack">
        {summary?.items.map((ledger) => (
          <LedgerCard
            key={ledger.itemId}
            ledger={ledger}
            meId={me?.id ?? ''}
            isAdmin={me?.role === 'admin'}
            busyId={busyId}
            onDelete={removeEntry}
            onChanged={() => void load()}
            onError={setError}
          />
        ))}
      </div>
    </div>
  );
}

function LedgerCard({
  ledger,
  meId,
  isAdmin,
  busyId,
  onDelete,
  onChanged,
  onError,
}: {
  ledger: ItemLedger;
  meId: string;
  isAdmin: boolean;
  busyId: string | null;
  onDelete: (id: string) => void;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const members = ledger.members;
  const defaultPayer = members.some((member) => member.id === meId) ? meId : (members[0]?.id ?? '');
  const [kind, setKind] = useState<LedgerKind>('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [entryDate, setEntryDate] = useState(() => todayInTz());
  const [paidBy, setPaidBy] = useState(defaultPayer);
  const [participants, setParticipants] = useState<string[]>(members.map((member) => member.id));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settleFor, setSettleFor] = useState<LedgerSettlement | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState(() => todayInTz());
  const [settleNote, setSettleNote] = useState('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settleSaving, setSettleSaving] = useState(false);

  useEffect(() => {
    setParticipants(members.map((member) => member.id));
    setPaidBy((current) => (members.some((member) => member.id === current) ? current : defaultPayer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.map((member) => member.id).join(',')]);

  const amountCents = parseAmountToCents(amount) ?? 0;
  const perPerson = participants.length > 0 ? Math.round(amountCents / participants.length) : 0;

  const totals = useMemo(() => {
    let expenses = 0;
    let income = 0;
    for (const entry of ledger.entries) {
      if (entry.kind === 'income') income += entry.amountCents;
      else expenses += entry.amountCents;
    }
    return { expenses, income };
  }, [ledger.entries]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!amountCents) {
      setFormError('Enter an amount, for example 45.00');
      return;
    }
    if (description.trim().length < 2) {
      setFormError('Say what the money was for.');
      return;
    }
    if (participants.length === 0) {
      setFormError('Tick at least one person to share it with.');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/api/money/items/${ledger.itemId}`, {
        kind,
        description: description.trim(),
        amountCents,
        entryDate,
        paidBy,
        participantIds: participants,
      });
      setDescription('');
      setAmount('');
      onError(null);
      onChanged();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function openSettle(settlement: LedgerSettlement) {
    setSettleFor(settlement);
    setSettleAmount((settlement.amountCents / 100).toFixed(2));
    setSettleDate(todayInTz());
    setSettleNote('');
    setSettleError(null);
  }

  async function recordPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!settleFor) return;
    const cents = parseAmountToCents(settleAmount);
    if (!cents) {
      setSettleError('Enter an amount greater than zero.');
      return;
    }

    setSettleSaving(true);
    try {
      await api.post(`/api/money/items/${ledger.itemId}`, {
        kind: 'settlement',
        amountCents: cents,
        entryDate: settleDate,
        paidBy: settleFor.fromUserId,
        toUserId: settleFor.toUserId,
        description: settleNote.trim(),
      });
      setSettleFor(null);
      onError(null);
      onChanged();
    } catch (err) {
      setSettleError(errorMessage(err));
    } finally {
      setSettleSaving(false);
    }
  }

  const toggle = (id: string) =>
    setParticipants((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{ledger.itemName}</h2>
          <p>
            {members.length} member{members.length === 1 ? '' : 's'} · spent {formatMoney(totals.expenses)}
            {totals.income > 0 ? ` · earned ${formatMoney(totals.income)}` : ''}
          </p>
        </div>
        <span className={`chip ${ledger.myNetCents > 0 ? 'chip-active' : ledger.myNetCents < 0 ? 'chip-pending' : ''}`}>
          {ledger.myNetCents > 0
            ? `You are owed ${formatMoney(ledger.myNetCents)}`
            : ledger.myNetCents < 0
              ? `You owe ${formatMoney(-ledger.myNetCents)}`
              : 'You are square'}
        </span>
      </div>

      {ledger.canContribute ? (
        <form onSubmit={submit} className="money-form">
          <div className="form-grid">
            <Field label="Type" htmlFor={`kind-${ledger.itemId}`}>
              <select
                id={`kind-${ledger.itemId}`}
                value={kind}
                onChange={(event) => setKind(event.target.value === 'income' ? 'income' : 'expense')}
              >
                <option value="expense">Expense — someone paid</option>
                <option value="income">Income — hire paid in</option>
              </select>
            </Field>
            <Field label="Amount" htmlFor={`amount-${ledger.itemId}`} hint={amountCents ? `${formatMoney(amountCents)} in total` : 'Dollars, e.g. 45.00'}>
              <input
                id={`amount-${ledger.itemId}`}
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
          </div>

          <Field label="What was it for" htmlFor={`description-${ledger.itemId}`}>
            <input
              id={`description-${ledger.itemId}`}
              placeholder={kind === 'income' ? 'e.g. Weekend hire to a friend of a member' : 'e.g. Brake repairs'}
              value={description}
              maxLength={120}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <div className="form-grid">
            <Field label={kind === 'income' ? 'Money received by' : 'Paid by'} htmlFor={`paidBy-${ledger.itemId}`}>
              <select id={`paidBy-${ledger.itemId}`} value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.id === meId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor={`date-${ledger.itemId}`}>
              <input
                id={`date-${ledger.itemId}`}
                type="date"
                value={entryDate}
                onChange={(event) => setEntryDate(event.target.value || todayInTz())}
              />
            </Field>
          </div>

          <div className="field">
            <span className="field-label">Split between</span>
            <div className="split-list">
              {members.map((member) => (
                <label className="split-option" key={member.id}>
                  <input
                    type="checkbox"
                    checked={participants.includes(member.id)}
                    onChange={() => toggle(member.id)}
                  />
                  <span>
                    {member.name}
                    {member.id === meId ? ' (you)' : ''}
                  </span>
                </label>
              ))}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setParticipants(members.map((member) => member.id))}
              >
                Everyone
              </button>
              <button type="button" className="button button-ghost button-small" onClick={() => setParticipants([])}>
                Clear
              </button>
              <span className="small muted">
                {participants.length} of {members.length}
                {amountCents && participants.length > 0 ? ` · about ${formatMoney(perPerson)} each` : ''}
              </span>
            </div>
          </div>

          {formError ? <Banner kind="error">{formError}</Banner> : null}

          <button type="submit" className="button button-primary button-small" disabled={saving}>
            {saving ? 'Adding…' : kind === 'income' ? 'Add income' : 'Add expense'}
          </button>
        </form>
      ) : null}

      <div className="money-columns">
        <div>
          <h3 className="money-section-title">History</h3>
          {ledger.entries.length === 0 ? (
            <p className="small muted">Nothing added yet.</p>
          ) : (
            <div className="money-entries">
              {ledger.entries.map((entry) => {
                const canDelete = isAdmin || entry.createdBy === meId;
                return (
                  <div className="money-row" key={entry.id}>
                    <div className="money-row-main">
                      <span className={`money-badge money-badge-${entry.kind}`}>
                        {entry.kind === 'income' ? 'Income' : entry.kind === 'settlement' ? 'Paid' : 'Expense'}
                      </span>
                      <div>
                        <strong>{entry.description}</strong>
                        <p className="tiny muted">
                          {formatDate(entry.entryDate, 'short')} ·{' '}
                          {entry.kind === 'settlement'
                            ? `${entry.paidByName} paid ${entry.shares[0]?.userName ?? 'a member'}`
                            : `${entry.kind === 'income' ? 'received by' : 'paid by'} ${entry.paidByName} · split ${entry.shares.length} way${entry.shares.length === 1 ? '' : 's'}`}
                        </p>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <span
                        className={`money-amount ${
                          entry.kind === 'income' ? 'money-amount-credit' : entry.kind === 'expense' ? 'money-amount-owe' : ''
                        }`}
                      >
                        {formatMoney(entry.amountCents)}
                      </span>
                      {canDelete ? (
                        <button
                          type="button"
                          className="button button-ghost button-small"
                          disabled={busyId === entry.id}
                          onClick={() => onDelete(entry.id)}
                          aria-label={`Remove ${entry.description}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <h3 className="money-section-title">Settle up</h3>
          {ledger.settlements.length === 0 ? (
            <p className="small muted">Everyone is even.</p>
          ) : (
            <div className="list">
              {ledger.settlements.map((settlement) => (
                <div className="list-row" key={`${settlement.fromUserId}-${settlement.toUserId}`}>
                  <span className="small">
                    <strong>{settlement.fromUserId === meId ? 'You' : settlement.fromName}</strong> pay
                    {settlement.fromUserId === meId ? '' : 's'}{' '}
                    <strong>{settlement.toUserId === meId ? 'you' : settlement.toName}</strong>
                  </span>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="money-amount">{formatMoney(settlement.amountCents)}</span>
                    {ledger.canContribute &&
                    (settlement.fromUserId === meId || settlement.toUserId === meId) ? (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => openSettle(settlement)}
                      >
                        {settlement.toUserId === meId ? 'Mark received' : 'Mark as paid'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 className="money-section-title" style={{ marginTop: 18 }}>
            Balances
          </h3>
          <div className="list">
            {ledger.balances.map((balance) => {
              const isMe = balance.userId === meId;
              const state =
                balance.netCents === 0
                  ? isMe ? 'are even' : 'is even'
                  : balance.netCents > 0
                    ? isMe ? 'are owed' : 'is owed'
                    : isMe ? 'owe' : 'owes';
              return (
              <div className="list-row" key={balance.userId}>
                <span className="small">
                  {isMe ? 'You' : balance.userName} {state}
                </span>
                <span
                  className={`money-amount ${
                    balance.netCents > 0 ? 'money-amount-credit' : balance.netCents < 0 ? 'money-amount-owe' : ''
                  }`}
                >
                  {balance.netCents === 0 ? '—' : formatMoney(Math.abs(balance.netCents))}
                </span>
              </div>
              );
            })}
          </div>
        </div>
      </div>

      {settleFor ? (
        <Modal title="Record a payment" onClose={() => setSettleFor(null)}>
          <form onSubmit={recordPayment}>
            <p className="small muted" style={{ marginBottom: 14 }}>
              {settleFor.toUserId === meId
                ? `${settleFor.fromName} paid you. Recording it clears what they owe.`
                : `You paid ${settleFor.toName}. Recording it lowers what you owe.`}
            </p>

            <div className="form-grid">
              <Field
                label="Amount paid"
                htmlFor={`settle-amount-${ledger.itemId}`}
                hint={`Outstanding: ${formatMoney(settleFor.amountCents)}`}
              >
                <input
                  id={`settle-amount-${ledger.itemId}`}
                  inputMode="decimal"
                  value={settleAmount}
                  onChange={(event) => setSettleAmount(event.target.value)}
                />
              </Field>
              <Field label="Date" htmlFor={`settle-date-${ledger.itemId}`}>
                <input
                  id={`settle-date-${ledger.itemId}`}
                  type="date"
                  value={settleDate}
                  onChange={(event) => setSettleDate(event.target.value || todayInTz())}
                />
              </Field>
            </div>

            <Field label="Note" htmlFor={`settle-note-${ledger.itemId}`} hint="Optional — e.g. bank transfer">
              <input
                id={`settle-note-${ledger.itemId}`}
                value={settleNote}
                maxLength={120}
                onChange={(event) => setSettleNote(event.target.value)}
              />
            </Field>

            {settleError ? <Banner kind="error">{settleError}</Banner> : null}

            <div className="form-actions">
              <button type="submit" className="button button-primary button-small" disabled={settleSaving}>
                {settleSaving ? 'Recording…' : 'Mark as paid'}
              </button>
              <button type="button" className="button button-ghost button-small" onClick={() => setSettleFor(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
