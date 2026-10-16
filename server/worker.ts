import { randomUUID } from 'node:crypto';
import { config, LIMITS } from './config.js';
import { Repository, lockProfile, type Job, type DocRow } from './repository.js';
import { parseIsolated } from './parser.js';
import { extract } from './extraction.js';
import type { Storage } from './storage.js';
import type { Task } from '../shared/types.js';
import { delivery, DeliveryBlocked, type Delivery } from './notifications.js';
import type webpush from 'web-push';
export async function claimJob(repo: Repository): Promise<Job | undefined> {
  return repo.db.transaction(async (q) => {
    // Recover interrupted upload staging. Cleanup is idempotent even if put never finished.
    await q.query(
      "UPDATE lifeadmin.jobs SET kind='cleanup',state='queued' WHERE state='staging' AND available_at < now()-interval '10 minutes'",
    );
    const row = (
      await q.query<Job>(
        `WITH candidate AS (
      SELECT id FROM lifeadmin.jobs WHERE (state='queued' AND available_at<=now()) OR (state='processing' AND lease_until<now())
      ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE lifeadmin.jobs j SET state='processing',attempts=attempts+1,lease_until=now()+interval '5 minutes',lease_token=$1
      FROM candidate c WHERE j.id=c.id RETURNING j.*`,
        [randomUUID()],
      )
    ).rows[0];
    return row;
  });
}
export async function processJob(repo: Repository, storage: Storage, job: Job) {
  if (job.kind === 'cleanup') {
    try {
      const row = await repo.db.transaction(
        async (q) =>
          (
            await q.query<DocRow>('SELECT * FROM lifeadmin.documents WHERE id=$1', [
              job.document_id,
            ])
          ).rows[0],
        job.user_id,
      );
      if (row) await storage.remove(job.user_id, row.object_key);
      await repo.db.transaction(async (q) => {
        const owned = (
          await q.query('SELECT id FROM lifeadmin.jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE', [
            job.id,
            job.lease_token,
          ])
        ).rows[0];
        if (owned) await q.query('DELETE FROM lifeadmin.documents WHERE id=$1', [job.document_id]);
      }, job.user_id);
    } catch {
      await repo.db.transaction(
        (q) =>
          q.query(
            "UPDATE lifeadmin.jobs SET state='queued',available_at=now()+interval '10 minutes',error='Private storage cleanup will retry.',lease_token=NULL WHERE id=$1 AND lease_token=$2",
            [job.id, job.lease_token],
          ),
        job.user_id,
      );
    }
    return;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const row = await repo.db.transaction(async (q) => {
      await lockProfile(q, job.user_id);
      const document = (
        await q.query<DocRow>(
          'SELECT * FROM lifeadmin.documents WHERE id=$1 AND NOT deleted FOR UPDATE',
          [job.document_id],
        )
      ).rows[0];
      if (!document) return;
      if (job.attempts > LIMITS.retriesPerDocument)
        throw new Error('Document extraction attempt limit reached.');
      await q.query('INSERT INTO lifeadmin.usage (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [
        job.user_id,
      ]);
      if (
        !(
          await q.query(
            'UPDATE lifeadmin.usage SET extractions=extractions+1 WHERE user_id=$1 AND day=CURRENT_DATE AND extractions<$2 RETURNING user_id',
            [job.user_id, LIMITS.extractionsPerDay],
          )
        ).rows.length
      )
        throw new Error('Daily extraction limit reached.');
      document.data.state = 'processing';
      document.data.attempts = job.attempts;
      await q.query('UPDATE lifeadmin.documents SET data=$2 WHERE id=$1', [
        document.id,
        JSON.stringify(document.data),
      ]);
      return document;
    }, job.user_id);
    if (!row) return;
    if (!config.openaiKey)
      throw new DeliveryBlocked('OpenAI is not configured. Add the backend API key and retry.');
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), LIMITS.extractionMs);
    const bytes = await storage.get(job.user_id, row.object_key);
    const parsed = await parseIsolated(bytes);
    const result = await extract(parsed, controller.signal);
    await repo.persistExtraction(job, result);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const retry =
      (status === 429 || (status !== undefined && status >= 500)) &&
      job.attempts < LIMITS.retriesPerDocument;
    const message =
      e instanceof DeliveryBlocked
        ? e.message
        : status === 429
          ? 'Provider rate limit reached. Retry after the backoff.'
          : 'Extraction failed or exceeded a limit. Check the document and provider configuration, then retry.';
    await repo.db.transaction(async (q) => {
      const active = (
        await q.query('SELECT id FROM lifeadmin.jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE', [
          job.id,
          job.lease_token,
        ])
      ).rows[0];
      if (!active) return;
      await q.query(
        `UPDATE lifeadmin.jobs SET state=$3,error=$4,available_at=now()+interval '2 minutes',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`,
        [job.id, job.lease_token, retry ? 'queued' : 'failed', message],
      );
      await q.query(
        "UPDATE lifeadmin.documents SET data=data || jsonb_build_object('state',$2::text,'warning',$3::text,'attempts',$4::int) WHERE id=$1 AND NOT deleted",
        [job.document_id, retry ? 'queued' : 'failed', message, job.attempts],
      );
    }, job.user_id);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
