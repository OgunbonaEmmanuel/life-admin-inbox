import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { schema } from './schema.js';
export interface Query {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database {
  transaction<T>(fn: (q: Query) => Promise<T>, userId?: string): Promise<T>;
  close(): Promise<void>;
  migrate(): Promise<void>;
}
export async function createDatabase(location?: string): Promise<Database> {
  const pool =
    !location && config.databaseUrl
      ? new pg.Pool({
          connectionString: config.databaseUrl,
          max: 8,
          ssl: {
            rejectUnauthorized: true,
            ...(config.databaseCaPath ? { ca: readFileSync(config.databaseCaPath, 'utf8') } : {}),
          },
          statement_timeout: 30_000,
          connectionTimeoutMillis: 15_000,
        })
      : null;
  if (!pool && !location) await mkdir(config.dataDir, { recursive: true });
  const local = pool ? null : new PGlite(location || `${config.dataDir}/postgres`);
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async transaction<T>(fn: (q: Query) => Promise<T>, userId?: string): Promise<T> {
      const run = async () => {
        const connection = pool ? await pool.connect() : null;
        const q: Query = connection
          ? { query: async (sql, params) => ({ rows: (await connection.query(sql, params)).rows }) }
          : { query: (sql, params) => local!.query(sql, params) };
        try {
          await q.query('BEGIN');
          if (userId) {
            await q.query('SET LOCAL ROLE lifeadmin_user');
            await q.query("SELECT set_config('app.user_id',$1,true)", [userId]);
          }
          const result = await fn(q);
          await q.query('COMMIT');
          return result;
        } catch (e) {
          await q.query('ROLLBACK');
          throw e;
        } finally {
          connection?.release();
        }
      };
      if (pool) return run();
      const next = tail.then(run, run);
      tail = next.catch(() => {});
      return next;
    },
    async migrate() {
      if (pool) await pool.query(schema);
      else await local!.exec(schema);
    },
    async close() {
      await tail;
      if (pool) await pool.end();
      else await local!.close();
    },
  };
}
