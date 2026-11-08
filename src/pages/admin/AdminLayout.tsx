import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

export default function AdminLayout() {
  const { me } = useAuth();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p>
            Signed in as {me?.name}. Approve members, grant item access, set booking rules and manage every booking.
          </p>
        </div>
      </div>

      <nav className="admin-tabs" aria-label="Admin sections">
        <NavLink to="/admin" end>
          Members
        </NavLink>
        <NavLink to="/admin/items">Items</NavLink>
        <NavLink to="/admin/bookings">Bookings</NavLink>
        <NavLink to="/admin/reports">Reports</NavLink>
        <NavLink to="/admin/settings">Settings</NavLink>
      </nav>

      <Outlet />
    </div>
  );
}
