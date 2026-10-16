import 'dotenv/config';
import { config, validateConfig } from './config.js';
import { createDatabase } from './db.js';
import { Repository } from './repository.js';
import { createStorage } from './storage.js';
import { createApp } from './app.js';
import { startWorker } from './worker.js';
import express from 'express';
import path from 'node:path';
validateConfig();
const db = await createDatabase();
if (!config.production) await db.migrate();
const repo = new Repository(db),
  storage = createStorage(),
  app = createApp(repo, storage);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist/client'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/client/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(config.port, config.production ? '0.0.0.0' : '127.0.0.1', () =>
  console.log(
    `Life Admin Inbox: ${config.origin} (${config.production ? 'production' : 'LOCAL DEVELOPMENT — demo identity available'})`,
  ),
);
const stop =
  !config.production || process.env.RUN_WORKER === '1'
    ? startWorker(repo, storage)
    : async () => {};
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.close(
      () =>
        void stop()
          .then(() => db.close())
          .then(() => process.exit(0)),
    );
  });
