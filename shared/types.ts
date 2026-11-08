// API shapes shared between the Worker and the React client.

export type Role = 'admin' | 'user';
export type UserStatus = 'pending' | 'active' | 'suspended';
export type BookingStatus = 'confirmed' | 'cancelled';
export type ReportKind = 'start' | 'end';

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface Me extends User {
  itemIds: string[];
}

export interface AdminUser extends Me {
  bookingCount: number;
}

export interface Limits {
  maxDays: number;
  maxBookingsPerPeriod: number;
  periodDays: number;
  minGapDays: number;
  advanceDays: number;
}

export interface LimitOverrides {
  maxDays: number | null;
  maxBookingsPerPeriod: number | null;
  periodDays: number | null;
  minGapDays: number | null;
  advanceDays: number | null;
}

export interface BookingSummary {
  id: string;
  itemId: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  status: BookingStatus;
}

export interface LastUsed {
  userId: string;
  userName: string;
  endDate: string;
}

export interface Item {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  photoKey: string | null;
  active: boolean;
  createdAt: string;
  limits: Limits;
  overrides: LimitOverrides;
  canBook: boolean;
  currentBooking: BookingSummary | null;
  lastUsed: LastUsed | null;
}

export interface BookingActions {
  needsStartReport: boolean;
  needsEndReport: boolean;
  needsAddress: boolean;
  canCancel: boolean;
}

export interface Booking extends BookingSummary {
  itemName: string;
  notes: string | null;
  createdAt: string;
  hasStartReport: boolean;
  hasEndReport: boolean;
  hasAddress: boolean;
  actions: BookingActions;
}

export interface ReportSummary {
  id: string;
  bookingId: string;
  itemId: string;
  itemName?: string;
  userId: string;
  userName?: string;
  kind: ReportKind;
  mediaKey: string;
  mediaType: string;
  notes: string | null;
  createdAt: string;
  startDate?: string;
  endDate?: string;
}

export interface ReturnRecord {
  bookingId: string;
  address: string;
  notes: string | null;
  createdAt: string;
  userName?: string;
  itemName?: string;
  startDate?: string;
  endDate?: string;
}

export interface Settings {
  orgName: string;
  timezone: string;
  maxDays: number;
  maxBookingsPerPeriod: number;
  periodDays: number;
  minGapDays: number;
  advanceDays: number;
  requireApproval: boolean;
}

export interface Config {
  orgName: string;
  timezone: string;
  googleEnabled: boolean;
  emailEnabled: boolean;
  approvalRequired: boolean;
}

export interface ItemDetail {
  item: Item;
  bookings: BookingSummary[];
  myBookings: Booking[];
  today: string;
}

export interface AdminItem extends Item {
  archivedBookingCount: number;
}

export interface AdminReportRow {
  report: ReportSummary;
  booking: { startDate: string; endDate: string };
}
