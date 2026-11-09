import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

export default function Layout() {
  const { me, config, logout } = useAuth();
  const navigate = useNavigate();
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('install-dismissed')) return;
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
      setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismissInstall = () => {
    localStorage.setItem('install-dismissed', '1');
    setShowInstall(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 15h18M5 15V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" strokeLinecap="round" />
                <circle cx="7.5" cy="17.5" r="1.7" />
                <circle cx="16.5" cy="17.5" r="1.7" />
                <path d="M9 11h6" strokeLinecap="round" />
              </svg>
            </span>
            <span className="brand-text">{config?.orgName ?? 'BookToUse Club'}</span>
          </Link>

          <nav className="main-nav" aria-label="Main">
            <NavLink to="/" end>
              Items
            </NavLink>
            <NavLink to="/my-bookings">My bookings</NavLink>
            {me?.role === 'admin' ? <NavLink to="/admin">Admin</NavLink> : null}
          </nav>

          <div className="account">
            <span className="account-name" title={me?.email}>
              {me?.name}
            </span>
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
          </div>
        </div>
      </header>

      {showInstall ? (
        <div className="install-banner">
          <span>Install this app for quick access to the calendar.</span>
          <div className="install-actions">
            <button
              type="button"
              className="button button-primary button-small"
              onClick={async () => {
                await installEvent?.prompt();
                setShowInstall(false);
              }}
            >
              Install
            </button>
            <button type="button" className="button button-ghost button-small" onClick={dismissInstall}>
              Not now
            </button>
          </div>
        </div>
      ) : null}

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
