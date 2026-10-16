import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { config, LIMITS } from './config.js';
import { Repository } from './repository.js';
import { type Storage } from './storage.js';
import { AppError, assert } from './errors.js';
import { parseIsolated } from './parser.js';
import { seedDemo } from './demo.js';
import { dueInstant, validTimezone } from './scheduling.js';
import { validPushEndpoint } from './notifications.js';
import type { Due } from '../shared/types.js';
declare global {
  namespace Express {
    interface Request {
      userId: string;
      userEmail: string;
    }
  }
}
export const DEMO_USER = '11111111-1111-4111-8111-111111111111';
export const SECOND_USER = '22222222-2222-4222-8222-222222222222';
const idSchema = z.string().uuid();
const dueSchema = z
  .object({
    kind: z.enum(['none', 'date', 'datetime']),
    date: z.string().nullable(),
    time: z.string().nullable(),
    timezone: z.string().nullable(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.kind === 'none') {
      if (d.date || d.time || d.timezone)
        ctx.addIssue({
          code: 'custom',
          message: 'Unscheduled tasks cannot have date/time values.',
        });
      return;
    }
    if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !dueInstant(d as Due, 'UTC'))
      ctx.addIssue({
        code: 'custom',
        message:
          'Use a valid explicit date, time and timezone. DST gaps or repeated times are not accepted.',
      });
    if (d.kind === 'date' && (d.time || d.timezone))
      ctx.addIssue({ code: 'custom', message: 'Date-only deadlines use your profile timezone.' });
  });
