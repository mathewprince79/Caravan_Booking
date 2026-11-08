import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Booking, Item } from '../../shared/types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner, EmptyState, Spinner } from '../components/ui';
import ItemPhoto from '../components/ItemPhoto';
import { formatDate } from '../../shared/dates';
import { lastUsedLine } from '../lib/format';

interface ItemsResponse {
  today: string;
  items: Item[];
  allItemsCount: number;
}

export default function Dashboard() {
  const { me } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [pendingActions, setPendingActions] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [itemsResponse, mine] = await Promise.all([
          api.get<ItemsResponse>('/api/items'),
          api.get<{ bookings: Booking[] }>('/api/my-bookings'),
        ]);
        if (!alive) return;
        setItems(itemsResponse.items);
        setPendingActions(
          mine.bookings.filter(
            (booking) =>
              booking.status === 'confirmed' &&
              (booking.actions.needsStartReport || booking.actions.needsEndReport || booking.actions.needsAddress),
          ),
        );
      } catch (err) {
        if (alive) setError(errorMessage(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hi {me?.name.split(' ')[0]}</h1>
          <p>Pick an item to see the calendar and book your days.</p>
        </div>
        <Link className="button button-secondary" to="/my-bookings">
          My bookings
        </Link>
      </div>

      {error ? <Banner kind="error">{error}</Banner> : null}

      {pendingActions.length > 0 ? (
        <div className="card" style={{ marginBottom: 20, borderColor: '#fdba74', background: '#fff7ed' }}>
          <div className="row-between">
            <div>
              <h2 style={{ fontSize: 16 }}>Action needed on your bookings</h2>
              <p className="small muted">
                {pendingActions
                  .map((booking) => `${booking.itemName} — ${booking.actions.needsEndReport ? 'end report' : booking.actions.needsAddress ? 'parking address' : 'condition report'}`)
                  .join(' · ')}
              </p>
            </div>
            <Link className="button button-primary button-small" to="/my-bookings">
              Open
            </Link>
          </div>
        </div>
      ) : null}

      {!items && !error ? <Spinner label="Loading items" /> : null}

      {items && items.length === 0 ? (
        <EmptyState title="No items are available to you yet">
          An admin needs to approve your account and give you access to at least one item. You can check back later.
        </EmptyState>
      ) : null}

      <div className="item-grid">
        {items?.map((item) => {
          const out = item.currentBooking;
          return (
            <Link key={item.id} to={`/items/${item.id}`} className="item-card">
              <div className="item-photo">
                <ItemPhoto photoKey={item.photoKey} name={item.name} />
              </div>
              <div className="item-card-body">
                <div className="row-between">
                  <h3>{item.name}</h3>
                  {item.category ? <span className="chip">{item.category}</span> : null}
                </div>

                <div className="item-meta">
                  {out ? (
                    <span className="availability availability-out">
                      <span className="dot" /> Out with {out.userName.split(' ')[0]} until {formatDate(out.endDate, 'short')}
                    </span>
                  ) : (
                    <span className="availability availability-free">
                      <span className="dot" /> Available now
                    </span>
                  )}
                </div>

                <p className="tiny muted">{lastUsedLine(item.lastUsed)}</p>
                {item.description ? <p className="small muted">{item.description}</p> : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
