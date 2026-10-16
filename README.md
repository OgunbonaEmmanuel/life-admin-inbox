# Life Admin Inbox

A private document inbox that turns paperwork into an actionable plan.

[Desktop preview](docs/screenshots/today-desktop.png) · [Mobile preview](docs/screenshots/today-mobile.png)

## Start locally

Use **Node 24 LTS** (the version selected by `.nvmrc` and the hosting blueprint). The minimum is Node **22.13.0**; Node 20 lacks the native WebSocket support required by the configured Supabase clients. Dependencies are locked in `package-lock.json`.

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open **http://localhost:3000**. On subsequent runs, just use `npm run dev`. Do not overwrite an existing `.env`. The app binds to loopback in development. It creates persisted embedded PostgreSQL at `.local/postgres` and private files at `.local/originals`. No Docker or service accounts are necessary for the local development adapter. Do not run two processes against the same embedded database.

1. Confirm your browser-suggested timezone.
2. Choose **Try synthetic examples** to explore all three task categories and an ambiguous date.
3. Use **Preferences** to see integration configuration, reminder rules and activity.
4. Add your backend `OPENAI_API_KEY` to `.env` and restart to enable **real** extraction of uploaded documents. `OPENAI_MODEL` defaults to `gpt-4o-mini`, which passed the project's live text extraction smoke test. No secret belongs in a `VITE_` variable.

Local demo identity is **not authentication**. Examples have prewritten tasks and never send external messages. A real upload without an OpenAI key is stored privately, then explicitly fails extraction; add the key and retry from the document panel. Email and push without configuration remain blocked, not delivered.

## What is implemented

- Today, week timeline, task filters, completed/dismissed tasks, document inbox, source panels, editing, deletion, accessible keyboard dialogs, and mobile navigation.
- Verified email/password, password reset, and Google sign-in via Supabase when configured.
- Content-based validation for PDF, DOCX, PNG and JPEG; isolated parsing; text extraction plus OpenAI vision transcription for screenshots/scanned or image-containing PDF pages.
- Responses API structured extraction, evidence/date/money validation, automatic supported-task creation, attention flags and unscheduled ambiguous/missing dates.
- PostgreSQL row-level security; server ownership checks; private originals; authenticated download and image preview; generated storage keys.
- Durable leased extraction/cleanup jobs; atomic claims; duplicate-file hashes; task tombstones and edit-preserving retries.
- Durable timezone-aware reminders, preference changes, cancellation, email through Resend, Web Push, explicit permission requests, safe previews, and expired subscription removal.

## Commands

| Command                           | Purpose                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`                     | Local server, Vite frontend, embedded database and worker at port 3000                    |
| `npm run typecheck`               | Strict frontend/server TypeScript checks                                                  |
| `npm test`                        | Real local PostgreSQL, parser, API and domain behavior tests; no paid services            |
| `npm run build`                   | Compile server and build browser assets into `dist/`                                      |
| `npm run demo:files`              | Re-create seven clearly labelled synthetic PDF/DOCX/PNG/JPEG fixtures                     |
| `npm run db:migrate`              | Apply idempotent database schema to the configured database                               |
| `npm run smoke:openai`            | One bounded real structured-extraction request, or explicit skip without a key            |
| `npx playwright install chromium` | Install browser used by browser tests                                                     |
| `npm run test:browser`            | Desktop/mobile workflows, denied push permission, keyboard and axe checks                 |
| `npm start`                       | Run built server; set `NODE_ENV=production` and full production configuration for hosting |
| `npm run worker`                  | Separate durable worker; requires network PostgreSQL                                      |

On Windows with an existing Chrome installation, use `$env:PLAYWRIGHT_CHANNEL='chrome'; npm run test:browser` to avoid a browser download. Browser tests use port **3100**, isolated `.local/browser-tests` data, and explicitly disable provider credentials. Stop other processes on that port first. Tests create synthetic data only. Screenshots and traces go to ignored `test-results/`.

## Owner setup and handoff

The owner currently has only an OpenAI account. Add **Supabase**, **Render**, **Resend**, a verified sender domain, and a **Google Cloud OAuth project** for Google login. Browser push uses generated VAPID keys and does not require a fourth hosted queue/notification vendor.

- [Exact account, environment, OAuth, email, push and deployment setup](docs/SETUP.md)
- [Architecture, scheduling, security, file limits, privacy and retention](docs/ARCHITECTURE.md)
- [Actual verification results and remaining external checks](docs/VERIFICATION.md)
- [Official integration sources and model rationale](docs/INTEGRATIONS.md)
- [Agreed scope](PROJECT_BRIEF.md) and [implementation rules](AGENTS.md)

Managed deployment is prepared through `render.yaml` and `supabase/storage.sql` but has **not** been run. A real text extraction smoke test passed with `gpt-4o-mini` using a privately configured backend key; credentials are not included in this repository. Vision and broader extraction quality, real account flows, hosted storage, and live email/push remain unverified. A matching excerpt is evidence of text presence, not proof that the model understood the obligation correctly.
