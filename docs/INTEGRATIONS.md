# Integration decisions and official references

Documentation checked 11 October 2026, with the local OpenAI model configuration verified 12 October 2026. These are the sources used to choose and implement integrations; see VERIFICATION.md for actual live service checks.

## OpenAI

The default model is **GPT-4o mini**, configurable through `OPENAI_MODEL`. Its official model page lists image input, the Responses endpoint and structured outputs. This is a bounded, non-reasoning extraction workflow; no claim that it is the newest or most accurate model is made. The SDK uses `responses.parse`, `zodTextFormat`, `text.format`, `max_output_tokens`, `store:false`, and per-request abort signals. No tools or model-directed URL fetching are available. Schema compliance and evidence matching do not establish semantic correctness.

- [Model capabilities and current pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini): the backend, example configuration, and hosting blueprint use `gpt-4o-mini`. The original `gpt-4.1-mini` request was denied for the owner's project; one live text extraction smoke test passed with `gpt-4o-mini`. Live vision remains unverified.
- [Responses structured output and refusal/incomplete handling](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [Image input and vision limitations](https://developers.openai.com/api/docs/guides/images-vision)
- [API data controls and retention](https://developers.openai.com/api/docs/guides/your-data)

The implementation sends images as data URLs and document text as untrusted user content. It avoids the Files API and requests no response storage. Do not equate this with zero retention: provider abuse-monitoring and contractual controls still apply. Actual account access is checked only by a real smoke test. Pricing is deliberately not copied into the app; consult current provider pricing before rollout.

## Supabase

Auth provides password and Google account flows; the backend validates user tokens and email confirmation. Private Storage and PostgreSQL reduce separate service accounts. All application tables use owner RLS under a restricted SQL role; the browser cannot directly access the dedicated app schema or original bucket. Production storage operations use the server credential only after ownership checks.

- [Password authentication and recovery](https://supabase.com/docs/guides/auth/passwords)
- [Google OAuth setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Database connection options](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Custom SMTP for production auth emails](https://supabase.com/docs/guides/auth/auth-smtp)

## Hosting and durable jobs

Render runs a Node web service plus a continuously running worker. A Postgres queue implements atomic `FOR UPDATE SKIP LOCKED` claims, expiring leases and fenced completion; this avoids Redis or an additional queue account. Local PGlite is an embedded PostgreSQL development adapter using the same schema. It is single-process and is not hosted storage.

- [Render background workers](https://render.com/docs/background-workers)
- [Render Node runtime configuration](https://render.com/docs/node-version)

## Email and browser push

Resend sends generic reminders with stable idempotency keys. An API acceptance ID is recorded as accepted, not delivered or read. Its idempotency retention is finite; the app expires stale reminders inside its retry window. Browser Web Push uses an explicit permission gesture, service worker, owner-scoped subscriptions and VAPID. Push service acceptance cannot guarantee device display.

- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend idempotency behavior](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [MDN Push API and browser restrictions](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
