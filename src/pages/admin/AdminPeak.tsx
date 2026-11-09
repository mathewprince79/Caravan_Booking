import { useCallback, useEffect, useState } from 'react';
import type { PeakPeriod } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { Banner, Field, Spinner } from '../../components/ui';
import { formatDate } from '../../../shared/dates';

export default function AdminPeak() {
  const [periods, setPeriods] = useState<PeakPeriod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', maxDays: 7 });

  const load = useCallback(async () => {
    const data = await api.get<{ periods: PeakPeriod[] }>('/api/admin/peak-periods');
    setPeriods(data.periods);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.post('/api/admin/peak-periods', form);
      setNotice('Peak period added.');
      setForm({ name: '', startDate: '', endDate: '', maxDays: form.maxDays });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(period: PeakPeriod) {
    if (!confirm(`Delete the peak period ${period.name}?`)) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.del(`/api/admin/peak-periods/${period.id}`);
      setNotice('Peak period deleted.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Banner kind="info">
        A booking that touches a peak period can be no longer than that period&apos;s maximum days. A member&apos;s second
        peak-period booking in the same calendar year goes to you for approval, and so does any booking that pushes them past
        the yearly day allowance in Settings.
      </Banner>

      <form className="card" onSubmit={add}>
        <div className="card-head">
          <div>
            <h2>Add a peak period</h2>
            <p>Use the actual dates for the year you are booking, e.g. 20 Dec to 5 Jan.</p>
          </div>
        </div>

        <div className="form-grid">
          <Field label="Name">
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Christmas"
              required
            />
          </Field>
          <Field label="Maximum days in this period">
            <input
              type="number"
              min={1}
              max={365}
              value={form.maxDays}
              onChange={(event) => setForm((current) => ({ ...current, maxDays: Number(event.target.value) }))}
              required
            />
          </Field>
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
              min={form.startDate}
              value={form.endDate}
              onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
              required
            />
          </Field>
        </div>

        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add peak period'}
          </button>
        </div>
      </form>

      {!periods ? <Spinner label="Loading peak periods" /> : null}

      {periods && periods.length === 0 ? (
        <p className="small muted">No peak periods yet. Without any, only the club default limits apply.</p>
      ) : null}

      {periods && periods.length > 0 ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Dates</th>
                <th>Max days</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id}>
                  <td>
                    <strong>{period.name}</strong>
                  </td>
                  <td className="small">
                    {formatDate(period.startDate, 'medium')} – {formatDate(period.endDate, 'medium')}
                  </td>
                  <td>{period.maxDays}</td>
                  <td>
                    <button type="button" className="button button-danger button-small" onClick={() => remove(period)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
