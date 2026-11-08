import type { Limits, LastUsed } from '../../shared/types';
import { formatDate } from '../../shared/dates';

export function limitSummary(limits: Limits): string {
  const parts = [
    `max ${limits.maxDays} day${limits.maxDays === 1 ? '' : 's'} per booking`,
    `${limits.maxBookingsPerPeriod} booking${limits.maxBookingsPerPeriod === 1 ? '' : 's'} per ${limits.periodDays} days`,
    limits.minGapDays > 0 ? `${limits.minGapDays} day gap` : null,
    `${limits.advanceDays} days ahead`,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function lastUsedLine(lastUsed: LastUsed | null): string {
  if (!lastUsed) return 'Not used yet';
  return `${lastUsed.userName} last used it · ${formatDate(lastUsed.endDate, 'short')}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
