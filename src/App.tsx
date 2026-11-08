import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import { NotFound, PendingScreen, Splash, SuspendedScreen } from './components/Screens';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Welcome from './pages/Welcome';
import Dashboard from './pages/Dashboard';
import ItemPage from './pages/ItemPage';
import MyBookings from './pages/MyBookings';
import AdminLayout from './pages/admin/AdminLayout';
import AdminUsers from './pages/admin/AdminUsers';
import AdminItems from './pages/admin/AdminItems';
import AdminBookings from './pages/admin/AdminBookings';
import AdminReports from './pages/admin/AdminReports';
import AdminSettings from './pages/admin/AdminSettings';

function ProtectedApp() {
  const { me, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!me.phone) return <Navigate to="/welcome" replace />;
  if (me.status === 'suspended') return <SuspendedScreen />;
  if (me.status !== 'active') return <PendingScreen />;
  return <Layout />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/welcome" element={<Welcome />} />

          <Route element={<ProtectedApp />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/items/:id" element={<ItemPage />} />
            <Route path="/my-bookings" element={<MyBookings />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminUsers />} />
              <Route path="items" element={<AdminItems />} />
              <Route path="bookings" element={<AdminBookings />} />
              <Route path="reports" element={<AdminReports />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
