import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Booking } from '../../shared/types';
import { api, errorMessage } from '../lib/api';
import { Banner, EmptyState, Spinner } from '../components/ui';
import BookingCard from '../components/BookingCard';

export default function MyBookings() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api.get<{ bookings: Booking[] }>('/api/my-bookings');
    setBookings(data.bookings);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  const confirmed = bookings?.filter((booking) => booking.status === 'confirmed') ?? [];
  const cancelled = bookings?.filter((booking) => booking.status === 'cancelled') ?? [];

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>My bookings</h1>
          <p>Condition reports and parking addresses live here.</p>
        </div>
        <Link className="button button-secondary" to="/">
          Book something
        </Link>
      </div>

      {error ? <Banner kind="error">{error}</Banner> : null}
      {!bookings && !error ? <Spinner label="Loading bookings" /> : null}

      {bookings && bookings.length === 0 ? (
        <EmptyState title="No bookings yet">
          Choose an item from the <Link to="/">items page</Link> and pick your days on the calendar.
        </EmptyState>
      ) : null}

      <div className="stack">
        {confirmed.map((booking) => (
          <BookingCard key={booking.id} booking={booking} onChanged={() => void load()} showItem />
        ))}
      </div>

      {cancelled.length > 0 ? (
        <>
          <div className="section-title">
            <h2>Cancelled</h2>
          </div>
          <div className="stack">
            {cancelled.map((booking) => (
              <BookingCard key={booking.id} booking={booking} onChanged={() => void load()} showItem />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
