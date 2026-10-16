# Implementation rules

- Work only within LifeAdminInbox.
- Follow PROJECT_BRIEF.md and the owner's full request. Do not commit, push, create external accounts, purchase, or deploy.
- Use strict TypeScript, small server modules, parameterized SQL and schema validation. Never trust client user IDs, MIME labels, document text, model JSON, or push endpoints.
- All user data access must use an owner-scoped database transaction with row-level security. Privileged queue claims are worker-only. Originals stay outside the public directory and require server authorization.
- Never expose secrets, raw document bodies or authentication tokens in logs, bundles, or Git. Keep `.env` and local data ignored. Only explicitly public configuration can reach the browser.
- Development identity and fixtures must be unmistakably labelled, loopback-only, and impossible to enable in production. Missing integrations must be visible and fail honestly.
- Use transactions, unique keys and worker leases to prevent duplicate tasks/reminders; preserve user edits and deletion tombstones across extraction retries.
- Do not infer missing financial/date/timezone facts. Uncertain scheduling is disabled. Document evidence matching is a validation step, not an accuracy guarantee.
- Notification delivery must be server-side, bounded and cancellable. Only configured test destinations receive development messages. Queued or simulated messages must never be marked delivered.
- Test meaningful behavior and isolation, including concurrent claims, restart recovery, DST, parser abuse, invalid evidence, permission denial and expired subscriptions. Record actual results and external verification gaps.
- Use current official integration documentation and record source URLs in docs. Do not invent prices.
