import 'dotenv/config';
import { validateConfig, config } from './config.js';
import { createDatabase } from './db.js';
import { Repository } from './repository.js';
import { createStorage } from './storage.js';
import { startWorker } from './worker.js';
validateConfig();
if (!config.databaseUrl)
  throw new Error(
    'A separate worker requires DATABASE_URL. Local embedded Postgres runs inside npm run dev.',
  );
const db = await createDatabase();
const stop = startWorker(new Repository(db), createStorage());
console.log('Life Admin Inbox worker running.');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(
    signal,
    () =>
      void stop()
        .then(() => db.close())
        .then(() => process.exit(0)),
  );
