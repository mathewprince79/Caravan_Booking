import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Spinner } from './ui';
import BrandLogo from './BrandLogo';

export function Splash() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Spinner label="Loading your bookings" />
      </div>
    </div>
  );
}

export function PendingScreen() {
  const { me, logout, config } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <BrandLogo />
        <h1>Almost there</h1>
        <p className="auth-sub">
          Thanks{me ? `, ${me.name.split(' ')[0]}` : ''}. Your account is waiting for an admin to approve it. You will get an
          email as soon as you can start booking.
        </p>
        <p className="small muted">
          Signed in as {me?.email}. Need to add your phone number? It helps admins reach you about bookings.
        </p>
        <div className="form-actions" style={{ marginTop: 18 }}>
          <Link className="button button-secondary" to="/welcome">
            Update my details
          </Link>
          <button
            type="button"
            className="button button-ghost"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
        <p className="tiny muted" style={{ marginTop: 18 }}>
          {config?.orgName ?? 'Bookings'}
        </p>
      </div>
    </div>
  );
}

export function SuspendedScreen() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <BrandLogo />
        <h1>Account suspended</h1>
        <p className="auth-sub">
          {me?.name}, your booking access has been suspended. Please contact an admin if you think this is a mistake.
        </p>
        <button
          type="button"
          className="button button-secondary button-block"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page page-narrow">
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <h1 style={{ fontSize: 22 }}>Page not found</h1>
        <p className="muted" style={{ margin: '8px 0 18px' }}>
          That page does not exist or you no longer have access to it.
        </p>
        <Link className="button button-primary" to="/">
          Back to items
        </Link>
      </div>
    </div>
  );
}
