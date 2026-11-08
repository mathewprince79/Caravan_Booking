import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminItem, AdminUser, Booking, BookingStatus } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { Banner, Field, Modal, Spinner } from '../../components/ui';
import { addDays, addMonths, formatRange, startOfMonth, todayInTz } from '../../../shared/dates';

interface FormState {
  userId: string;
  itemId: string;
  startDate: string;
  endDate: string;
  status: BookingStatus;
  notes: string;
}

export default function AdminBookings() {
  const today = todayInTz();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [items, setItems] = useState<AdminItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Booking | 'new' | null>(null);
  const [form, setForm] = useState<FormState>({
    userId: '',
    itemId: '',
    startDate: today,
    endDate: today,
    status: 'confirmed',
    notes: '',
  });
  const [filters, setFilters] = useState({
    from: startOfMonth(today),
    to: addDays(startOfMonth(addMonths(today, 1)), -1),
    itemId: '',
    status: '',
  });

  const loadBookings = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.itemId) params.set('itemId', filters.itemId);
    if (filters.status) params.set('status', filters.status);
    const data = await api.get<{ bookings: Booking[] }>(`/api/admin/bookings?${params.toString()}`);
    setBookings(data.bookings);
  }, [filters]);

  const loadLookups = useCallback(async () => {
    const [itemResponse, userResponse] = await Promise.all([
      api.get<{ items: AdminItem[] }>('/api/admin/items'),
      api.get<{ users: AdminUser[] }>('/api/admin/users'),
    ]);
    setItems(itemResponse.items);
    setUsers(userResponse.users);
  }, []);

  useEffect(() => {
    loadLookups().catch((err) => setError(errorMessage(err)));
  }, [loadLookups]);

  useEffect(() => {
    loadBookings().catch((err) => setError(errorMessage(err)));
  }, [loadBookings]);

  const itemName = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);

  function openNew() {
    setForm({
      userId: users[0]?.id ?? '',
      itemId: items.find((item) => item.active)?.id ?? '',
      startDate: today,
      endDate: today,
      status: 'confirmed',
      notes: '',
    });
    setEditing('new');
  }

  function openEdit(booking: Booking) {
    setForm({
      userId: booking.userId,
      itemId: booking.itemId,
      startDate: booking.startDate,
      endDate: booking.endDate,
      status: booking.status,
      notes: booking.notes ?? '',
    });
    setEditing(booking);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const body = {
        userId: form.userId,
        itemId: form.itemId,
        startDate: form.startDate,
        endDate: form.endDate,
        status: form.status,
        notes: form.notes || null,
      };
      if (editing === 'new') {
        await api.post('/api/admin/bookings', body);
        setNotice('Booking created.');
      } else if (editing) {
        await api.patch(`/api/admin/bookings/${editing.id}`, body);
        setNotice('Booking updated.');
      }
      setEditing(null);
      await loadBookings();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(booking: Booking) {
    if (!confirm(`Delete ${booking.userName}'s booking of ${booking.itemName}? Reports attached to it are deleted too.`)) return;
    setError(null);
    setNotice(null);
    try {
      await api.del(`/api/admin/bookings/${booking.id}`);
      setNotice('Booking deleted.');
      await loadBookings();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <div className="filters">
        <Field label="From">
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
          />
        </Field>
        <Field label="Item">
          <select value={filters.itemId} onChange={(event) => setFilters((current) => ({ ...current, itemId: event.target.value }))}>
            <option value="">All items</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <button type="button" className="button button-primary" onClick={openNew} style={{ marginLeft: 'auto' }}>
          New booking
        </button>
      </div>

      {!bookings ? <Spinner label="Loading bookings" /> : null}

      {bookings ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th>Booked by</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Reports</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td>{booking.itemName || itemName.get(booking.itemId)}</td>
                  <td>
                    <strong>{booking.userName}</strong>
                  </td>
                  <td className="small">{formatRange(booking.startDate, booking.endDate)}</td>
                  <td>
                    <span className={`chip chip-${booking.status}`}>{booking.status}</span>
                  </td>
                  <td className="tiny muted">
                    start {booking.hasStartReport ? '✓' : '—'} · end {booking.hasEndReport ? '✓' : '—'} · address{' '}
                    {booking.hasAddress ? '✓' : '—'}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="button button-secondary button-small" onClick={() => openEdit(booking)}>
                        Edit
                      </button>
                      <button type="button" className="button button-danger button-small" onClick={() => remove(booking)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {bookings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    No bookings in this window.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <Modal title={editing === 'new' ? 'New booking' : 'Edit booking'} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <Field label="Item">
              <select value={form.itemId} onChange={(event) => setForm((current) => ({ ...current, itemId: event.target.value }))} required>
                <option value="">Choose an item</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.active ? '' : ' (retired)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Book for" hint="Admins can book any item for themselves or another member.">
              <select value={form.userId} onChange={(event) => setForm((current) => ({ ...current, userId: event.target.value }))} required>
                <option value="">Choose a member</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="First day">
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
                  required
                />
              </Field>
              <Field label="Last day">
                <input
                  type="date"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
                  required
                />
              </Field>
            </div>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as BookingStatus }))}
              >
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Notes">
              <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </Field>
            <div className="form-actions">
              <button type="submit" className="button button-primary" disabled={busy || !form.userId || !form.itemId}>
                {busy ? 'Saving…' : editing === 'new' ? 'Create booking' : 'Save changes'}
              </button>
              <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
