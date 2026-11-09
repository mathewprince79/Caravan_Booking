import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner, Field, Spinner } from '../components/ui';
import BrandLogo from '../components/BrandLogo';
import type { Me } from '../../shared/types';

export default function Signup() {
  const { me, loading, config, setMe } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="auth-page"><div className="auth-card"><Spinner /></div></div>;
  if (me) return <Navigate to={me.phone ? '/' : '/welcome'} replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.post<{ me: Me }>('/api/auth/signup', { name, email, password });
      setMe(data.me);
      navigate('/welcome', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <BrandLogo />

        <h1>Create your account</h1>
        <p className="auth-sub">
          {config?.approvalRequired
            ? 'An admin approves new members, then you can book the items you are given access to.'
            : 'Sign up to start booking shared items.'}
        </p>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <form onSubmit={submit}>
          <Field label="Full name" htmlFor="name">
            <input id="name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Password" hint="At least 8 characters." htmlFor="password">
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <button type="submit" className="button button-primary button-block" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        {config?.googleEnabled ? (
          <>
            <div className="divider">or</div>
            <a className="button button-google button-block" href="/api/auth/google/start">
              Sign up with Google
            </a>
          </>
        ) : null}

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
