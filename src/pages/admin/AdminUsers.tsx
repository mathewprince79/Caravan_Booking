import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminItem, AdminUser } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Banner, Field, Modal, Spinner, StatusChip } from '../../components/ui';

export default function AdminUsers() {
  const { me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [items, setItems] = useState<AdminItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [accessUser, setAccessUser] = useState<AdminUser | null>(null);
  const [accessIds, setAccessIds] = useState<string[]>([]);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    const [usersResponse, itemsResponse] = await Promise.all([
      api.get<{ users: AdminUser[] }>('/api/admin/users'),
      api.get<{ items: AdminItem[] }>('/api/admin/items'),
    ]);
    setUsers(usersResponse.users);
    setItems(itemsResponse.items);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  const itemName = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);

  const filtered = (users ?? []).filter((user) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [user.name, user.email, user.phone ?? ''].some((value) => value.toLowerCase().includes(query));
  });

  async function update(user: AdminUser, body: Record<string, unknown>, message: string) {
    setError(null);
    setNotice(null);
    setBusy(user.id);
    try {
      await api.patch(`/api/admin/users/${user.id}`, body);
      setNotice(message);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(user: AdminUser) {
    if (!confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    setError(null);
    setNotice(null);
    setBusy(user.id);
    try {
      await api.del(`/api/admin/users/${user.id}`);
      setNotice(`${user.name} was deleted.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function openAccess(user: AdminUser) {
    setAccessUser(user);
    setAccessIds(user.itemIds);
  }

  async function saveAccess() {
    if (!accessUser) return;
    setError(null);
    setBusy(accessUser.id);
    try {
      await api.put(`/api/admin/users/${accessUser.id}/access`, { itemIds: accessIds });
      setNotice(`Item access updated for ${accessUser.name}.`);
      setAccessUser(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function savePassword() {
    if (!passwordUser) return;
    setError(null);
    setBusy(passwordUser.id);
    try {
      await api.post(`/api/admin/users/${passwordUser.id}/password`, { password: newPassword });
      setNotice(`Password reset for ${passwordUser.name}. They will need to sign in again.`);
      setPasswordUser(null);
      setNewPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <div className="filters">
        <Field label="Search members">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email or phone" />
        </Field>
        <span className="small muted">{filtered.length} member(s)</span>
      </div>

      {!users ? <Spinner label="Loading members" /> : null}

      {users ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Member</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Role</th>
                <th>Item access</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                    {user.id === me?.id ? <span className="chip" style={{ marginLeft: 6 }}>you</span> : null}
                    <div className="tiny muted">{user.email}</div>
                    <div className="tiny muted">{user.bookingCount} booking(s)</div>
                  </td>
                  <td className="small">{user.phone ?? <span className="muted">not provided</span>}</td>
                  <td>
                    <StatusChip status={user.status} />
                  </td>
                  <td>
                    <span className={`chip${user.role === 'admin' ? ' chip-confirmed' : ''}`}>{user.role}</span>
                  </td>
                  <td className="small">
                    {user.role === 'admin' ? (
                      <span className="muted">All items</span>
                    ) : user.itemIds.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      user.itemIds.map((id) => itemName.get(id) ?? 'Item').join(', ')
                    )}
                  </td>
                  <td>
                    <div className="table-actions">
                      {user.status !== 'active' ? (
                        <button
                          type="button"
                          className="button button-primary button-small"
                          disabled={busy === user.id}
                          onClick={() => update(user, { status: 'active' }, `${user.name} approved.`)}
                        >
                          Approve
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          disabled={busy === user.id || user.id === me?.id}
                          onClick={() => update(user, { status: 'suspended' }, `${user.name} suspended.`)}
                        >
                          Suspend
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        disabled={busy === user.id}
                        onClick={() =>
                          update(
                            user,
                            { role: user.role === 'admin' ? 'user' : 'admin' },
                            `${user.name} is now ${user.role === 'admin' ? 'a member' : 'an admin'}.`,
                          )
                        }
                      >
                        {user.role === 'admin' ? 'Make member' : 'Make admin'}
                      </button>
                      <button type="button" className="button button-secondary button-small" onClick={() => openAccess(user)}>
                        Items
                      </button>
                      <button type="button" className="button button-ghost button-small" onClick={() => setPasswordUser(user)}>
                        Password
                      </button>
                      <button
                        type="button"
                        className="button button-danger button-small"
                        disabled={busy === user.id || user.id === me?.id}
                        onClick={() => remove(user)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {accessUser ? (
        <Modal title={`Item access — ${accessUser.name}`} onClose={() => setAccessUser(null)}>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Tick the items this member can book. Admins can book everything, so access is not needed for them.
          </p>
          <div className="access-list">
            {items.map((item) => (
              <label className="checkline" key={item.id}>
                <input
                  type="checkbox"
                  checked={accessIds.includes(item.id)}
                  onChange={(event) =>
                    setAccessIds((current) =>
                      event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                    )
                  }
                />
                <span>
                  {item.name}
                  {!item.active ? <span className="tiny muted"> (retired)</span> : null}
                  {item.category ? <span className="tiny muted"> · {item.category}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="button button-primary" onClick={saveAccess} disabled={busy === accessUser.id}>
              Save access
            </button>
            <button type="button" className="button button-secondary" onClick={() => setAccessUser(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {passwordUser ? (
        <Modal title={`Reset password — ${passwordUser.name}`} onClose={() => setPasswordUser(null)}>
          <Field label="New password" hint="At least 8 characters. Existing sessions are signed out.">
            <input type="text" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </Field>
          <div className="form-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={savePassword}
              disabled={newPassword.length < 8 || busy === passwordUser.id}
            >
              Set password
            </button>
            <button type="button" className="button button-secondary" onClick={() => setPasswordUser(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      <p className="tiny muted" style={{ marginTop: 12 }}>
        Members with booking history cannot be deleted — suspend them instead so the history stays intact.
      </p>
    </div>
  );
}
