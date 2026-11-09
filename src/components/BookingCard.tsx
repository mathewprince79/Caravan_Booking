import { useEffect, useRef, useState } from 'react';
import type { Booking } from '../../shared/types';
import { daysInclusive, formatDate, formatRange } from '../../shared/dates';
import { api, errorMessage } from '../lib/api';
import { Banner, BookingStatusChip } from './ui';

interface Props {
  booking: Booking;
  onChanged: () => void;
  showItem?: boolean;
  autoOpenReport?: 'start' | 'end';
}

export default function BookingCard({ booking, onChanged, showItem = false, autoOpenReport }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (autoOpenReport) sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [autoOpenReport]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [addressNotes, setAddressNotes] = useState('');
  const [showAddressForm, setShowAddressForm] = useState(false);

  const span = daysInclusive(booking.startDate, booking.endDate);
  const finished = booking.actions.needsEndReport || booking.actions.needsAddress;

  async function uploadReport(kind: 'start' | 'end', form: HTMLFormElement) {
    setError(null);
    setNotice(null);
    const data = new FormData(form);
    const files = data.getAll('media').filter((entry): entry is File => entry instanceof File && entry.size > 0);
    if (files.length === 0) {
      setError('Choose a photo or video before submitting.');
      return;
    }
    if (files.length > 5) {
      setError('Attach up to 5 photos or videos per report.');
      return;
    }
    data.set('kind', kind);
    setBusy(kind);
    try {
      await api.form(`/api/bookings/${booking.id}/report`, data);
      setNotice(`${kind === 'start' ? 'Start' : 'End'} condition report saved.`);
      form.reset();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveAddress() {
    setError(null);
    setNotice(null);
    setBusy('address');
    try {
      await api.post(`/api/bookings/${booking.id}/address`, { address, notes: addressNotes || null });
      setNotice('Parking address saved. Thanks!');
      setShowAddressForm(false);
      setAddress('');
      setAddressNotes('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancelBooking() {
    if (!confirm('Cancel this booking?')) return;
    setError(null);
    setNotice(null);
    setBusy('cancel');
    try {
      await api.post(`/api/bookings/${booking.id}/cancel`);
      setNotice('Booking cancelled.');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="booking-card" ref={sectionRef}>
      <div className="booking-card-head">
        <div>
          {showItem ? <h3>{booking.itemName}</h3> : null}
          <p className="small muted">
            {formatRange(booking.startDate, booking.endDate)} · {span} day{span === 1 ? '' : 's'}
          </p>
        </div>
        <BookingStatusChip status={booking.status} />
      </div>

      {booking.notes ? <p className="small muted">“{booking.notes}”</p> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      {booking.status === 'confirmed' ? (
        <>
          <ReportSlot
            title="Start condition report"
            done={booking.hasStartReport}
            due={booking.actions.needsStartReport}
            hint={`Photos or videos of ${booking.itemName} before use (up to 5)`}
            busy={busy === 'start'}
            defaultOpen={autoOpenReport === 'start'}
            onSubmit={(form) => uploadReport('start', form)}
          />

          <ReportSlot
            title="End condition report"
            done={booking.hasEndReport}
            due={booking.actions.needsEndReport}
            hint={`Photos or videos showing how ${booking.itemName} was returned (up to 5)`}
            busy={busy === 'end'}
            defaultOpen={autoOpenReport === 'end'}
            onSubmit={(form) => uploadReport('end', form)}
          />

          <div className={`report-slot${booking.hasAddress ? ' done' : finished ? ' late' : ''}`}>
            <h4>
              {booking.hasAddress ? '✓ Parking address recorded' : 'Parking address'}
              {!booking.hasAddress && !finished ? <span className="tiny muted">(after the booking finishes)</span> : null}
            </h4>
            {booking.hasAddress ? (
              <p className="tiny muted">Thanks — the next member can see where it is parked.</p>
            ) : finished || showAddressForm ? (
              <div className="report-form">
                <input
                  type="text"
                  placeholder="e.g. 14 Bay Street carport, Bondi"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  aria-label="Parking address"
                />
                <input
                  type="text"
                  placeholder="Access notes (optional)"
                  value={addressNotes}
                  onChange={(event) => setAddressNotes(event.target.value)}
                  aria-label="Access notes"
                />
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={saveAddress}
                  disabled={busy === 'address' || address.trim().length < 5}
                >
                  {busy === 'address' ? 'Saving…' : 'Save address'}
                </button>
              </div>
            ) : (
              <p className="tiny muted">You will be asked where the item is parked once it is returned.</p>
            )}
          </div>

          {booking.actions.canCancel ? (
            <div>
              <button
                type="button"
                className="button button-danger button-small"
                onClick={cancelBooking}
                disabled={busy === 'cancel'}
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel booking'}
              </button>
            </div>
          ) : null}
        </>
      ) : booking.status === 'pending' ? (
        <>
          <p className="small muted">
            Waiting for an admin to approve this booking. You will get a confirmation email as soon as it is approved.
          </p>
          {booking.actions.canCancel ? (
            <div>
              <button
                type="button"
                className="button button-danger button-small"
                onClick={cancelBooking}
                disabled={busy === 'cancel'}
              >
                {busy === 'cancel' ? 'Withdrawing…' : 'Withdraw request'}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="small muted">Cancelled on {formatDate(booking.startDate, 'medium')}.</p>
      )}
    </section>
  );
}

function ReportSlot({
  title,
  done,
  due,
  hint,
  busy,
  defaultOpen = false,
  onSubmit,
}: {
  title: string;
  done: boolean;
  due: boolean;
  hint: string;
  busy: boolean;
  defaultOpen?: boolean;
  onSubmit: (form: HTMLFormElement) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`report-slot${done ? ' done' : due ? ' late' : ''}`}>
      <h4>
        {done ? '✓' : '○'} {title}
        {done ? <span className="tiny muted">uploaded</span> : due ? <span className="tiny">due now</span> : null}
      </h4>
      <p className="tiny muted">{hint}</p>
      {done ? null : open ? (
        <form
          className="report-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(event.currentTarget);
          }}
        >
          <input type="file" name="media" accept="image/*,video/*" multiple required />
          <span className="tiny muted">Up to 5 photos or videos, 25 MB each. Uploading again replaces the set.</span>
          <input type="text" name="notes" placeholder="Notes (optional)" />
          <div className="row">
            <button type="submit" className="button button-primary button-small" disabled={busy}>
              {busy ? 'Uploading…' : 'Upload report'}
            </button>
            <button type="button" className="button button-ghost button-small" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="button button-secondary button-small" onClick={() => setOpen(true)}>
          Add photo or video
        </button>
      )}
    </div>
  );
}
