import type { Env } from '../env';
import type { Settings } from '../../shared/types';
import { clampInt } from './util';

export const SETTING_KEYS = {
  orgName: 'org_name',
  timezone: 'timezone',
  maxDays: 'default_max_days',
  maxBookingsPerPeriod: 'default_max_bookings_per_period',
  periodDays: 'default_period_days',
  minGapDays: 'default_min_gap_days',
  advanceDays: 'default_advance_days',
  requireApproval: 'require_approval',
} as const;

export async function loadSettings(env: Env): Promise<Settings> {
  const rows = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = new Map(rows.results.map((row) => [row.key, row.value]));
  const read = (key: string) => map.get(key) ?? '';

  return {
    orgName: read(SETTING_KEYS.orgName) || env.APP_NAME || 'Caravan Club',
    timezone: read(SETTING_KEYS.timezone) || env.DEFAULT_TIMEZONE || 'UTC',
    maxDays: clampInt(read(SETTING_KEYS.maxDays), 7, 1, 365),
    maxBookingsPerPeriod: clampInt(read(SETTING_KEYS.maxBookingsPerPeriod), 2, 1, 100),
    periodDays: clampInt(read(SETTING_KEYS.periodDays), 30, 1, 3650),
    minGapDays: clampInt(read(SETTING_KEYS.minGapDays), 3, 0, 365),
    advanceDays: clampInt(read(SETTING_KEYS.advanceDays), 90, 1, 730),
    requireApproval: read(SETTING_KEYS.requireApproval) !== '0',
  };
}

export async function saveSettings(env: Env, patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings(env);
  const next: Settings = {
    orgName: typeof patch.orgName === 'string' && patch.orgName.trim() ? patch.orgName.trim().slice(0, 80) : current.orgName,
    timezone: isValidTimezone(patch.timezone) ? String(patch.timezone) : current.timezone,
    maxDays: patch.maxDays === undefined ? current.maxDays : clampInt(patch.maxDays, current.maxDays, 1, 365),
    maxBookingsPerPeriod:
      patch.maxBookingsPerPeriod === undefined
        ? current.maxBookingsPerPeriod
        : clampInt(patch.maxBookingsPerPeriod, current.maxBookingsPerPeriod, 1, 100),
    periodDays: patch.periodDays === undefined ? current.periodDays : clampInt(patch.periodDays, current.periodDays, 1, 3650),
    minGapDays: patch.minGapDays === undefined ? current.minGapDays : clampInt(patch.minGapDays, current.minGapDays, 0, 365),
    advanceDays: patch.advanceDays === undefined ? current.advanceDays : clampInt(patch.advanceDays, current.advanceDays, 1, 730),
    requireApproval: patch.requireApproval === undefined ? current.requireApproval : Boolean(patch.requireApproval),
  };

  const statements = [
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SETTING_KEYS.orgName, next.orgName),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SETTING_KEYS.timezone, next.timezone),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SETTING_KEYS.maxDays, String(next.maxDays)),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SETTING_KEYS.maxBookingsPerPeriod, String(next.maxBookingsPerPeriod)),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SETTING_KEYS.periodDays, String(next.periodDays)),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SETTING_KEYS.minGapDays, String(next.minGapDays)),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SETTING_KEYS.advanceDays, String(next.advanceDays)),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SETTING_KEYS.requireApproval, next.requireApproval ? '1' : '0'),
  ];
  await env.DB.batch(statements);
  return next;
}

export function isValidTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
