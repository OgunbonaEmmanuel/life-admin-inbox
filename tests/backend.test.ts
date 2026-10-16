import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createDatabase } from '../server/db';
import { Repository, type Job } from '../server/repository';
import { createStorage } from '../server/storage';
import { createApp, DEMO_USER, SECOND_USER } from '../server/app';
import { claimJob, claimReminder, processReminder, processJob } from '../server/worker';
import { DeliveryBlocked, validPushEndpoint } from '../server/notifications';
import type { Task, Source } from '../shared/types';
let repo: Repository, folder: string, server: Server, url: string;
const future = '2035-06-15';
const source: Source = {
  id: 'page:1',
  kind: 'pdf',
  page: 1,
  label: 'Page 1',
  text: 'Please pay USD 35 by 2035-06-15.',
};
const candidate = {
  title: 'Pay bill',
  category: 'payment' as const,
  due: { kind: 'date' as const, date: future, time: null, timezone: null },
  amount: '35',
  currency: 'USD',
  organization: null,
  excerpt: source.text,
  sourceId: source.id,
  attention: [],
  state: 'open' as const,
};
async function setupTask() {
  const result = await repo.createDocument(
    DEMO_USER,
    'bill.pdf',
    Buffer.from(randomUUID()),
    'application/pdf',
  );
  await repo.activateDocument(DEMO_USER, result.document.id);
  const job = (await claimJob(repo))!;
  await repo.persistExtraction(job, {
    tasks: [candidate],
    sources: [source],
    rejected: 0,
    notes: [],
  });
  const task = (await repo.snapshot(DEMO_USER)).tasks[0];
  return { task, document: result.document, job };
}
async function call(route: string, user = 'demo', method = 'GET', body?: unknown) {
  return fetch(`${url}/api${route}`, {
    method,
    headers: { 'X-Development-User': user, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'lifeadmin-tests-'));
  repo = new Repository(await createDatabase(path.join(folder, 'db')));
  await repo.db.migrate();
  const app = createApp(repo, createStorage(path.join(folder, 'originals')));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  await repo.db.transaction(async (q) => {
    await q.query('DELETE FROM lifeadmin.documents');
    await q.query('DELETE FROM lifeadmin.profiles');
    await q.query('DELETE FROM lifeadmin.push_subscriptions');
    await q.query('DELETE FROM lifeadmin.usage');
  });
  for (const user of [DEMO_USER, SECOND_USER]) {
    await repo.ensureProfile(user, `${user}@example.test`);
    await repo.updateProfile(user, { onboarded: true, timezone: 'Africa/Lagos' });
  }
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await repo.db.close();
  if (
    path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) ||
    !path.basename(folder).startsWith('lifeadmin-tests-')
  )
    throw new Error('Refusing to remove an unexpected test directory.');
  await rm(folder, { recursive: true, force: true });
});
describe('PostgreSQL transactions and ownership', () => {
  it('deduplicates concurrent uploads and claims a job once', async () => {
    const bytes = Buffer.from('same bytes');
    const results = await Promise.all([
      repo.createDocument(DEMO_USER, 'a.pdf', bytes, 'application/pdf'),
      repo.createDocument(DEMO_USER, 'b.pdf', bytes, 'application/pdf'),
    ]);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    expect(results[0].document.id).toBe(results[1].document.id);
    await repo.activateDocument(DEMO_USER, results[0].document.id);
    const jobs = await Promise.all([claimJob(repo), claimJob(repo)]);
    expect(jobs.filter(Boolean)).toHaveLength(1);
  });
  it('creates tasks and reminders exactly once on repeated job completion', async () => {
    const { task, job } = await setupTask();
    await repo.persistExtraction(job, {
      tasks: [candidate],
      sources: [source],
      rejected: 0,
      notes: [],
    });
    const snapshot = await repo.snapshot(DEMO_USER);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.reminders).toHaveLength(2);
    expect(task.edited).toBe(false);
  });
  it('preserves user edits and deleted-task tombstones across extraction retries', async () => {
    const { task, document } = await setupTask();
    await repo.updateTask(DEMO_USER, task.id, { title: 'My edited bill' });
    await repo.retry(DEMO_USER, document.id);
    const retry = (await claimJob(repo))!;
    await repo.persistExtraction(retry, {
      tasks: [{ ...candidate, title: 'Different model title', excerpt: source.text + ' ' }],
      sources: [{ ...source, text: 'Changed OCR' }],
      rejected: 0,
      notes: [],
    });
    expect((await repo.snapshot(DEMO_USER)).tasks[0].title).toBe('My edited bill');
    expect((await repo.snapshot(DEMO_USER)).documents[0].sources[0].text).toBe(source.text);
    await repo.updateTask(DEMO_USER, task.id, { state: 'deleted' });
    await repo.retry(DEMO_USER, document.id);
    await repo.persistExtraction((await claimJob(repo))!, {
      tasks: [candidate],
      sources: [source],
      rejected: 0,
      notes: [],
    });
    expect((await repo.snapshot(DEMO_USER)).tasks).toHaveLength(0);
  });
  it('cancels/reschedules after edits, timezone changes, completion and reopen', async () => {
    const { task } = await setupTask();
    await repo.updateTask(DEMO_USER, task.id, { due: { ...task.due, date: '2035-06-20' } });
    let reminders = (await repo.snapshot(DEMO_USER)).reminders;
    expect(reminders.filter((r) => r.status === 'cancelled')).toHaveLength(2);
    expect(reminders.filter((r) => r.status === 'scheduled')).toHaveLength(2);
    await repo.updateProfile(DEMO_USER, { timezone: 'America/New_York' });
    reminders = (await repo.snapshot(DEMO_USER)).reminders;
    expect(reminders.filter((r) => r.status === 'scheduled')).toHaveLength(2);
    await repo.updateTask(DEMO_USER, task.id, { state: 'completed' });
    expect((await repo.snapshot(DEMO_USER)).reminders.every((r) => r.status === 'cancelled')).toBe(
      true,
    );
    await repo.updateTask(DEMO_USER, task.id, { state: 'open' });
    expect(
      (await repo.snapshot(DEMO_USER)).reminders.filter((r) => r.status === 'scheduled'),
    ).toHaveLength(2);
  });
  it('enforces RLS even if a query omits the ownership WHERE clause', async () => {
    const { task, document } = await setupTask();
    for (const table of ['documents', 'tasks', 'jobs', 'reminders']) {
      const rows = await repo.db.transaction(
        (q) => q.query(`SELECT * FROM lifeadmin.${table}`),
        SECOND_USER,
      );
      expect(rows.rows).toHaveLength(0);
    }
    await expect(repo.updateTask(SECOND_USER, task.id, { title: 'Stolen' })).rejects.toThrow(
      'Task not found',
    );
    await expect(repo.document(SECOND_USER, document.id)).rejects.toThrow('Document not found');
    await expect(
      repo.db.transaction(
        (q) =>
          q.query('INSERT INTO lifeadmin.profiles (user_id,data) VALUES ($1,$2)', [
            randomUUID(),
            '{}',
          ]),
        SECOND_USER,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
  it('rejects cross-user API task edits, deletion, retries and downloads', async () => {
    const { task, document } = await setupTask();
    for (const [route, method, body] of [
      [`/tasks/${task.id}`, 'PATCH', { title: 'Stolen' }],
      [`/tasks/${task.id}`, 'DELETE', {}],
      [`/documents/${document.id}/retry`, 'POST', {}],
      [`/documents/${document.id}`, 'DELETE', {}],
      [`/documents/${document.id}/download`, 'GET', undefined],
    ] as const) {
      expect((await call(route, 'second', method, body)).status).toBe(404);
    }
    expect((await call('/inbox', 'missing')).status).toBe(401);
    expect((await (await call('/inbox', 'second')).json()).tasks).toEqual([]);
  });
  it('rejects cross-user push updates/deletes and unsafe endpoints', async () => {
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
    };
    expect((await call('/push-subscriptions', 'demo', 'POST', sub)).status).toBe(200);
    expect(
      (await call('/push-subscriptions', 'second', 'POST', sub)).status,
    ).toBeGreaterThanOrEqual(400);
    await call('/push-subscriptions', 'second', 'DELETE', { endpoint: sub.endpoint });
    expect(
      (
        await repo.db.transaction(
          (q) => q.query('SELECT * FROM lifeadmin.push_subscriptions'),
          DEMO_USER,
        )
      ).rows,
    ).toHaveLength(1);
    for (const endpoint of [
      'http://127.0.0.1/x',
      'https://localhost/x',
      'https://fcm.googleapis.com.attacker.test/x',
      'https://user@fcm.googleapis.com/x',
    ])
      expect(validPushEndpoint(endpoint)).toBe(false);
  });
  it('persists jobs through database restart and fences the stale worker', async () => {
    const doc = await repo.createDocument(
      DEMO_USER,
      'restart.pdf',
      Buffer.from('restart'),
      'application/pdf',
    );
    await repo.activateDocument(DEMO_USER, doc.document.id);
    const first = (await claimJob(repo))!;
    await repo.db.transaction((q) =>
      q.query("UPDATE lifeadmin.jobs SET lease_until=now()-interval '1 minute' WHERE id=$1", [
        first.id,
      ]),
    );
    await repo.db.close();
    repo.db = await createDatabase(path.join(folder, 'db'));
    const second = (await claimJob(repo))!;
    expect(second.id).toBe(first.id);
    expect(second.lease_token).not.toBe(first.lease_token);
    await repo.persistExtraction(first, {
      tasks: [candidate],
      sources: [source],
      rejected: 0,
      notes: [],
    });
    expect((await repo.snapshot(DEMO_USER)).tasks).toHaveLength(0);
    await repo.persistExtraction(second, {
      tasks: [candidate],
      sources: [source],
      rejected: 0,
      notes: [],
    });
    expect((await repo.snapshot(DEMO_USER)).tasks).toHaveLength(1);
  });
  it('deletes associated tasks/reminders immediately and retries private cleanup', async () => {
    const { task, document } = await setupTask();
    await repo.deleteDocument(DEMO_USER, document.id);
    expect((await repo.snapshot(DEMO_USER)).tasks).toEqual([]);
    expect((await repo.snapshot(DEMO_USER)).reminders).toEqual([]);
    await expect(repo.updateTask(DEMO_USER, task.id, { state: 'open' })).rejects.toThrow();
    const job = (await claimJob(repo))!;
    expect(job.kind).toBe('cleanup');
    const storage = {
      get: vi.fn(),
      put: vi.fn(),
      remove: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined),
    };
    await processJob(repo, storage, job);
    await repo.db.transaction((q) => q.query('UPDATE lifeadmin.jobs SET available_at=now()'));
    await processJob(repo, storage, (await claimJob(repo))!);
    expect(
      (await repo.db.transaction((q) => q.query('SELECT * FROM lifeadmin.documents'))).rows,
    ).toEqual([]);
  });
  it('enforces daily upload quota atomically', async () => {
    await repo.db.transaction(
      (q) => q.query('INSERT INTO lifeadmin.usage (user_id,uploads) VALUES ($1,19)', [DEMO_USER]),
      DEMO_USER,
    );
    const results = await Promise.allSettled([
      repo.consumeUpload(DEMO_USER),
      repo.consumeUpload(DEMO_USER),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
describe('delivery state machine with explicit test providers', () => {
  it('does not resend a subscription already accepted during an ordinary partial retry', async () => {
    const { task } = await setupTask();
    await repo.db.transaction(async (q) => {
      await q.query(
        "UPDATE lifeadmin.profiles SET data=jsonb_set(data,'{pushEnabled}','true') WHERE user_id=$1",
        [DEMO_USER],
      );
      await q.query(
        "UPDATE lifeadmin.reminders SET channel='push',scheduled_at=now()-interval '5 minutes',available_at=now() WHERE id=(SELECT id FROM lifeadmin.reminders LIMIT 1)",
      );
      for (const suffix of ['one', 'two'])
        await q.query(
          'INSERT INTO lifeadmin.push_subscriptions (id,user_id,endpoint,data) VALUES ($1,$2,$3,$4)',
          [
            randomUUID(),
            DEMO_USER,
            `https://fcm.googleapis.com/fcm/send/${suffix}`,
            JSON.stringify({
              endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
              keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
            }),
          ],
        );
    });
    void task;
    const provider = {
      email: vi.fn(),
      push: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValue(undefined),
    };
    await processReminder(repo, (await claimReminder(repo))!, provider);
    await repo.db.transaction((q) =>
      q.query("UPDATE lifeadmin.reminders SET available_at=now() WHERE status='scheduled'"),
    );
    await processReminder(repo, (await claimReminder(repo))!, provider);
    expect(provider.push).toHaveBeenCalledTimes(3);
    expect(
      (
        await repo.db.transaction(
          (q) => q.query('SELECT * FROM lifeadmin.push_receipts'),
          DEMO_USER,
        )
      ).rows,
    ).toHaveLength(2);
  });
  async function ready() {
    const { task } = await setupTask();
    await repo.db.transaction((q) =>
      q.query(
        "UPDATE lifeadmin.reminders SET scheduled_at=now()-interval '5 minutes',available_at=now() WHERE id=(SELECT id FROM lifeadmin.reminders LIMIT 1)",
      ),
    );
    return { task, reminder: (await claimReminder(repo))! };
  }
  it('does not mark delivery on queueing; provider acknowledgement becomes accepted', async () => {
    const { reminder } = await ready();
    expect(
      (await repo.snapshot(DEMO_USER)).reminders.find((r) => r.id === reminder.id)?.status,
    ).toBe('processing');
    const provider = { email: vi.fn().mockResolvedValue('provider-test-id'), push: vi.fn() };
    await processReminder(repo, reminder, provider);
    expect(
      (await repo.snapshot(DEMO_USER)).reminders.find((r) => r.id === reminder.id)?.status,
    ).toBe('accepted');
    expect(provider.email).toHaveBeenCalledTimes(1);
    await processReminder(repo, reminder, provider);
    expect(provider.email).toHaveBeenCalledTimes(1);
  });
  it('shows missing providers as blocked and cancels a claimed send after completion', async () => {
    const { task, reminder } = await ready();
    const provider = {
      email: vi.fn().mockRejectedValue(new DeliveryBlocked('Missing test provider')),
      push: vi.fn(),
    };
    await processReminder(repo, reminder, provider);
    expect(
      (await repo.snapshot(DEMO_USER)).reminders.find((r) => r.id === reminder.id)?.status,
    ).toBe('blocked');
    await repo.updateTask(DEMO_USER, task.id, { state: 'completed' });
    await processReminder(repo, reminder, provider);
    expect(provider.email).toHaveBeenCalledTimes(1);
  });
  it('expires stale reminders after downtime without sending a burst', async () => {
    await setupTask();
    await repo.db.transaction((q) =>
      q.query(
        "UPDATE lifeadmin.reminders SET scheduled_at=scheduled_at-interval '20 years',available_at=now()",
      ),
    );
    expect(await claimReminder(repo)).toBeUndefined();
    expect((await repo.snapshot(DEMO_USER)).reminders.every((r) => r.status === 'expired')).toBe(
      true,
    );
  });
  it('removes expired push subscriptions and reports the blocked delivery', async () => {
    const { reminder } = await ready();
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/expired',
      keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
    };
    await repo.db.transaction(async (q) => {
      await q.query(
        "UPDATE lifeadmin.profiles SET data=jsonb_set(data,'{pushEnabled}','true') WHERE user_id=$1",
        [DEMO_USER],
      );
      await q.query("UPDATE lifeadmin.reminders SET channel='push' WHERE id=$1", [reminder.id]);
      await q.query(
        'INSERT INTO lifeadmin.push_subscriptions (id,user_id,endpoint,data) VALUES ($1,$2,$3,$4)',
        [randomUUID(), DEMO_USER, subscription.endpoint, JSON.stringify(subscription)],
      );
    });
    reminder.channel = 'push';
    const provider = { email: vi.fn(), push: vi.fn().mockRejectedValue({ statusCode: 410 }) };
    await processReminder(repo, reminder, provider);
    expect(
      (
        await repo.db.transaction(
          (q) => q.query('SELECT * FROM lifeadmin.push_subscriptions'),
          DEMO_USER,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await repo.snapshot(DEMO_USER)).reminders.find((r) => r.id === reminder.id)?.status,
    ).toBe('blocked');
  });
});
