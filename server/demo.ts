import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import sharp from 'sharp';
import type { Repository } from './repository.js';
import { lockProfile, reschedule } from './repository.js';
import type { Storage } from './storage.js';
import type { Task, Document, Category, Due } from '../shared/types.js';
export async function seedDemo(repo: Repository, storage: Storage, userId: string) {
  const today = Temporal.Now.plainDateISO('Africa/Lagos');
  const iso = (days: number) => today.add({ days }).toString();
  const specs: {
    name: string;
    title: string;
    category: Category;
    organization: string;
    amount: string | null;
    currency: string | null;
    due: Due;
    excerpt: string;
    attention: string[];
    state: Task['state'];
  }[] = [
    {
      name: 'SYNTHETIC • Electricity bill.png',
      title: 'Pay the electricity bill',
      category: 'payment',
      organization: 'Evergreen Energy',
      amount: '184.50',
      currency: 'USD',
      due: { kind: 'date', date: iso(0), time: null, timezone: null },
      excerpt: `Amount outstanding: USD 184.50. Payment due ${iso(0)}.`,
      attention: [],
      state: 'open',
    },
    {
      name: 'SYNTHETIC • Dental appointment.png',
      title: 'Your dental check-up',
      category: 'appointment',
      organization: 'Maple Dental Studio',
      amount: null,
      currency: null,
      due: { kind: 'datetime', date: iso(1), time: '14:30', timezone: 'Africa/Lagos' },
      excerpt: `Your dental check-up is booked for ${iso(1)} at 14:30 Africa/Lagos.`,
      attention: [],
      state: 'open',
    },
    {
      name: 'SYNTHETIC • School field trip.png',
      title: 'Return the field trip form',
      category: 'deadline',
      organization: 'Willow Primary School',
      amount: null,
      currency: null,
      due: { kind: 'date', date: iso(3), time: null, timezone: null },
      excerpt: `Please return the signed field trip permission form by ${iso(3)}.`,
      attention: [],
      state: 'open',
    },
    {
      name: 'SYNTHETIC • Course registration.png',
      title: 'Finish your course registration',
      category: 'deadline',
      organization: 'Northside Learning',
      amount: null,
      currency: null,
      due: { kind: 'none', date: null, time: null, timezone: null },
      excerpt: 'Please complete your registration by 03/04/2026.',
      attention: ['The date 03/04/2026 could mean March 4 or April 3. Confirm the deadline.'],
      state: 'open',
    },
    {
      name: 'SYNTHETIC • Internet bill.png',
      title: 'Pay the internet bill',
      category: 'payment',
      organization: 'Neighbourhood Fibre',
      amount: '65.00',
      currency: 'USD',
      due: { kind: 'date', date: iso(-2), time: null, timezone: null },
      excerpt: `Internet service balance USD 65.00. Payment due ${iso(-2)}.`,
      attention: [],
      state: 'completed',
    },
  ];
  for (const spec of specs) {
    const id = randomUUID(),
      key = `${userId}/${id}`,
      taskId = randomUUID();
    const lines = [
      'SYNTHETIC DEMO DOCUMENT',
      spec.organization,
      spec.title,
      spec.excerpt,
      'Fictional content. No real account or obligation.',
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#f7f5ef"/>${lines.map((line, i) => `<text x="60" y="${90 + i * 100}" font-family="sans-serif" font-size="${i === 0 ? 22 : 28}" fill="#183d36">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('')}</svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    let inserted = false;
    await repo.db
      .transaction(async (q) => {
        const profile = await lockProfile(q, userId);
        const hash = `demo:${spec.title}`;
        if ((await q.query('SELECT id FROM lifeadmin.documents WHERE hash=$1', [hash])).rows.length)
          return;
        // Write object while holding the per-user lock; generated keys stay private.
        await storage.put(userId, key, bytes, 'image/png');
        const document: Document = {
          id,
          name: spec.name,
          mime: 'image/png',
          size: bytes.length,
          state: 'completed',
          sources: [
            {
              id: 'image:1',
              label: 'Synthetic screenshot · image 1',
              kind: 'image',
              text: lines.join('\n'),
            },
          ],
          warning: 'Synthetic example with prewritten tasks. No OpenAI extraction was performed.',
          taskCount: 1,
          synthetic: true,
          createdAt: new Date().toISOString(),
          attempts: 0,
        };
        const task: Task = {
          id: taskId,
          documentId: id,
          title: spec.title,
          category: spec.category,
          organization: spec.organization,
          amount: spec.amount,
          currency: spec.currency,
          due: spec.due,
          excerpt: spec.excerpt,
          sourceId: 'image:1',
          attention: spec.attention,
          state: spec.state,
          edited: false,
          revision: 1,
          synthetic: true,
          createdAt: document.createdAt,
        };
        await q.query(
          'INSERT INTO lifeadmin.documents (id,user_id,hash,object_key,data) VALUES ($1,$2,$3,$4,$5)',
          [id, userId, hash, key, JSON.stringify(document)],
        );
        await q.query(
          'INSERT INTO lifeadmin.tasks (id,user_id,document_id,fingerprint,data) VALUES ($1,$2,$3,$4,$5)',
          [task.id, userId, id, 'demo', JSON.stringify(task)],
        );
        await reschedule(q, userId, task, profile);
        inserted = true;
      }, userId)
      .catch(async (e) => {
        await storage.remove(userId, key);
        throw e;
      });
    void inserted;
  }
}
