import { Temporal } from '@js-temporal/polyfill';
import type { Due } from './types.js';
export function validTimezone(value: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}
export function dueInstant(due: Due, userZone: string, hour = 9): Temporal.Instant | null {
  try {
    if (!due.date || due.kind === 'none') return null;
    const date = Temporal.PlainDate.from(due.date);
    if (due.kind === 'date')
      return date
        .toZonedDateTime({ timeZone: userZone, plainTime: `${String(hour).padStart(2, '0')}:00` })
        .toInstant();
    if (!due.time || !due.timezone) return null;
    return Temporal.ZonedDateTime.from(`${date.toString()}T${due.time}[${due.timezone}]`, {
      disambiguation: 'reject',
    }).toInstant();
  } catch {
    return null;
  }
}
