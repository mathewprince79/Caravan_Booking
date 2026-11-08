import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ItemDetail } from '../../shared/types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import Calendar from '../components/Calendar';
import BookingCard from '../components/BookingCard';
import ItemPhoto from '../components/ItemPhoto';
import { Banner, Field, Spinner } from '../components/ui';
import {
  addDays,
  addMonths,
  daysInclusive,
  formatDate,
  formatRange,
  monthKey,
  startOfMonth,
  todayInTz,
} from '../../shared/dates';
import { limitSummary } from '../lib/format';

export default function ItemPage() {
  const { id = '' } = useParams();
  const { me } = useAuth();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [month, setMonth] = useState(() => monthKey(todayInTz()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const from = startOfMonth(month);
    const to = addDays(startOfMonth(addMonths(month, 1)), -1);
    const data = await api.get<ItemDetail>(`/api/items/${id}?from=${from}&to=${to}`);
    setDetail(data);
  }, [id, month]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load()
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  const today = detail?.today ?? todayInTz();
  const item = detail?.item;
  const maxDay = useMemo(() => (item ? addDays(today, item.limits.advanceDays) : undefined), [item, today]);
  const span = selection.start && selection.end ? daysInclusive(selection.start, selection.end) : 0;

  function selectDay(day: string) {
    setBookingError(null);
    setSelection((current) => {
      if (!current.start || (current.start && current.end && current.start !== current.end)) {
        return { start: day, end: day };
      }
      if (day < current.start) return { start: day, end: day };
      return { start: current.start, end: day };
    });
  }

  async function book(event: React.FormEvent) {
    event.preventDefault();
    if (!selection.start || !selection.end) return;
    setBookingError(null);
    setSubmitting(true);
    try {
      await api.post(`/api/items/${id}/bookings`, { startDate: selection.start, endDate: selection.end });
      setSelection({ start: null, end: null });
      await load();
    } catch (err) {
      setBookingError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <Link to="/" className="button button-ghost button-small">
          ← All items
        </Link>
      </div>

      {error ? <Banner kind="error">{error}</Banner> : null}
      {loading && !detail ? <Spinner label="Loading item" /> : null}

      {item ? (
        <>
          <div className="item-hero">
            <div className="item-hero-photo">
              <ItemPhoto photoKey={item.photoKey} name={item.name} />
            </div>
            <div>
              <div className="row-between">
                <div>
                  <h1>{item.name}</h1>
                  <p className="small muted">{item.category ?? 'Shared item'}</p>
                </div>
                {item.currentBooking ? (
                  <span className="chip chip-pending">Out until {formatDate(item.currentBooking.endDate, 'short')}</span>
                ) : (
                  <span className="chip chip-active">Available</span>
                )}
              </div>

              <div className="last-used-bar" style={{ marginTop: 12 }}>
                <span
                  className="dot"
                  style={{ color: item.currentBooking ? 'var(--booked-ink)' : 'var(--free-ink)' }}
                  aria-hidden="true"
                />
                {item.currentBooking ? (
                  <span>
                    <strong>{item.currentBooking.userName}</strong> currently has {item.name} · back{' '}
                    {formatDate(item.currentBooking.endDate, 'short')}
                  </span>
                ) : item.lastUsed ? (
                  <span>
                    <strong>{item.lastUsed.userName}</strong> last used {item.name} ·{' '}
                    {formatDate(item.lastUsed.endDate, 'short')}
                  </span>
                ) : (
                  <span>No one has used {item.name} yet</span>
                )}
              </div>

              {item.description ? (
                <p className="small muted" style={{ marginTop: 10 }}>
                  {item.description}
                </p>
              ) : null}

              <div className="restrictions">
                <span>Rules: {limitSummary(item.limits)}</span>
                <span>Your booking is free to cancel until the day it starts.</span>
              </div>
            </div>
          </div>

          <div className="item-layout" style={{ marginTop: 20 }}>
            <div className="stack">
              <Calendar
                month={month}
                onMonthChange={setMonth}
                bookings={detail?.bookings ?? []}
                myUserId={me?.id ?? ''}
                today={today}
                selection={selection}
                onSelectDay={selectDay}
                minDay={today}
                maxDay={maxDay}
              />

              {detail && detail.bookings.length > 0 ? (
                <div className="card">
                  <div className="card-head">
                    <div>
                      <h2>Who has booked these months</h2>
                      <p>Everyone can see who booked each day.</p>
                    </div>
                  </div>
                  <div className="list">
                    {detail.bookings.map((booking) => (
                      <div className="list-row" key={booking.id}>
                        <div>
                          <strong>{booking.userName}</strong>
                          <span className="small muted"> · {formatRange(booking.startDate, booking.endDate)}</span>
                        </div>
                        {booking.userId === me?.id ? <span className="chip chip-mine">You</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="stack">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Book {item.name}</h2>
                    <p>Tap the first and last day on the calendar, or type the dates.</p>
                  </div>
                </div>

                {bookingError ? <Banner kind="error">{bookingError}</Banner> : null}

                <form onSubmit={book}>
                  <Field label="First day" htmlFor="startDate">
                    <input
                      id="startDate"
                      type="date"
                      value={selection.start ?? ''}
                      min={today}
                      max={maxDay}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSelection((current) => ({
                          start: value || null,
                          end: current.end && value && current.end >= value ? current.end : value || null,
                        }));
                      }}
                    />
                  </Field>
                  <Field label="Last day" htmlFor="endDate">
                    <input
                      id="endDate"
                      type="date"
                      value={selection.end ?? ''}
                      min={selection.start ?? today}
                      max={maxDay}
                      onChange={(event) => setSelection((current) => ({ start: current.start, end: event.target.value || null }))}
                    />
                  </Field>

                  <p className="small muted" style={{ marginBottom: 12 }}>
                    {selection.start && selection.end
                      ? `${formatRange(selection.start, selection.end)} · ${span} day${span === 1 ? '' : 's'}`
                      : 'No days selected yet.'}
                  </p>

                  <button
                    type="submit"
                    className="button button-primary button-block"
                    disabled={!selection.start || !selection.end || submitting}
                  >
                    {submitting ? 'Booking…' : 'Book these days'}
                  </button>
                </form>
              </div>

              {detail && detail.myBookings.filter((booking) => booking.status === 'confirmed').length > 0 ? (
                <div className="stack">
                  <h2 style={{ fontSize: 17 }}>Your bookings for {item.name}</h2>
                  {detail.myBookings
                    .filter((booking) => booking.status === 'confirmed')
                    .map((booking) => (
                      <BookingCard key={booking.id} booking={booking} onChanged={() => void load()} />
                    ))}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
