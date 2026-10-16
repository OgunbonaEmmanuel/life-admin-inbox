import 'dotenv/config';
import { config } from '../server/config.js';
import { extract } from '../server/extraction.js';
if (!config.openaiKey) {
  console.log(
    'SKIPPED: OPENAI_API_KEY is not configured. Real extraction quality and API access remain unverified.',
  );
  process.exit(0);
}
const text =
  'SYNTHETIC TEST. Evergreen Energy: Amount outstanding USD 184.50. Payment due 2026-11-15. Please pay the outstanding bill.';
const result = await extract(
  {
    mime: 'application/pdf',
    images: [],
    sources: [{ id: 'page:1', label: 'Page 1', kind: 'pdf', page: 1, text }],
  },
  AbortSignal.timeout(60_000),
);
if (
  result.tasks.length !== 1 ||
  result.tasks[0].category !== 'payment' ||
  result.tasks[0].due.date !== '2026-11-15'
)
  throw new Error(
    'Real smoke test did not produce the expected single payment task. Inspect privately before rollout.',
  );
console.log(
  'PASS: one real Responses API request produced a supported payment task with matching evidence. This is a narrow smoke test, not an extraction quality evaluation.',
);