export interface Reminder {
  id: string;
  user_id: string;
  task_id: string;
  revision: number;
  channel: 'email' | 'push';
  scheduled_at: string;
  attempts: number;
  lease_token: string;
}
export async function claimReminder(repo: Repository): Promise<Reminder | undefined> {
  return repo.db.transaction(async (q) => {
    await q.query(
      "UPDATE lifeadmin.reminders SET status='expired',error='This reminder was over one hour late and was not sent.' WHERE status IN ('scheduled','blocked','processing') AND scheduled_at<now()-interval '1 hour'",
    );
    return (
      await q.query<Reminder>(
        `WITH candidate AS (
      SELECT id FROM lifeadmin.reminders WHERE scheduled_at<=now() AND available_at<=now() AND
      (status IN ('scheduled','blocked') OR (status='processing' AND lease_until<now()))
      ORDER BY scheduled_at DESC FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE lifeadmin.reminders r SET status='processing',lease_until=now()+interval '3 minutes',lease_token=$1
      FROM candidate c WHERE r.id=c.id RETURNING r.*`,
        [randomUUID()],
      )
    ).rows[0];
  });
}
export async function processReminder(
  repo: Repository,
  reminder: Reminder,
  provider: Delivery = delivery,
) {
  // Locking the profile serializes sends with edits, completion, deletion and channel changes.
  // A send already accepted by an external provider cannot be recalled.
  await repo.db.transaction(async (q) => {
    const profile = await lockProfile(q, reminder.user_id);
    const current = (
      await q.query<Reminder>(
        "SELECT * FROM lifeadmin.reminders WHERE id=$1 AND lease_token=$2 AND status='processing' FOR UPDATE",
        [reminder.id, reminder.lease_token],
      )
    ).rows[0];
    if (!current) return;
    const task = (
      await q.query<{ data: Task }>('SELECT data FROM lifeadmin.tasks WHERE id=$1', [
        reminder.task_id,
      ])
    ).rows[0]?.data;
    let state = 'accepted',
      error: string | null = null,
      providerId: string | null = null;
    try {
      if (
        !task ||
        task.state !== 'open' ||
        task.revision !== reminder.revision ||
        task.attention.length ||
        !profile?.onboarded ||
        (reminder.channel === 'email' ? !profile.emailEnabled : !profile.pushEnabled)
      )
        state = 'cancelled';
      else if (task.synthetic) {
        state = 'skipped';
        error = 'Synthetic examples never send external notifications.';
      } else if (current.attempts >= 3) {
        state = 'failed';
        error = 'Delivery retry limit reached.';
      } else if (reminder.channel === 'email')
        providerId = await provider.email(profile, reminder.id);
      else {
        const subscriptions = (
          await q.query<{ id: string; data: webpush.PushSubscription }>(
            'SELECT id,data FROM lifeadmin.push_subscriptions',
          )
        ).rows;
        if (!subscriptions.length)
          throw new DeliveryBlocked(
            'No active push subscriptions. Enable browser notifications in Settings.',
          );
        let accepted = 0;
        for (const subscription of subscriptions) {
          const prior = (
            await q.query(
              'SELECT subscription_id FROM lifeadmin.push_receipts WHERE reminder_id=$1 AND subscription_id=$2',
              [reminder.id, subscription.id],
            )
          ).rows[0];
          if (prior) {
            accepted++;
            continue;
          }
          try {
            await provider.push(subscription.data, reminder.id);
            accepted++;
            await q.query(
              'INSERT INTO lifeadmin.push_receipts (reminder_id,subscription_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
              [reminder.id, subscription.id, reminder.user_id],
            );
          } catch (e) {
            if ([404, 410].includes((e as { statusCode: number }).statusCode))
              await q.query('DELETE FROM lifeadmin.push_subscriptions WHERE id=$1', [
                subscription.id,
              ]);
            else throw e;
          }
        }
        if (!accepted)
          throw new DeliveryBlocked(
            'Push subscriptions expired. Enable browser notifications again.',
          );
        providerId = `push-service-accepted:${accepted}`;
      }
    } catch (e) {
      if (e instanceof DeliveryBlocked) {
        state = 'blocked';
        error = e.message;
      } else {
        state = current.attempts >= 2 ? 'failed' : 'scheduled';
        error = 'Provider did not confirm acceptance. A bounded retry may follow.';
      }
    }
    await q.query(
      `UPDATE lifeadmin.reminders SET status=$2,error=$3,provider_id=$4,attempts=attempts+$5,available_at=now()+interval '5 minutes',lease_token=NULL,lease_until=NULL WHERE id=$1`,
      [
        reminder.id,
        state,
        error,
        providerId,
        state === 'blocked' || state === 'cancelled' || state === 'skipped' ? 0 : 1,
      ],
    );
  }, reminder.user_id);
}
export function startWorker(repo: Repository, storage: Storage) {
  let stopped = false,
    running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const job = await claimJob(repo);
      if (job) await processJob(repo, storage, job);
      for (let i = 0; i < 10; i++) {
        const reminder = await claimReminder(repo);
        if (!reminder) break;
        await processReminder(repo, reminder);
      }
    } catch {
      console.error('Worker cycle failed; persisted jobs remain recoverable.');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 2000);
  void tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  };
}
