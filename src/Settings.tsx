import { useState, type FormEvent } from 'react';
import { Bell, Mail, Globe, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import type { AppConfig, Profile, Notice } from '../shared/types';
import { api } from './api';
import { enablePush, disablePush } from './notifications';
export default function Settings({
  profile,
  config,
  reminders,
  onSaved,
  notify,
}: {
  profile: Profile;
  config: AppConfig;
  reminders: Notice[];
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [form, setForm] = useState(profile),
    [busy, setBusy] = useState(false);
  const zones = Intl.supportedValuesOf?.('timeZone') || [
    'Africa/Lagos',
    'UTC',
    'Europe/London',
    'America/New_York',
  ];
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { email, ...patch } = form;
      void email;
      await api('/profile', { ...patch, onboarded: true }, 'PATCH');
      await onSaved();
      notify('Your preferences are saved. Future reminders have been updated.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function push(enable: boolean) {
    setBusy(true);
    try {
      if (enable) await enablePush(config.vapidPublicKey);
      else await disablePush();
      setForm({ ...form, pushEnabled: enable });
      await onSaved();
      notify(
        enable
          ? 'This browser is subscribed. Delivery still depends on browser and provider availability.'
          : 'Browser push disabled.',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <form className="settings-form" onSubmit={save}>
        <section className="settings-section">
          <div className="section-icon">
            <Globe size={21} />
          </div>
          <div>
            <h2>Your rhythm</h2>
            <p>Make sure your reminders arrive at the right local time.</p>
            <div className="form-grid">
              <label>
                Your name
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={60}
                  required
                />
              </label>
              <label>
                Timezone
                <input
                  list="timezones"
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  required
                />
                <datalist id="timezones">
                  <option value="UTC" />
                  {zones.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </label>
              <label>
                First reminder
                <select
                  value={form.leadDays}
                  onChange={(e) => setForm({ ...form, leadDays: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3, 7, 14].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'On the due date only' : `${n} day${n > 1 ? 's' : ''} before`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date-only reminder hour
                <select
                  value={form.reminderHour}
                  onChange={(e) => setForm({ ...form, reminderHour: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00 local time
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="fine-print">
              By default: 9 AM on the previous day and due date. Timed appointments use exactly 24
              hours before and the appointment time. Date-only reminders follow your timezone
              through daylight-saving changes.
            </p>
          </div>
        </section>
        <section className="settings-section">
          <div className="section-icon">
            <Bell size={21} />
          </div>
          <div>
            <h2>A nudge, your way</h2>
            <p>Notification previews keep document details private.</p>
            <label className="toggle-row">
              <span>
                <strong>
                  <Mail size={16} /> Email reminders
                </strong>
                <small>{profile.email}</small>
              </span>
              <input
                type="checkbox"
                checked={form.emailEnabled}
                onChange={(e) => setForm({ ...form, emailEnabled: e.target.checked })}
              />
            </label>
            <div className="toggle-row">
              <span>
                <strong>
                  <Bell size={16} /> Browser push
                </strong>
                <small>
                  {form.pushEnabled
                    ? 'Enabled for subscribed browsers'
                    : 'Request permission when you’re ready'}
                </small>
              </span>
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() => void push(!form.pushEnabled)}
              >
                {form.pushEnabled ? 'Disable' : 'Enable notifications'}
              </button>
            </div>
            <p className="fine-print">
              Push needs a supported browser, permission, and a working network. Some mobile
              browsers require installing this site first. Notifications cannot appear while a
              device is powered off. Provider acceptance does not prove inbox or device delivery.
            </p>
          </div>
        </section>
        <div className="settings-actions">
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>
      <aside>
        <div className="note-card">
          <ShieldCheck size={23} />
          <h3>Private by design</h3>
          <p>
            Originals are stored privately. Extraction sends document text and relevant images to
            OpenAI. Hosting and storage providers also process your data.
          </p>
          <p>
            Deleting a document removes its tasks and cancels reminders. Storage cleanup may retry;
            provider backups can retain data under their policies.
          </p>
        </div>
        <div className="integration-card">
          <h3>Connections</h3>
          {[
            ['OpenAI extraction', config.openaiConfigured],
            ['Account sign-in', config.authConfigured],
            ['Email provider', config.emailConfigured],
            ['Browser push', config.pushConfigured],
          ].map(([label, ok]) => (
            <div className="connection" key={String(label)}>
              <span>{label}</span>
              {ok ? (
                <span className="connection-ok">
                  <CheckCircle2 size={14} /> Configured
                </span>
              ) : (
                <span className="connection-missing">
                  <AlertCircle size={14} /> Setup needed
                </span>
              )}
            </div>
          ))}
          <p className="fine-print">
            “Configured” means credentials are present; it is not a live delivery test.
            {config.development
              ? ' Development delivery is limited to explicit test destinations.'
              : ''}
          </p>
        </div>
      </aside>
      <section className="delivery-log">
        <h2>Reminder activity</h2>
        <p>These are in-app records, separate from browser push.</p>
        {!reminders.length ? (
          <p className="fine-print">
            No reminder activity yet. Confirm your timezone and add a dated task.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scheduled</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {reminders.slice(0, 30).map((r) => (
                  <tr key={r.id}>
                    <td>
                      {new Date(r.scheduled_at).toLocaleString('en-GB', {
                        timeZone: profile.timezone,
                      })}
                    </td>
                    <td>{r.channel}</td>
                    <td>
                      <span className="status-pill">
                        {r.status === 'accepted' ? 'Provider accepted' : r.status}
                      </span>
                    </td>
                    <td>{r.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
