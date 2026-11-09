import type { Booking, Item, LastUsed, Limits, Settings, User } from '../../shared/types';

export function mapUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? null,
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'active' || row.status === 'suspended' ? row.status : 'pending',
    avatarUrl: row.avatar_url ?? null,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export function overridesFromRow(row: any) {
  return {
    maxDays: row.max_days ?? null,
    maxBookingsPerPeriod: row.max_bookings_per_period ?? null,
    periodDays: row.period_days ?? null,
    minGapDays: row.min_gap_days ?? null,
    advanceDays: row.advance_days ?? null,
  };
}

export function effectiveLimits(row: any, settings: Settings): Limits {
  return {
    maxDays: row.max_days ?? settings.maxDays,
    maxBookingsPerPeriod: row.max_bookings_per_period ?? settings.maxBookingsPerPeriod,
    periodDays: row.period_days ?? settings.periodDays,
    minGapDays: row.min_gap_days ?? settings.minGapDays,
    advanceDays: row.advance_days ?? settings.advanceDays,
  };
}

export function itemToJson(row: any, settings: Settings): Item {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    category: row.category ?? null,
    photoKey: row.photo_key ?? null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    limits: effectiveLimits(row, settings),
    overrides: overridesFromRow(row),
    canBook: false,
    currentBooking: null,
    lastUsed: null,
  };
}

export function bookingSummary(row: any) {
  return {
    id: row.id,
    itemId: row.item_id,
    userId: row.user_id,
    userName: row.user_name ?? 'Member',
    startDate: row.start_date,
    endDate: row.end_date,
    status:
      row.status === 'cancelled' ? ('cancelled' as const) : row.status === 'pending' ? ('pending' as const) : ('confirmed' as const),
  };
}

export function lastUsedFromRow(row: any): LastUsed | null {
  if (!row) return null;
  return { userId: row.user_id, userName: row.user_name, endDate: row.end_date };
}

/** Booking JSON with derived report / address actions for the UI. */
export function bookingToJson(row: any, today: string): Booking {
  const hasStartReport = Number(row.has_start ?? 0) > 0;
  const hasEndReport = Number(row.has_end ?? 0) > 0;
  const hasAddress = Number(row.has_address ?? 0) > 0;
  const status =
    row.status === 'cancelled' ? ('cancelled' as const) : row.status === 'pending' ? ('pending' as const) : ('confirmed' as const);
  const confirmed = status === 'confirmed';

  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name ?? '',
    userId: row.user_id,
    userName: row.user_name ?? 'Member',
    startDate: row.start_date,
    endDate: row.end_date,
    status,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    hasStartReport,
    hasEndReport,
    hasAddress,
    actions: {
      needsStartReport: confirmed && !hasStartReport && row.end_date >= today,
      needsEndReport: confirmed && !hasEndReport && row.end_date <= today,
      needsAddress: confirmed && !hasAddress && row.end_date <= today,
      canCancel: status !== 'cancelled' && row.start_date > today,
      awaitingApproval: status === 'pending',
    },
  };
}
