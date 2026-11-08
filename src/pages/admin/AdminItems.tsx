import { useCallback, useEffect, useState } from 'react';
import type { AdminItem } from '../../../shared/types';
import { api, errorMessage, mediaUrl } from '../../lib/api';
import { Banner, Field, Modal, Spinner } from '../../components/ui';
import { limitSummary } from '../../lib/format';

interface FormState {
  name: string;
  category: string;
  description: string;
  maxDays: string;
  maxBookingsPerPeriod: string;
  periodDays: string;
  minGapDays: string;
  advanceDays: string;
}

const EMPTY: FormState = {
  name: '',
  category: '',
  description: '',
  maxDays: '',
  maxBookingsPerPeriod: '',
  periodDays: '',
  minGapDays: '',
  advanceDays: '',
};

function toForm(item: AdminItem): FormState {
  const value = (input: number | null) => (input === null || input === undefined ? '' : String(input));
  return {
    name: item.name,
    category: item.category ?? '',
    description: item.description ?? '',
    maxDays: value(item.overrides.maxDays),
    maxBookingsPerPeriod: value(item.overrides.maxBookingsPerPeriod),
    periodDays: value(item.overrides.periodDays),
    minGapDays: value(item.overrides.minGapDays),
    advanceDays: value(item.overrides.advanceDays),
  };
}

export default function AdminItems() {
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminItem | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api.get<{ items: AdminItem[] }>('/api/admin/items');
    setItems(data.items);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  function openNew() {
    setForm(EMPTY);
    setPhoto(null);
    setError(null);
    setEditing('new');
  }

  function openEdit(item: AdminItem) {
    setForm(toForm(item));
    setPhoto(null);
    setError(null);
    setEditing(item);
  }

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        maxDays: form.maxDays === '' ? null : Number(form.maxDays),
        maxBookingsPerPeriod: form.maxBookingsPerPeriod === '' ? null : Number(form.maxBookingsPerPeriod),
        periodDays: form.periodDays === '' ? null : Number(form.periodDays),
        minGapDays: form.minGapDays === '' ? null : Number(form.minGapDays),
        advanceDays: form.advanceDays === '' ? null : Number(form.advanceDays),
      };

      let id: string;
      if (editing === 'new') {
        const created = await api.post<{ item: AdminItem }>('/api/admin/items', body);
        id = created.item.id;
        setNotice(`${body.name} added.`);
      } else if (editing) {
        id = editing.id;
        await api.patch(`/api/admin/items/${id}`, body);
        setNotice(`${body.name} updated.`);
      } else {
        return;
      }

      if (photo) {
        const data = new FormData();
        data.append('photo', photo);
        await api.form(`/api/admin/items/${id}/photo`, data);
      }

      setEditing(null);
      setPhoto(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: AdminItem) {
    setError(null);
    try {
      await api.patch(`/api/admin/items/${item.id}`, { active: !item.active });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(item: AdminItem) {
    if (!confirm(`Delete ${item.name}? Items with booking history are retired instead.`)) return;
    setError(null);
    setNotice(null);
    try {
      const result = await api.del<{ archived: boolean; message?: string }>(`/api/admin/items/${item.id}`);
      setNotice(result.message ?? `${item.name} deleted.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <div className="row-between" style={{ marginBottom: 14 }}>
        <p className="small muted">
          Each item has its own photo and booking rules. Leaves a rule blank to inherit the club defaults.
        </p>
        <button type="button" className="button button-primary" onClick={openNew}>
          Add item
        </button>
      </div>

      {!items ? <Spinner label="Loading items" /> : null}

      {items ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th>Rules</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="row">
                      {item.photoKey ? (
                        <img className="thumb" src={mediaUrl(item.photoKey) ?? ''} alt={item.name} />
                      ) : (
                        <div className="thumb" />
                      )}
                      <div>
                        <strong>{item.name}</strong>
                        <div className="tiny muted">{item.category ?? 'Uncategorised'}</div>
                        <div className="tiny muted">{item.archivedBookingCount} booking(s)</div>
                      </div>
                    </div>
                  </td>
                  <td className="small">{limitSummary(item.limits)}</td>
                  <td>
                    <span className={`chip${item.active ? ' chip-active' : ' chip-suspended'}`}>
                      {item.active ? 'Bookable' : 'Retired'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="button button-secondary button-small" onClick={() => openEdit(item)}>
                        Edit
                      </button>
                      <button type="button" className="button button-ghost button-small" onClick={() => toggleActive(item)}>
                        {item.active ? 'Retire' : 'Restore'}
                      </button>
                      <button type="button" className="button button-danger button-small" onClick={() => remove(item)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <Modal
          title={editing === 'new' ? 'Add an item' : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
          wide
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Name">
                <input value={form.name} onChange={(event) => set('name', event.target.value)} required minLength={2} />
              </Field>
              <Field label="Category" hint="e.g. Caravan, Trailer, Boat">
                <input value={form.category} onChange={(event) => set('category', event.target.value)} />
              </Field>
            </div>

            <Field label="Description">
              <textarea value={form.description} onChange={(event) => set('description', event.target.value)} />
            </Field>

            <Field label="Photo" hint="JPG, PNG or WebP up to 12 MB. Shown on the item card and item page.">
              <input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
            </Field>
            {editing !== 'new' && editing.photoKey ? (
              <img className="thumb" style={{ width: 120, height: 90 }} src={mediaUrl(editing.photoKey) ?? ''} alt={editing.name} />
            ) : null}

            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Booking restrictions</h3>
            <p className="tiny muted" style={{ marginBottom: 10 }}>
              Leave a field empty to use the club default. These override the defaults for this item only.
            </p>
            <div className="form-grid">
              <Field label="Max days per booking">
                <input
                  type="number"
                  min={1}
                  value={form.maxDays}
                  placeholder="inherit"
                  onChange={(event) => set('maxDays', event.target.value)}
                />
              </Field>
              <Field label="Bookings per period">
                <input
                  type="number"
                  min={1}
                  value={form.maxBookingsPerPeriod}
                  placeholder="inherit"
                  onChange={(event) => set('maxBookingsPerPeriod', event.target.value)}
                />
              </Field>
              <Field label="Period length (days)">
                <input
                  type="number"
                  min={1}
                  value={form.periodDays}
                  placeholder="inherit"
                  onChange={(event) => set('periodDays', event.target.value)}
                />
              </Field>
              <Field label="Minimum gap (days)">
                <input
                  type="number"
                  min={0}
                  value={form.minGapDays}
                  placeholder="inherit"
                  onChange={(event) => set('minGapDays', event.target.value)}
                />
              </Field>
              <Field label="Book-ahead window (days)">
                <input
                  type="number"
                  min={1}
                  value={form.advanceDays}
                  placeholder="inherit"
                  onChange={(event) => set('advanceDays', event.target.value)}
                />
              </Field>
            </div>

            <div className="form-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? 'Saving…' : editing === 'new' ? 'Create item' : 'Save changes'}
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
