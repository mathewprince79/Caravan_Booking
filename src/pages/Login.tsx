import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner, Field, Spinner } from '../components/ui';
import type { Me } from '../../shared/types';

const OAUTH_ERRORS: Record<string, string> = {
  google_not_configured: 'Google sign-in is not set up on this deployment yet. Use your email and password.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'The Google sign-in session expired. Please try again.',
  google_code: 'Google did not return a sign-in code. Please try again.',
  google_failed: 'Google sign-in failed. Please try again or use email and password.',
};

export default function Login() {
  const { me, loading, config, setMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const oauthError = params.get('error');

  if (loading) return <div className="auth-page"><div className="auth-card"><Spinner /></div></div>;
  if (me) return <Navigate to={me.phone ? '/' : '/welcome'} replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.post<{ me: Me }>('/api/auth/login', { email, password });
      setMe(data.me);
      navigate(data.me.phone ? '/' : '/welcome', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 15h18M5 15V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" strokeLinecap="round" />
              <circle cx="7.5" cy="17.5" r="1.7" />
              <circle cx="16.5" cy="17.5" r="1.7" />
            </svg>
          </span>
          {config?.orgName ?? 'Caravan Club'}
        </div>

        <h1>Welcome back</h1>
        <p className="auth-sub">Sign in to book shared items and see who has what.</p>

        {oauthError ? <Banner kind="error">{OAUTH_ERRORS[oauthError] ?? 'Sign-in failed. Please try again.'}</Banner> : null}
        {error ? <Banner kind="error">{error}</Banner> : null}

        <form onSubmit={submit}>
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
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <button type="submit" className="button button-primary button-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {config?.googleEnabled ? (
          <>
            <div className="divider">or</div>
            <a className="button button-google button-block" href="/api/auth/google/start">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8Z" />
                <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.4 7.4 0 0 1-11-3.9H1v3.1A12 12 0 0 0 12 24Z" />
                <path fill="#FBBC05" d="M5 14.2a7.2 7.2 0 0 1 0-4.5V6.6H1a12 12 0 0 0 0 10.7l4-3.1Z" />
                <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1 6.6l4 3.1A7.4 7.4 0 0 1 12 4.8Z" />
              </svg>
              Continue with Google
            </a>
          </>
        ) : null}

        <p className="auth-footer">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
