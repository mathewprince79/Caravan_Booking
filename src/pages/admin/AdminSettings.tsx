import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Banner, Field, Spinner } from '../../components/ui';

export default function AdminSettings() {
  const { config } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweep, setSweep] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ settings: Settings }>('/api/admin/settings')
      .then((data) => setSettings(data.settings))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const data = await api.put<{ settings: Settings }>('/api/admin/settings', settings);
      setSettings(data.settings);
      setNotice('Settings saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runReminders() {
    setError(null);
    setNotice(null);
    setSweep(null);
    setBusy(true);
    try {
      const data = await api.post<{
        summary: { date: string; startReports: number; endReports: number; addressPrompts: number; emailsSent: number; emailSkipped: number };
      }>('/api/admin/run-reminders');
      const summary = data.summary;
      setSweep(
        `${summary.date}: ${summary.startReports} start report request(s), ${summary.endReports} end report request(s), ${summary.addressPrompts} address prompt(s). Sent ${summary.emailsSent}, skipped ${summary.emailSkipped}.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return <div>{error ? <Banner kind="error">{error}</Banner> : <Spinner label="Loading settings" />}</div>;
  }

  return (
    <div className="stack">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <form className="card" onSubmit={save}>
        <div className="card-head">
          <div>
            <h2>Club defaults</h2>
            <p>Items inherit these unless they set their own limits.</p>
          </div>
        </div>

        <div className="form-grid">
          <Field label="Club name">
            <input value={settings.orgName} onChange={(event) => update('orgName', event.target.value)} />
          </Field>
          <Field label="Timezone" hint="Used to decide what “today” means for reminders.">
            <input value={settings.timezone} onChange={(event) => update('timezone', event.target.value)} placeholder="Australia/Sydney" />
          </Field>
          <Field label="Max days per booking">
            <input
              type="number"
              min={1}
              value={settings.maxDays}
              onChange={(event) => update('maxDays', Number(event.target.value))}
            />
          </Field>
          <Field label="Bookings per period">
            <input
              type="number"
              min={1}
              value={settings.maxBookingsPerPeriod}
              onChange={(event) => update('maxBookingsPerPeriod', Number(event.target.value))}
            />
          </Field>
          <Field label="Period length (days)">
            <input
              type="number"
              min={1}
              value={settings.periodDays}
              onChange={(event) => update('periodDays', Number(event.target.value))}
            />
          </Field>
          <Field label="Minimum gap between bookings (days)">
            <input
              type="number"
              min={0}
              value={settings.minGapDays}
              onChange={(event) => update('minGapDays', Number(event.target.value))}
            />
          </Field>
          <Field label="Book-ahead window (days)">
            <input
              type="number"
              min={1}
              value={settings.advanceDays}
              onChange={(event) => update('advanceDays', Number(event.target.value))}
            />
          </Field>
        </div>

        <label className="checkline">
          <input
            type="checkbox"
            checked={settings.requireApproval}
            onChange={(event) => update('requireApproval', event.target.checked)}
          />
          <span>New accounts need admin approval before booking</span>
        </label>

        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Condition report reminders</h2>
            <p>
              A daily cron runs at 07:00 UTC. It emails members on the first and last day of a booking, and asks for the
              parking address afterwards.
            </p>
          </div>
        </div>
        {config?.emailEnabled ? (
          <p className="small muted" style={{ marginBottom: 12 }}>
            Email delivery is configured.
          </p>
        ) : (
          <Banner kind="warning">
            RESEND_API_KEY is not set, so reminders are logged instead of emailed. Add the key to turn email on.
          </Banner>
        )}
        {sweep ? <Banner kind="info">{sweep}</Banner> : null}
        <button type="button" className="button button-secondary" onClick={runReminders} disabled={busy}>
          Run the reminder sweep now
        </button>
      </div>
    </div>
  );
}
