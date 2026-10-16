# Owner setup

These are instructions for the owner to perform later. No accounts or deployments have been created.

## Accounts and architecture

| Account                    | Role                                                         | Why                                                       |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| OpenAI (already owned)     | Structured task extraction and image transcription           | One backend API for text and vision                       |
| Supabase                   | Email/password/Google auth, Postgres, private object storage | Three concerns in one maintained service                  |
| Render                     | Node web service and continuously running worker             | The same runtime can parse documents and run durable jobs |
| Resend                     | Reminder email and Supabase custom SMTP                      | One email provider for both transactional uses            |
| Google Cloud OAuth project | Google sign-in credentials                                   | Supabase brokers the flow; no custom password system      |
| Your domain/DNS provider   | Sender domain verification, optional app domain              | Production sender authentication                          |

Review each provider's current plans and regional availability yourself. No prices, free-tier guarantees, or purchases are assumed. Keep Supabase and Render geographically close. Production needs an always-running worker; a browser tab is never the scheduler.

## Supabase database, authentication and private storage

1. Create a dedicated Supabase project for **Life Admin Inbox**, separate from Recall. Retain its database password privately.
2. Set `SUPABASE_URL`, public `SUPABASE_ANON_KEY`, and **server-only** `SUPABASE_SERVICE_ROLE_KEY`. The URL and anon key are intentionally public; they do not grant access to this app's private schema or storage.
3. Copy the project's PostgreSQL connection URI to `DATABASE_URL`. Prefer the session pooler for a persistent Node server if direct connectivity is unavailable. Use its exact provided host, database, username and port; percent-encode password characters in the URI. The application uses verified TLS and no named prepared statements. Do not disable certificate verification. If your connection requires the Supabase root certificate, download that project's trusted CA PEM from its database connection settings and set `DATABASE_CA_PATH` to the absolute path (Render can mount it as a secret file). Do not add `sslmode`/`sslrootcert` URL parameters that override the application's TLS options.
4. Run `npm run db:migrate` with the project database administrator connection. It creates only the `lifeadmin` schema and a `lifeadmin_user` NOLOGIN role. Keep these database credentials backend-only. The API drops into the restricted role for every user transaction. Worker queue claims use the privileged backend connection. The runtime therefore remains a trusted service; SQL injection and secret leakage are not made harmless by RLS.
5. In Supabase SQL Editor run **`supabase/storage.sql`**. This creates the private `life-admin-originals` bucket, denies direct public/browser access to the app schema, and grants the database administrator membership in the restricted role. Do not expose the `lifeadmin` schema through the Data API. Remove any pre-existing broad storage policies for this dedicated bucket. No public bucket or public original URLs are used.
6. Enable the Email provider. Keep **Confirm email** enabled. Set a minimum password length of at least 10 characters, rate limits, and suitable password protections in Supabase.
7. In Auth URL Configuration, set Site URL to the final `APP_ORIGIN`. Allow exactly these redirects, adjusting origin:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/auth/reset`
   - `https://YOUR-APP-DOMAIN/auth/callback`
   - `https://YOUR-APP-DOMAIN/auth/reset`
8. Configure custom SMTP (below). Verify signup confirmation and reset links in an ordinary browser. PKCE flows should start and finish in the same browser. The frontend uses Supabase's session refresh and URL handling; the API validates each access token using `auth.getUser` and requires confirmed email.

## Google OAuth

1. In Google Cloud, create an OAuth consent screen for this dedicated app. While in Testing, explicitly list test users. Complete Google's publishing/verification requirements appropriate to your app before public rollout.
2. Create a **Web application** OAuth client. Authorized JavaScript origins: `http://localhost:3000` and the exact production origin. Do not add paths here.
3. Authorized redirect URI: copy the callback displayed in Supabase's Google provider, normally `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. This is the **Supabase callback**, not `/auth/callback` on the app.
4. Enter the Google client ID and client secret in Supabase Auth → Providers → Google. Never put the Google secret in this app's client code.
5. The app sends `redirectTo: APP_ORIGIN/auth/callback` through Supabase. This application redirect must also be in Supabase's allowlist above.
6. Test Google login, refresh, sign-out, and rejection of cross-user access with two real accounts before rollout.

## Email

1. In Resend, add a sender domain and publish the DNS records Resend supplies. Verify the domain. Set `EMAIL_FROM` to a sender on that verified domain, e.g. `Life Admin Inbox <reminders@your-domain.example>`.
2. Create an appropriately scoped Resend API key and set `RESEND_API_KEY`; keep `EMAIL_PROVIDER=resend`.
3. Configure Supabase Auth → SMTP with Resend's current SMTP settings (documented host `smtp.resend.com`, username `resend`, API key as password; choose one of the supported TLS ports shown by Resend). Use the verified sender. Verify signup/reset delivery independently of reminder delivery.
4. For local testing, set `DEV_EMAIL_TO` to the exact address you control and verify. The development demo profile uses that destination, but synthetic tasks are still never sent. A real extracted task must be due for a real delivery test. All other development destinations are blocked.
5. Email reminders use a generic subject/body with an app link. A successful API response with an ID is stored as **Provider accepted**. This does not mean inbox delivery or reading. The application does not implement delivery/bounce webhook reconciliation.
6. Resend is behind the `Delivery` interface in `server/notifications.ts`; another provider can replace it. Unknown `EMAIL_PROVIDER` values fail as unconfigured.

## Browser push

