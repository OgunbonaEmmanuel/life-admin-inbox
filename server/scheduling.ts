import { Temporal } from '@js-temporal/polyfill';
import type { Profile, Task } from '../shared/types.js';
import { dueInstant } from '../shared/time.js';
export { dueInstant, validTimezone } from '../shared/time.js';
export function schedule(
  task: Pick<Task, 'state' | 'due' | 'attention'>,
  profile: Profile,
  now = new Date(),
): string[] {
  if (task.state !== 'open' || task.attention.length || !profile.onboarded) return [];
  const due = dueInstant(task.due, profile.timezone, profile.reminderHour);
  if (!due) return [];
  let before: Temporal.Instant;
  if (task.due.kind === 'date') {
    const day = Temporal.PlainDate.from(task.due.date!).subtract({ days: profile.leadDays });
    before = day
      .toZonedDateTime({
        timeZone: profile.timezone,
        plainTime: `${String(profile.reminderHour).padStart(2, '0')}:00`,
      })
      .toInstant();
  } else before = due.subtract({ hours: profile.leadDays * 24 });
  return [...new Set([before.toString(), due.toString()])]
    .filter((t) => Temporal.Instant.compare(t, now.toISOString()) > 0)
    .sort();
}
