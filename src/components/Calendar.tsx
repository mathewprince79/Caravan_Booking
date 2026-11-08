import { useMemo } from 'react';
import type { BookingSummary } from '../../shared/types';
import { addMonths, formatDate, monthLabel, monthMatrix, weekdayLabels } from '../../shared/dates';

interface CalendarProps {
  month: string;
  onMonthChange: (month: string) => void;
  bookings: BookingSummary[];
  myUserId: string;
  today: string;
  selection?: { start: string | null; end: string | null };
  onSelectDay?: (day: string) => void;
  minDay?: string;
  maxDay?: string;
}

export default function Calendar({
  month,
  onMonthChange,
  bookings,
  myUserId,
  today,
  selection,
  onSelectDay,
  minDay,
  maxDay,
}: CalendarProps) {
  const weeks = useMemo(() => monthMatrix(month), [month]);
  const weekdays = useMemo(() => weekdayLabels(), []);

  const rangeStart = selection?.start ?? null;
  const rangeEnd = selection?.end ?? selection?.start ?? null;

  const findBooking = (iso: string) =>
    bookings.find((booking) => booking.status === 'confirmed' && iso >= booking.startDate && iso <= booking.endDate) ?? null;

  return (
    <div className="calendar">
      <div className="cal-head">
        <h2>{monthLabel(month)}</h2>
        <div className="cal-nav">
          <button type="button" className="button button-secondary button-small" onClick={() => onMonthChange(addMonths(month, -1))}>
            ←
          </button>
          <button type="button" className="button button-secondary button-small" onClick={() => onMonthChange(addMonths(month, 1))}>
            →
          </button>
        </div>
      </div>

      <div className="cal-grid" role="grid" aria-label={`Availability for ${monthLabel(month)}`}>
        {weekdays.map((day) => (
          <div key={day} className="cal-weekday" role="columnheader">
            {day}
          </div>
        ))}

        {weeks.flat().map(({ iso, inMonth }) => {
          const booking = inMonth ? findBooking(iso) : null;
          const mine = booking?.userId === myUserId;
          const past = iso < today;
          const selected = Boolean(rangeStart && rangeEnd && iso >= rangeStart && iso <= rangeEnd);
          const blocked = (minDay && iso < minDay) || (maxDay && iso > maxDay);
          const disabled = !onSelectDay || past || blocked || !inMonth;

          const classes = ['cal-day'];
          if (!inMonth) classes.push('is-dim');
          if (booking) classes.push(mine ? 'is-mine' : 'is-booked');
          if (past) classes.push('is-past');
          if (iso === today) classes.push('is-today');
          if (selected && inMonth) classes.push('is-selected');

          const title = booking
            ? `${formatDate(iso)} — booked by ${booking.userName} (${formatDate(booking.startDate, 'short')} to ${formatDate(booking.endDate, 'short')})`
            : `${formatDate(iso)} — free`;

          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              className={classes.join(' ')}
              title={title}
              aria-label={title}
              disabled={disabled}
              onClick={() => onSelectDay?.(iso)}
            >
              <span className="cal-num">{Number(iso.slice(8, 10))}</span>
              {booking ? <span className="cal-name">{booking.userName.split(' ')[0]}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span className="legend-item">
          <span className="swatch swatch-free" /> Free
        </span>
        <span className="legend-item">
          <span className="swatch swatch-booked" /> Booked
        </span>
        <span className="legend-item">
          <span className="swatch swatch-mine" /> Your booking
        </span>
      </div>
    </div>
  );
}