1. Generate VAPID keys locally: `npx web-push generate-vapid-keys`. This creates local keys, not an external account. Set `VAPID_PUBLIC_KEY`, **server-only** `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT=mailto:you@your-domain.example`. Store secrets in your secret manager; do not commit command output.
2. Set the same keys on web and worker. Keep the keys stable: rotating them requires users to resubscribe.
3. Serve over HTTPS in production. Localhost is a browser secure-context exception. `/sw.js` must be served at the root with JavaScript MIME and same origin.
4. The user explicitly presses **Enable notifications** in Preferences. Permission denial is explained. Once permission is granted, the service worker subscription is stored under the authenticated user.
5. Local real push is blocked unless its exact provider endpoint is listed in `DEV_PUSH_ENDPOINTS` (comma separated). You can read your test browser's subscription endpoint in browser developer tools after enabling notifications; treat the full endpoint as a private capability URL and place it only in `.env`.
6. No notification permission prompt appears on initial load. Browser permission, OS settings, battery/network conditions, browser support, installation requirements, and vendor delivery can prevent display. A powered-off device cannot display a notification. TTL is one hour. Expired endpoints returning 404/410 are removed.
7. Supported endpoint providers are explicitly allowlisted (Google FCM, Mozilla, Apple, Windows) to avoid arbitrary server-side requests. A new provider needs a reviewed allowlist update. Push retries are at-least-once, with a stable notification tag; exactly-once display cannot be promised.

## OpenAI

Set `OPENAI_API_KEY` only on the backend. `OPENAI_MODEL` defaults to `gpt-4o-mini`, which passed the project's live text extraction smoke test. The selected model must support Responses text/image inputs and strict JSON-schema structured outputs. There is no automatic fallback to an unverified model.

Run `npm run smoke:openai` once after configuring a key. It sends one short synthetic text document, uses `store:false`, no tools, a 60-second outer timeout and 6,000 maximum output tokens. It checks a single unpaid bill. This is a compatibility smoke test, not a comprehensive accuracy benchmark. Evaluate your own document mix, especially OCR and ambiguous dates, before relying on extraction.

Set account/project spend alerts and provider quotas. Application limits are listed in ARCHITECTURE.md; they do not replace a provider budget. Review current pricing on the official model/pricing pages, including image-input charges. No pricing is hardcoded.

## Environment reference

| Variable                                         | Required for                       | Exposure / notes                                                   |
| ------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------ |
| `APP_MODE`                                       | Always                             | `development` locally, `production` online; never deploy demo mode |
| `NODE_ENV`                                       | Built deployment                   | `production` serves built assets and rejects development mode      |
| `APP_ORIGIN`                                     | Always                             | Exact browser origin; HTTPS online                                 |
| `PORT`                                           | Web service                        | Render supplies it; local default 3000                             |
| `LOCAL_DATA_DIR`                                 | Local adapter                      | Default `.local`; ignored, not public                              |
| `DATABASE_URL`                                   | Hosted web + worker                | Server secret; same DB for both                                    |
| `DATABASE_CA_PATH`                               | Connections requiring a private CA | Path to the provider's trusted CA PEM; optional                    |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`              | Real auth                          | Public browser config                                              |
| `SUPABASE_SERVICE_ROLE_KEY`                      | Hosted storage                     | Server secret; never client-side                                   |
| `STORAGE_BUCKET`                                 | Storage                            | Default `life-admin-originals`; adjust SQL if renamed              |
| `OPENAI_API_KEY`, `OPENAI_MODEL`                 | Real extraction                    | Key server-only; model configurable                                |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Email                              | Provider `resend`; key server-only                                 |
| `DEV_EMAIL_TO`                                   | Development delivery               | Exact owned test destination only                                  |
| `VAPID_PUBLIC_KEY`                               | Push client/server                 | Public by design                                                   |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`             | Push worker                        | Private key server-only; mailto contact required                   |
| `DEV_PUSH_ENDPOINTS`                             | Development delivery               | Exact private endpoint allowlist                                   |
| `RUN_WORKER`                                     | Web process                        | Local worker automatic; production `0` for separate worker         |

## Deploy later (owner action, not performed)

1. Complete local checks, provider setup, database migration, and private bucket setup. Test real auth/storage/extraction/email/push with two owned accounts. Check the verification handoff.
2. Connect the source repository to your hosting workflow when you choose to deploy. Publishing source to GitHub does not deploy the app or configure its services.
3. Create Render Node **web service** and **background worker** from the same source. `render.yaml` is a reference blueprint. Build both with `npm ci && npm run build`. Start web with `npm start`, worker with `npm run worker`.
4. Set `APP_MODE=production`, `NODE_ENV=production`, `APP_ORIGIN=https://YOUR-APP-DOMAIN`, plus all required environment values on both services. Web `RUN_WORKER=0`; one dedicated worker initially. Render supplies web `PORT`. Use Node 24 LTS, matching `.nvmrc` and the hosting blueprint; the minimum supported version is 22.13.0.
5. Use Supabase for persistence; do not attach local PGlite data to Render. The worker and web server share DB and bucket. Run schema migration explicitly before first start, and for subsequent schema changes; production startup does not silently migrate.
6. Verify `/healthz`, then test login and a complete document-to-reminder lifecycle. `/healthz` only indicates that the web process is serving; also monitor worker progress and DB/provider errors.
7. Verify private bucket access denial, RLS behavior with two real users, origin configuration, redirects, email DNS, push permission and test delivery. Repeat restart and concurrent-worker tests against real PostgreSQL before scaling workers.
8. Configure monitoring for old queued/staging jobs, failed extraction, blocked/failed reminders, and cleanup jobs with increasing attempts. Do not log raw document data. Set backup/restore and incident procedures appropriate to your retention promises.

Neither hosting infrastructure nor live service behavior is established by the local tests. Missing configuration is shown explicitly in Preferences and per-document/per-reminder failures.
