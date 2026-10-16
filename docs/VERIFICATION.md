# Verification handoff

Local checks were repeated **16 October 2026**, on Windows with Node **24.21.0**: TypeScript, 38 automated tests, 3 browser tests, the production build, and the production dependency audit passed. The earlier live OpenAI smoke test and synthetic fixture generation were completed on 12 October. Production configuration and deployment remain owner actions. The owner authorized GitHub publication on 16 October; no services were purchased or deployed.

## Actual results

| Check                                                   | Result                             | What it establishes                                                                                                         |
| ------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                     | Passed                             | Strict TypeScript for frontend, shared code, server, tests and scripts                                                      |
| `npm test`                                              | **38 tests passed, 4 files**       | Actual local PostgreSQL transactions/RLS, parser behavior, API ownership, scheduling and validated synthetic model outputs  |
| `npm run build`                                         | Passed                             | Compiled Node server and optimized Vite browser assets, including locally bundled fonts                                     |
| `npm run test:browser` with `PLAYWRIGHT_CHANNEL=chrome` | **3 tests passed**                 | Browser workflows and explicit permission-denial behavior using installed Chrome; all external service credentials disabled |
| axe WCAG 2 A/AA and 2.1 AA checks                       | No violations in scanned states    | Today, upload dialog, preferences and document inbox; automated results are not a comprehensive accessibility certification |
| Desktop/mobile layout                                   | Passed                             | 1280 px desktop and 390 px mobile workflow, no horizontal overflow, mobile navigation and keyboard dialog dismissal         |
| `npm audit --omit=dev`                                  | 0 reported vulnerabilities         | Advisory state of production dependencies at verification time; not a full security audit                                   |
| `npm run demo:files`                                    | Passed                             | Seven labelled synthetic PDF/DOCX/PNG/JPEG/scanned-PDF documents generated locally                                          |
| `npm run smoke:openai`                                  | **Passed with `gpt-4o-mini`**      | One real Responses API request produced a payment task with matching evidence; not a general extraction quality evaluation |

The system's installed Chrome was used instead of waiting for a separate Chromium download. Screenshots are preserved in [desktop](screenshots/today-desktop.png) and [mobile](screenshots/today-mobile.png). Browser tests use isolated persisted data under ignored `.local/browser-tests` and stop their own test server. Production users never receive the development identity adapter.

## Behavior covered

- An unpaid bill's **synthetic model output** becomes a task with verified source/date/money evidence. Paid/completed/historical/example outputs and obvious paid-receipt evidence do not become new payment tasks. Multiple independent candidates and no-action output are covered. These tests validate application rules, not whether a real model classifies every document correctly.
- Missing/ambiguous dates are unscheduled; relative dates need source-backed reference dates; an issue date is rejected as a payment deadline. Invented excerpts, sources, amounts and currencies are rejected or flagged. An amount substring cannot pass as the full amount, while sentence punctuation is accepted.
- Date-only and appointment scheduling, spring/autumn DST changes, nonexistent/repeated wall times, already-passed slots, coincident reminders, onboarding and attention flags. Timed appointments display on the viewer's actual local day.
- Concurrent identical uploads return one document; concurrent queue claims return one job. Repeated job completion creates one task/reminder set. User edits and deletion tombstones survive retries, and original evidence is preserved.
- Edits, timezone changes, completion/reopening and document deletion cancel/reschedule future reminders. Cleanup failure persists and retries. Database close/reopen with an expired lease recovers a job; stale-worker tokens cannot commit.
- Two users are isolated at the API and SQL RLS layers, including unscoped queries. Cross-user task edits/deletion, document deletion/retry/download, forged ownership inserts, and push subscription changes are rejected. HTTP requests without a supported identity are rejected.
- Upload quota is atomically enforced. Forged file content, invalid PDFs, excessive PDF pages/image dimensions, missing DOCX structure, excessive decompression and macros/entities are rejected. Ordinary PDF/DOCX text references, screenshots and scanned PDF rendering are exercised using real local parsers.
- A malicious instruction string cannot validate a fabricated task excerpt. This is a narrow application-boundary test; it does not prove real-model resistance to every prompt injection.
- Delivery does not become accepted merely because it was queued. Explicit injected test providers exercise provider acknowledgement, missing-configuration blocking, cancellation, stale expiration, ordinary partial-push retry deduplication and removal of expired 410 subscriptions. These test providers send no actual email/push.
- Browser checks cover editing, completion/reopening, evidence inspection, privacy disclosure before upload, actual upload parsing, a visible missing-OpenAI failure, document deletion, preferences, responsive navigation, keyboard dismissal and denied push permission without subscription creation.

