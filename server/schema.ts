// The same PostgreSQL schema runs in local PGlite and hosted Supabase.
export const schema = `
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifeadmin_user') THEN CREATE ROLE lifeadmin_user NOLOGIN NOBYPASSRLS; END IF; END $$;
CREATE SCHEMA IF NOT EXISTS lifeadmin;
CREATE TABLE IF NOT EXISTS lifeadmin.profiles (
 user_id uuid PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lifeadmin.documents (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, hash text NOT NULL, object_key text NOT NULL,
 data jsonb NOT NULL, deleted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,hash), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS lifeadmin.tasks (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, document_id uuid NOT NULL, fingerprint text NOT NULL,
 data jsonb NOT NULL, UNIQUE(document_id,fingerprint), UNIQUE(id,user_id),
 FOREIGN KEY(document_id,user_id) REFERENCES lifeadmin.documents(id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS lifeadmin.jobs (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, document_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('extract','cleanup')), state text NOT NULL DEFAULT 'queued',
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, lease_token uuid, error text,
 UNIQUE(document_id,kind), FOREIGN KEY(document_id,user_id) REFERENCES lifeadmin.documents(id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS lifeadmin.reminders (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, task_id uuid NOT NULL, revision integer NOT NULL,
 channel text NOT NULL CHECK(channel IN ('email','push')), scheduled_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'scheduled', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL, lease_until timestamptz, lease_token uuid, error text, provider_id text,
 UNIQUE(task_id,revision,channel,scheduled_at), FOREIGN KEY(task_id,user_id) REFERENCES lifeadmin.tasks(id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS lifeadmin.push_subscriptions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, endpoint text NOT NULL UNIQUE, data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS lifeadmin.push_receipts (
 reminder_id uuid NOT NULL REFERENCES lifeadmin.reminders(id) ON DELETE CASCADE,
 subscription_id uuid NOT NULL, user_id uuid NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(reminder_id,subscription_id)
);
CREATE TABLE IF NOT EXISTS lifeadmin.usage (
 user_id uuid NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE, uploads integer NOT NULL DEFAULT 0,
 extractions integer NOT NULL DEFAULT 0, PRIMARY KEY(user_id,day)
);
CREATE INDEX IF NOT EXISTS jobs_due ON lifeadmin.jobs(state,available_at,lease_until);
CREATE INDEX IF NOT EXISTS reminders_due ON lifeadmin.reminders(status,available_at,lease_until);
GRANT USAGE ON SCHEMA lifeadmin TO lifeadmin_user;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA lifeadmin TO lifeadmin_user;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','documents','tasks','jobs','reminders','push_subscriptions','push_receipts','usage'] LOOP
  EXECUTE format('ALTER TABLE lifeadmin.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE lifeadmin.%I FORCE ROW LEVEL SECURITY',t);
  IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='lifeadmin' AND tablename=t AND policyname='owner_only') THEN
   EXECUTE format('CREATE POLICY owner_only ON lifeadmin.%I TO lifeadmin_user USING (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid) WITH CHECK (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)',t);
  END IF;
 END LOOP;
END $$;
`;
