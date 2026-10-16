# Life Admin Inbox

Independent project in this directory. Source of scope: the owner's attached request, 11 October 2026.

## Outcome

A private online document inbox that creates supported payment, appointment, and school/work deadline tasks automatically. Users can edit, dismiss, delete, complete, and reopen tasks, inspect supporting sources, and receive durable email and browser-push reminders. A calm responsive Today view, upcoming timeline, document inbox, and settings form the core interface.

## Stack and boundaries

- React / Vite / TypeScript frontend, Express / TypeScript API and worker.
- Supabase Auth (verified email/password, reset, Google), Postgres, private Storage.
- Render web service and background worker. Postgres queue with leases, transactional writes, deduplication, bounded retries, and restart recovery; no extra queue vendor.
- Resend transactional email; standards-based Web Push with VAPID.
- Server-only OpenAI Responses API, configurable model (initially `gpt-4.1-mini`). Strict structured output, source checks, bounded input/output. Vision transcription for screenshots/scanned pages.
- Credential-free local adapters: persisted embedded Postgres (PGlite), filesystem originals, explicit loopback-only development identity. Synthetic demo fixtures are labelled; real extraction and delivery are never simulated as production successes.

## Required behavior

Validate file bytes and parse structure for PDF, DOCX, PNG, JPEG. Bound bytes, pages, decompression, pixels, text, runtime, model calls, and retries. Originals use generated private paths. Every API/database/storage action must enforce ownership. Documents are untrusted; no embedded execution or document-supplied URL fetching.

Extract title, category, explicit dates/times/amounts/currency/organization, evidence, source location, and uncertainty. Paid receipts, historical/completed obligations, examples, and nonactionable content create no tasks. Missing/ambiguous dates remain unscheduled. Relative dates need document evidence for their reference. Preserve edits and tombstones on retries; matching evidence does not prove interpretation.

Default date-only reminders: previous day and due date, 09:00 in explicit user timezone. Timed appointments: 24 hours before and appointment instant. Customize lead days and local reminder hour. Never guess an appointment timezone. Ignore already-passed reminder slots at discovery; overdue tasks remain visible. On worker recovery, expire reminders more than one hour stale and coalesce coincident slots. Channels independently controlled; generic notification previews. Provider acceptance is distinct from delivery to a person/device.

Document deletion immediately hides source and cancels/deletes associated tasks, reminders and extraction jobs; durable storage cleanup retries if needed. Document retention is until user deletion; provider backups/processing retention documented separately.

## Implementation stages

1. Scope, official documentation, project foundation.
2. Data isolation, ingestion, extraction, durable jobs and scheduling.
3. Auth, email, push, polished accessible interface, synthetic demo files.
4. Behavioral, security, build/type and browser checks; setup and deployment handoff.

## Authorization

Build and test locally. Do not buy services, create external accounts, commit, push, or deploy. Continue independent implementation when credentials are absent. Run a bounded real OpenAI smoke test only if a credential is already configured. Clearly distinguish local verification from external integrations requiring setup.