export function createApp(repo: Repository, storage: Storage) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: config.production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'blob:', 'data:'],
              connectSrc: [
                "'self'",
                ...(config.supabaseUrl ? [new URL(config.supabaseUrl).origin] : []),
              ],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) =>
    res.json({
      development: !config.production,
      authConfigured: !!(config.supabaseUrl && config.supabaseAnon),
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnon,
      openaiConfigured: !!config.openaiKey,
      emailConfigured: !!(config.resendKey && config.emailFrom),
      pushConfigured: !!(config.vapidPublic && config.vapidPrivate),
      vapidPublicKey: config.vapidPublic,
    }),
  );
  const supabase =
    config.supabaseUrl && config.supabaseAnon
      ? createClient(config.supabaseUrl, config.supabaseAnon, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (url, options) =>
              fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }),
          },
        })
      : null;
  app.use('/api', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      if (req.headers.origin && req.headers.origin !== config.origin)
        throw new AppError(403, 'Origin is not allowed.');
      if (!config.production) {
        assert(
          ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') &&
            ['localhost', '127.0.0.1', '[::1]'].includes(req.hostname),
          403,
          'Development mode is loopback-only.',
        );
      }
      const bearer = req.headers.authorization?.replace(/^Bearer /, '');
      if (bearer && supabase) {
        const { data, error } = await supabase.auth.getUser(bearer);
        assert(!error && data.user?.email_confirmed_at, 401, 'Sign in with a verified account.');
        req.userId = data.user.id;
        req.userEmail = data.user.email || '';
      } else if (!config.production && req.headers['x-development-user'] === 'demo') {
        req.userId = DEMO_USER;
        req.userEmail = config.testEmail || 'demo@example.test';
      } else if (!config.production && req.headers['x-development-user'] === 'second') {
        req.userId = SECOND_USER;
        req.userEmail = 'second@example.test';
      } else throw new AppError(401, 'Please sign in.');
      await repo.ensureProfile(req.userId, req.userEmail);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/inbox', async (req, res) => res.json(await repo.snapshot(req.userId)));
  app.post('/api/demo', async (req, res) => {
    await seedDemo(repo, storage, req.userId);
    res.json({ ok: true });
  });
  app.patch('/api/profile', async (req, res) => {
    const patch = z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        timezone: z.string().refine(validTimezone).optional(),
        onboarded: z.boolean().optional(),
        emailEnabled: z.boolean().optional(),
        pushEnabled: z.boolean().optional(),
        leadDays: z.number().int().min(0).max(14).optional(),
        reminderHour: z.number().int().min(0).max(23).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(await repo.updateProfile(req.userId, patch));
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITS.bytes, files: 1, fields: 0, parts: 1 },
  });
  let parsing = 0;
  app.post(
    '/api/documents',
    async (req, res, next) => {
      try {
        assert(parsing < 2, 429, 'The document parser is busy. Try again shortly.');
        parsing++;
        let released = false;
        const release = () => {
          if (!released) {
            released = true;
            parsing--;
          }
        };
        res.once('finish', release);
        res.once('close', release);
        await repo.consumeUpload(req.userId);
        next();
      } catch (e) {
        next(e);
      }
    },
    upload.single('file'),
    async (req, res) => {
      assert(req.file, 400, 'Select a document to upload.');
      const parsed = await parseIsolated(req.file.buffer);
      const result = await repo.createDocument(
        req.userId,
        req.file.originalname,
        req.file.buffer,
        parsed.mime,
      );
      if (!result.duplicate) {
        try {
          await storage.put(req.userId, result.key, req.file.buffer, parsed.mime);
          await repo.activateDocument(req.userId, result.document.id);
        } catch {
          await repo.deleteDocument(req.userId, result.document.id);
          throw new AppError(503, 'Private storage is unavailable. The upload has been cancelled.');
        }
      }
      res.status(result.duplicate ? 200 : 202).json(result);
    },
  );
  app.post('/api/documents/:id/retry', async (req, res) => {
    await repo.retry(req.userId, idSchema.parse(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/documents/:id', async (req, res) => {
    await repo.deleteDocument(req.userId, idSchema.parse(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/documents/:id/download', async (req, res) => {
    const row = await repo.document(req.userId, idSchema.parse(req.params.id));
    const bytes = await storage.get(req.userId, row.object_key);
    res.setHeader('Content-Type', row.data.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(row.data.name)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  });
  app.patch('/api/tasks/:id', async (req, res) => {
    const patch = z
      .object({
        title: z.string().trim().min(1).max(160).optional(),
        category: z.enum(['payment', 'appointment', 'deadline']).optional(),
        state: z.enum(['open', 'completed', 'dismissed']).optional(),
        due: dueSchema.optional(),
        amount: z
          .string()
          .regex(/^\d{1,12}(\.\d{1,2})?$/)
          .nullable()
          .optional(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable()
          .optional(),
        organization: z.string().max(160).nullable().optional(),
        attention: z.array(z.string().max(250)).max(8).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(await repo.updateTask(req.userId, idSchema.parse(req.params.id), patch));
  });
  app.delete('/api/tasks/:id', async (req, res) => {
    await repo.updateTask(req.userId, idSchema.parse(req.params.id), { state: 'deleted' });
    res.json({ ok: true });
  });
  app.post('/api/push-subscriptions', async (req, res) => {
    const subscription = z
      .object({
        endpoint: z.string().max(4096).refine(validPushEndpoint, 'Unsupported push service.'),
        expirationTime: z.number().nullable().optional(),
        keys: z
          .object({
            p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
            auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}$/),
          })
          .strict(),
      })
      .strict()
      .parse(req.body);
    await repo.db.transaction(async (q) => {
      const count = (
        await q.query<{ count: string }>('SELECT count(*) FROM lifeadmin.push_subscriptions')
      ).rows[0].count;
      const existing = (
        await q.query('SELECT id FROM lifeadmin.push_subscriptions WHERE endpoint=$1', [
          subscription.endpoint,
        ])
      ).rows[0];
      assert(existing || Number(count) < 10, 429, 'Limit of 10 browser subscriptions reached.');
      await q.query(
        'INSERT INTO lifeadmin.push_subscriptions (id,user_id,endpoint,data) VALUES ($1,$2,$3,$4) ON CONFLICT (endpoint) DO UPDATE SET data=EXCLUDED.data',
        [randomUUID(), req.userId, subscription.endpoint, JSON.stringify(subscription)],
      );
    }, req.userId);
    res.json({ ok: true });
  });
  app.delete('/api/push-subscriptions', async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().max(4096) }).parse(req.body);
    await repo.db.transaction(
      (q) => q.query('DELETE FROM lifeadmin.push_subscriptions WHERE endpoint=$1', [endpoint]),
      req.userId,
    );
    res.json({ ok: true });
  });
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'API route not found.')));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues.map((i) => i.message).join(' ') });
        return;
      }
      if (error instanceof multer.MulterError) {
        res.status(400).json({ error: 'Upload exactly one supported file, no larger than 8 MB.' });
        return;
      }
      res.status(error instanceof AppError ? error.status : 500).json({
        error:
          error instanceof AppError ? error.message : 'Something went wrong. Please try again.',
      });
    },
  );
  return app;
}