The owner-provided OpenAI key is configured only in the ignored backend `.env`. The initial request with `gpt-4.1-mini` returned HTTP 403 / `model_not_found`. The project's model list included `gpt-4o-mini`, and the bounded text extraction smoke test passed with that model. The backend default, `.env.example`, and hosting blueprint now also use `gpt-4o-mini`. Vision and representative-document quality have not been evaluated with the live model.

## Remaining real integration checks

| Integration                 | Missing prerequisite / remaining test                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI Responses and vision | Backend key and text extraction smoke test verified with `gpt-4o-mini`. Still evaluate vision, the synthetic file set, and representative owner documents. |
| Supabase auth               | Create the project, configure email verification/SMTP, and test signup, confirmation, reset, refresh, sign-out and two real users.                                                                                           |
| Google OAuth                | Configure the Google client and exact redirect allowlists; test the actual redirect/consent flow.                                                                                                                            |
| Hosted PostgreSQL           | Run migrations/role grants against the real database, verify TLS, and repeat concurrent-worker/RLS tests. PGlite is genuine PostgreSQL but serializes local transactions; it does not prove multi-host concurrency behavior. |
| Supabase private Storage    | Create the dedicated private bucket and test upload/download/deletion plus unauthorized direct access with real credentials.                                                                                                 |
| Resend                      | Verify the sender/DNS, configure an owned test destination, and verify real acceptance and eventual inbox delivery. No email was sent.                                                                                       |
| Browser push                | Configure VAPID, an explicit test subscription and HTTPS, then verify actual vendor acceptance and device display. No real push was sent.                                                                                    |
| Render hosting              | Create web/worker services, configure secrets, run migrations and check restart/health/monitoring on the hosted runtime. No deployment occurred.                                                                             |

## Operational limitations to retain in the handoff

1. Matching an excerpt, including AI-transcribed OCR text, does not prove a correct obligation interpretation. Extraction can omit or misread content. Non-English/unusual dates are conservatively flagged. DOCX extraction covers body paragraphs and table rows, not every Word feature.
2. A retry of a document that already has tasks preserves that task set and its sources. It does not append newly worded/missed obligations automatically. This conservative rule prevents duplicate tasks and preserves edits/tombstones; additive reconciliation is not implemented.
3. Email API acceptance does not establish inbox delivery. Bounce/delivery webhooks are not implemented. Web Push remains at-least-once around a provider-acceptance/database-commit crash boundary; stable tags reduce visible duplicates but cannot guarantee exactly-once display.
4. Reminders over an hour late expire. Past slots are skipped on creation/edit; no catch-up burst is sent. No notifications can display on a powered-off device.
5. Private-object deletion retries in the background. The operator must monitor failed cleanup jobs and provider backups. User deletion cannot recall already downloaded originals or accepted external messages.
6. Parser isolation includes a time/JS-heap bound and bounded raster dimensions, not an OS-level native-memory security sandbox. Public-scale hostile document ingestion warrants stronger container/resource isolation and operational review.
7. The initial app is capped at 500 retained documents/user. Reminder activity displays the most recent 200 records (30 shown in Preferences); it is not a full delivery analytics console. Production availability and provider quotas depend on the owner's service configuration.

See [SETUP.md](SETUP.md) for exact account/environment/deployment steps and [ARCHITECTURE.md](ARCHITECTURE.md) for privacy, limits, retention and scheduling details.
