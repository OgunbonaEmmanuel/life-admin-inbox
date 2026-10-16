-- Run in the project's Supabase SQL editor after npm run db:migrate.
-- Never make this bucket public. Only the trusted server writes originals;
-- no browser INSERT/UPDATE/DELETE policies bypass the API quotas.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('life-admin-originals','life-admin-originals',false,8388608,ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=8388608,allowed_mime_types=EXCLUDED.allowed_mime_types;

-- Reads require both an authenticated owner path and a non-deleted application row.
-- Downloads in the app use the API proxy and its RLS check; direct storage access
-- receives no authenticated policies. Service-role access remains backend-only.
-- Supabase denies authenticated access by default when no policy grants it.
-- Remove any pre-existing broad policies that expose this dedicated bucket.

REVOKE ALL ON SCHEMA lifeadmin FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA lifeadmin FROM anon, authenticated;
-- API transactions SET LOCAL ROLE lifeadmin_user and set app.user_id after
-- validating the Supabase access token. Never expose a set-user-id SQL RPC.
GRANT lifeadmin_user TO postgres;
