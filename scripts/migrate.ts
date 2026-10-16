import 'dotenv/config';
import { createDatabase } from '../server/db.js';
const db = await createDatabase();
await db.migrate();
await db.close();
console.log('Life Admin Inbox schema applied.');
