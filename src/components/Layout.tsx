import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import BrandLogo from './BrandLogo';

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
          <Link to="/" className="brand" aria-label={config?.orgName ?? 'BookToUse Club'}>
            <BrandLogo compact />
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
