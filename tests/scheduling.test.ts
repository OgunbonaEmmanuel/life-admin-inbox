import { describe, it, expect } from 'vitest';
import { schedule, dueInstant } from '../server/scheduling';
import { defaultProfile } from '../server/repository';
import type { Task, Profile } from '../shared/types';
import { taskDay, dueLabel } from '../src/components';
const profile: Profile = {
  ...defaultProfile('test@example.test'),
  onboarded: true,
  timezone: 'America/New_York',
};
function task(
  date: string,
  kind: 'date' | 'datetime' = 'date',
): Pick<Task, 'state' | 'due' | 'attention'> {
  return {
    state: 'open',
    attention: [],
    due: {
      kind,
      date,
      time: kind === 'datetime' ? '09:00' : null,
      timezone: kind === 'datetime' ? 'America/New_York' : null,
    },
  };
}
describe('durable reminder planning', () => {
  it('date-only reminders remain 9 AM through spring DST', () => {
    expect(schedule(task('2026-03-08'), profile, new Date('2026-03-01'))).toEqual([
      '2026-03-07T14:00:00Z',
      '2026-03-08T13:00:00Z',
    ]);
  });
  it('date-only reminders remain 9 AM through autumn DST', () => {
    expect(schedule(task('2026-11-01'), profile, new Date('2026-10-01'))).toEqual([
      '2026-10-31T13:00:00Z',
      '2026-11-01T14:00:00Z',
    ]);
  });
  it('timed appointments use exactly 24 hours before', () => {
    expect(schedule(task('2026-03-08', 'datetime'), profile, new Date('2026-03-01'))).toEqual([
      '2026-03-07T13:00:00Z',
      '2026-03-08T13:00:00Z',
    ]);
  });
  it('rejects repeated and nonexistent appointment wall times', () => {
    expect(
      dueInstant({ ...task('2026-03-08', 'datetime').due, time: '02:30' }, profile.timezone),
    ).toBeNull();
    expect(
      dueInstant({ ...task('2026-11-01', 'datetime').due, time: '01:30' }, profile.timezone),
    ).toBeNull();
  });
  it('skips stale slots at discovery and deduplicates coincident reminders', () => {
    expect(schedule(task('2026-03-08'), profile, new Date('2026-03-08T12:00:00Z'))).toEqual([
      '2026-03-08T13:00:00Z',
    ]);
    expect(
      schedule(task('2026-03-08'), { ...profile, leadDays: 0 }, new Date('2026-03-01')),
    ).toHaveLength(1);
    expect(schedule(task('2026-03-08'), profile, new Date('2026-03-09'))).toEqual([]);
  });
  it('requires onboarding, dates and resolution of uncertainty', () => {
    expect(
      schedule(task('2026-03-08'), { ...profile, onboarded: false }, new Date('2026-03-01')),
    ).toEqual([]);
    expect(
      schedule(
        { ...task('2026-03-08'), attention: ['uncertain'] },
        profile,
        new Date('2026-03-01'),
      ),
    ).toEqual([]);
    expect(
      schedule({ ...task('2026-03-08'), state: 'completed' }, profile, new Date('2026-03-01')),
    ).toEqual([]);
  });
  it('displays timed appointments on the viewer’s actual local day', () => {
    const appointment = {
      ...task('2035-06-01', 'datetime'),
      due: { kind: 'datetime', date: '2035-06-01', time: '23:30', timezone: 'America/New_York' },
    } as Task;
    expect(taskDay(appointment, 'Africa/Lagos')).toBe('2035-06-02');
    expect(dueLabel(appointment, '2035-06-02', 'Africa/Lagos')).toBe('Today · 04:30');
  });
});
