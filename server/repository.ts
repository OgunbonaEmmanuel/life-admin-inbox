import { randomUUID, createHash } from 'node:crypto';
import type { Database, Query } from './db.js';
import type { Document, Profile, Task, Snapshot } from '../shared/types.js';
import { assert } from './errors.js';
import { LIMITS } from './config.js';
import { schedule } from './scheduling.js';
import { fingerprint } from './extraction.js';
export interface DocRow {
  id: string;
  user_id: string;
  object_key: string;
  data: Document;
  deleted: boolean;
}
export interface Job {
  id: string;
  user_id: string;
  document_id: string;
  kind: 'extract' | 'cleanup';
  attempts: number;
  lease_token: string;
}
export const defaultProfile = (email: string): Profile => ({
  name: 'Your space',
  email,
  timezone: 'UTC',
  onboarded: false,
  emailEnabled: true,
  pushEnabled: false,
  leadDays: 1,
  reminderHour: 9,
});
export async function lockProfile(q: Query, userId: string) {
  return (
    await q.query<{ data: Profile }>(
      'SELECT data FROM lifeadmin.profiles WHERE user_id=$1 FOR UPDATE',
      [userId],
    )
  ).rows[0]?.data;
}
export async function reschedule(
  q: Query,
  userId: string,
  task: Task,
  profile: Profile,
  now = new Date(),
) {
  await q.query(
    "UPDATE lifeadmin.reminders SET status='cancelled',lease_token=NULL WHERE task_id=$1 AND status IN ('scheduled','processing','blocked','failed')",
    [task.id],
  );
  for (const at of schedule(task, profile, now))
    for (const channel of ['email', 'push'] as const) {
      if (!(channel === 'email' ? profile.emailEnabled : profile.pushEnabled)) continue;
      await q.query(
        'INSERT INTO lifeadmin.reminders (id,user_id,task_id,revision,channel,scheduled_at,available_at) VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT DO NOTHING',
        [randomUUID(), userId, task.id, task.revision, channel, at],
      );
    }
}
export class Repository {
  constructor(public db: Database) {}
  async ensureProfile(userId: string, email: string) {
    return this.db.transaction(async (q) => {
      await q.query(
        'INSERT INTO lifeadmin.profiles (user_id,data) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, JSON.stringify(defaultProfile(email))],
      );
      await q.query(
        "UPDATE lifeadmin.profiles SET data=jsonb_set(data,'{email}',to_jsonb($2::text)) WHERE user_id=$1",
        [userId, email],
      );
    }, userId);
  }
  async snapshot(userId: string): Promise<Snapshot> {
    return this.db.transaction(async (q) => {
      const profile = (
        await q.query<{ data: Profile }>('SELECT data FROM lifeadmin.profiles WHERE user_id=$1', [
          userId,
        ])
      ).rows[0].data;
      const documents = (
        await q.query<{ data: Document }>(
          'SELECT data FROM lifeadmin.documents WHERE NOT deleted ORDER BY created_at DESC LIMIT 500',
        )
      ).rows.map((r) => r.data);
      const tasks = (
        await q.query<{ data: Task }>(
          "SELECT data FROM lifeadmin.tasks WHERE data->>'state'<>'deleted' ORDER BY data->>'createdAt' DESC",
        )
      ).rows.map((r) => r.data);
      const reminders = (
        await q.query<Snapshot['reminders'][number]>(
          'SELECT id,task_id,channel,status,scheduled_at,error FROM lifeadmin.reminders ORDER BY scheduled_at DESC LIMIT 200',
        )
      ).rows;
      return { profile, documents, tasks, reminders };
    }, userId);
  }
  async consumeUpload(userId: string) {
    await this.db.transaction(async (q) => {
      await q.query('INSERT INTO lifeadmin.usage (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [
        userId,
      ]);
      const row = (
        await q.query(
          'UPDATE lifeadmin.usage SET uploads=uploads+1 WHERE user_id=$1 AND day=CURRENT_DATE AND uploads<$2 RETURNING user_id',
          [userId, LIMITS.uploadsPerDay],
        )
      ).rows[0];
      assert(row, 429, 'Daily upload limit reached (20 attempts). Try again tomorrow.');
    }, userId);
  }
  async createDocument(userId: string, name: string, bytes: Buffer, mime: string) {
    return this.db.transaction(async (q) => {
      await lockProfile(q, userId);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const existing = (
        await q.query<DocRow>('SELECT * FROM lifeadmin.documents WHERE hash=$1', [hash])
      ).rows[0];
      if (existing) {
        assert(!existing.deleted, 409, 'This original is being deleted. Try again after cleanup.');
        return { document: existing.data, duplicate: true, key: existing.object_key };
      }
      const count = (await q.query<{ count: string }>('SELECT count(*) FROM lifeadmin.documents'))
        .rows[0];
      assert(
        Number(count.count) < 500,
        429,
        'This inbox has reached its 500-document storage limit. Delete documents before adding more.',
      );
      const id = randomUUID(),
        key = `${userId}/${id}`;
      const document: Document = {
        id,
        name: name.slice(0, 160).replace(/[\u0000-\u001f]/g, ''),
        mime,
        size: bytes.length,
        state: 'queued',
        sources: [],
        warning: null,
        taskCount: 0,
        synthetic: false,
        createdAt: new Date().toISOString(),
        attempts: 0,
      };
      await q.query(
        'INSERT INTO lifeadmin.documents (id,user_id,hash,object_key,data) VALUES ($1,$2,$3,$4,$5)',
        [id, userId, hash, key, JSON.stringify(document)],
      );
      await q.query(
        "INSERT INTO lifeadmin.jobs (id,user_id,document_id,kind,state) VALUES ($1,$2,$3,'extract','staging')",
        [randomUUID(), userId, id],
      );
      return { document, duplicate: false, key };
    }, userId);
  }
  async activateDocument(userId: string, id: string) {
    await this.db.transaction(
      (q) =>
        q.query(
          "UPDATE lifeadmin.jobs SET state='queued' WHERE document_id=$1 AND state='staging'",
          [id],
        ),
      userId,
    );
  }
  async document(userId: string, id: string) {
    return this.db.transaction(async (q) => {
      const row = (
        await q.query<DocRow>('SELECT * FROM lifeadmin.documents WHERE id=$1 AND NOT deleted', [id])
      ).rows[0];
      assert(row, 404, 'Document not found.');
      return row;
    }, userId);
  }
  async retry(userId: string, id: string) {
    await this.db.transaction(async (q) => {
      await lockProfile(q, userId);
      const row = (
        await q.query<DocRow>(
          'SELECT * FROM lifeadmin.documents WHERE id=$1 AND NOT deleted FOR UPDATE',
          [id],
        )
      ).rows[0];
      assert(row, 404, 'Document not found.');
      assert(
        !row.data.synthetic,
        400,
        'Synthetic examples do not use model extraction. Upload a demo file to test real extraction.',
      );
      assert(
        ['failed', 'partial', 'completed'].includes(row.data.state),
        409,
        'Document is already queued or processing.',
      );
      assert(
        row.data.attempts < LIMITS.retriesPerDocument,
        429,
        'This document has reached its three-attempt limit.',
      );
      row.data.state = 'queued';
      row.data.warning = null;
      await q.query('UPDATE lifeadmin.documents SET data=$2 WHERE id=$1', [
        id,
        JSON.stringify(row.data),
      ]);
      await q.query(
        "UPDATE lifeadmin.jobs SET state='queued',available_at=now(),lease_until=NULL,lease_token=NULL,error=NULL WHERE document_id=$1 AND kind='extract'",
        [id],
      );
    }, userId);
  }
  async updateTask(userId: string, id: string, patch: Partial<Task>) {
    return this.db.transaction(async (q) => {
      const profile = await lockProfile(q, userId);
      const row = (
        await q.query<{ data: Task }>('SELECT data FROM lifeadmin.tasks WHERE id=$1 FOR UPDATE', [
          id,
        ])
      ).rows[0];
      assert(row && row.data.state !== 'deleted', 404, 'Task not found.');
      const task = {
        ...row.data,
        ...patch,
        id: row.data.id,
        documentId: row.data.documentId,
        edited: true,
        revision: row.data.revision + 1,
      };
      await q.query('UPDATE lifeadmin.tasks SET data=$2 WHERE id=$1', [id, JSON.stringify(task)]);
      await reschedule(q, userId, task, profile);
      return task;
    }, userId);
  }
  async updateProfile(userId: string, patch: Partial<Profile>) {
    return this.db.transaction(async (q) => {
      const old = await lockProfile(q, userId),
        profile = { ...old, ...patch, email: old.email };
      await q.query('UPDATE lifeadmin.profiles SET data=$2 WHERE user_id=$1', [
        userId,
        JSON.stringify(profile),
      ]);
      const changed = [
        'timezone',
        'onboarded',
        'leadDays',
        'reminderHour',
        'emailEnabled',
        'pushEnabled',
      ].some((key) => old[key as keyof Profile] !== profile[key as keyof Profile]);
      if (changed)
        for (const { data: task } of (
          await q.query<{ data: Task }>(
            "SELECT data FROM lifeadmin.tasks WHERE data->>'state'='open' FOR UPDATE",
          )
        ).rows) {
          task.revision++;
          await q.query('UPDATE lifeadmin.tasks SET data=$2 WHERE id=$1', [
            task.id,
            JSON.stringify(task),
          ]);
          await reschedule(q, userId, task, profile);
        }
      return profile;
    }, userId);
  }
  async deleteDocument(userId: string, id: string) {
    await this.db.transaction(async (q) => {
      await lockProfile(q, userId);
      const row = (
        await q.query<DocRow>(
          'SELECT * FROM lifeadmin.documents WHERE id=$1 AND NOT deleted FOR UPDATE',
          [id],
        )
      ).rows[0];
      assert(row, 404, 'Document not found.');
      await q.query('DELETE FROM lifeadmin.tasks WHERE document_id=$1', [id]);
      await q.query('DELETE FROM lifeadmin.jobs WHERE document_id=$1', [id]);
      row.data.sources = [];
      row.data.state = 'deleting';
      row.data.name = 'Deleted document';
      await q.query('UPDATE lifeadmin.documents SET deleted=true,data=$2 WHERE id=$1', [
        id,
        JSON.stringify(row.data),
      ]);
      await q.query(
        "INSERT INTO lifeadmin.jobs (id,user_id,document_id,kind) VALUES ($1,$2,$3,'cleanup')",
        [randomUUID(), userId, id],
      );
    }, userId);
  }
  async persistExtraction(
    job: Job,
    result: {
      tasks: Omit<Task, 'id' | 'documentId' | 'edited' | 'revision' | 'synthetic' | 'createdAt'>[];
      sources: Document['sources'];
      rejected: number;
      notes: string[];
    },
  ) {
    return this.db.transaction(async (q) => {
      const profile = await lockProfile(q, job.user_id);
      const active = (
        await q.query(
          "SELECT id FROM lifeadmin.jobs WHERE id=$1 AND lease_token=$2 AND state='processing' FOR UPDATE",
          [job.id, job.lease_token],
        )
      ).rows[0];
      if (!active) return;
      const row = (
        await q.query<DocRow>(
          'SELECT * FROM lifeadmin.documents WHERE id=$1 AND NOT deleted FOR UPDATE',
          [job.document_id],
        )
      ).rows[0];
      if (!row) return;
      // Once a run produced tasks, retries only reuse that task set. This deliberately
      // avoids near-duplicate model variants, resurrecting deleted tasks, and edit loss.
      const existing = (
        await q.query('SELECT id FROM lifeadmin.tasks WHERE document_id=$1', [job.document_id])
      ).rows;
      if (!existing.length)
        for (const candidate of result.tasks) {
          const task: Task = {
            ...candidate,
            id: randomUUID(),
            documentId: job.document_id,
            edited: false,
            revision: 1,
            synthetic: false,
            createdAt: new Date().toISOString(),
          };
          const inserted = (
            await q.query(
              'INSERT INTO lifeadmin.tasks (id,user_id,document_id,fingerprint,data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',
              [task.id, job.user_id, job.document_id, fingerprint(task), JSON.stringify(task)],
            )
          ).rows[0];
          if (inserted) await reschedule(q, job.user_id, task, profile);
        }
      const count = (
        await q.query<{ count: string }>(
          "SELECT count(*) FROM lifeadmin.tasks WHERE document_id=$1 AND data->>'state'<>'deleted'",
          [job.document_id],
        )
      ).rows[0];
      if (!existing.length) row.data.sources = result.sources;
      row.data.taskCount = Number(count.count);
      row.data.warning =
        [
          result.rejected ? `${result.rejected} unsupported citations were excluded.` : '',
          ...result.notes,
          existing.length
            ? 'Existing tasks were preserved on retry; no tasks were overwritten or added.'
            : '',
        ]
          .filter(Boolean)
          .join(' ') || null;
      row.data.state = result.rejected || result.notes.length ? 'partial' : 'completed';
      await q.query('UPDATE lifeadmin.documents SET data=$2 WHERE id=$1', [
        row.id,
        JSON.stringify(row.data),
      ]);
      await q.query(
        "UPDATE lifeadmin.jobs SET state='completed',lease_until=NULL,lease_token=NULL,error=NULL WHERE id=$1",
        [job.id],
      );
    }, job.user_id);
  }
}
