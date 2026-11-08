import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner, Field, Spinner } from '../components/ui';
import type { Me } from '../../shared/types';

export default function Welcome() {
  const { me, loading, config, setMe, logout } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="auth-page"><div className="auth-card"><Spinner /></div></div>;
  if (!me) return <Navigate to="/login" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.patch<{ me: Me }>('/api/me', { phone });
      setMe(data.me);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>One last thing</h1>
        <p className="auth-sub">
          We keep your phone number on your profile so an admin can reach you about a booking — for example if an item is
          needed back early.
        </p>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <form onSubmit={submit}>
          <Field label="Phone number" hint="Include your country code, e.g. +61 400 123 456." htmlFor="phone">
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <button type="submit" className="button button-primary button-block" disabled={busy}>
            {busy ? 'Saving…' : 'Save and continue'}
          </button>
        </form>

        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
          <span className="tiny muted">{config?.orgName}</span>
        </div>
      </div>
    </div>
  );
}
