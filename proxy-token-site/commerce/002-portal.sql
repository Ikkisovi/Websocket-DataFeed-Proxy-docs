CREATE SCHEMA portal;
CREATE TABLE portal.migrations (
  version integer PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal.documents (
  name text PRIMARY KEY CHECK (name IN ('accounts','pending','bulk_orders','registry')),
  version bigint NOT NULL DEFAULT 0,
  projected_version bigint NOT NULL DEFAULT 0,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO portal.documents(name) VALUES ('accounts'),('pending'),('bulk_orders'),('registry');
CREATE TABLE portal.accounts (
  ordinal integer PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  account_id text GENERATED ALWAYS AS (COALESCE(payload->>'account_id',payload->>'username')) STORED,
  username text GENERATED ALWAYS AS (payload->>'username') STORED,
  phone text GENERATED ALWAYS AS (payload->>'phone') STORED,
  email text GENERATED ALWAYS AS (payload->>'email') STORED,
  role text GENERATED ALWAYS AS (payload->>'role') STORED,
  tier text GENERATED ALWAYS AS (payload->>'tier') STORED
);
CREATE INDEX portal_account_identity ON portal.accounts(account_id);
CREATE INDEX portal_login_identity ON portal.accounts(lower(username),phone);
CREATE TABLE portal.principals (
  ordinal integer PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  user_id text GENERATED ALWAYS AS (payload->>'user_id') STORED,
  token text GENERATED ALWAYS AS (payload->>'token') STORED,
  role text GENERATED ALWAYS AS (payload->>'role') STORED,
  expires_at_text text GENERATED ALWAYS AS (payload->>'expires_at') STORED
);
CREATE INDEX portal_principal_identity ON portal.principals(user_id);
CREATE INDEX portal_principal_token ON portal.principals(token);
CREATE TABLE portal.registrations (
  ordinal integer PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  id text GENERATED ALWAYS AS (payload->>'id') STORED,
  account_id text GENERATED ALWAYS AS (COALESCE(payload->>'account_id',payload->>'username')) STORED,
  status text GENERATED ALWAYS AS (payload->>'status') STORED,
  kind text GENERATED ALWAYS AS (payload->>'type') STORED
);
CREATE INDEX portal_registration_identity ON portal.registrations(id);
CREATE TABLE portal.bulk_orders (
  ordinal integer PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  id text GENERATED ALWAYS AS (payload->>'id') STORED,
  status text GENERATED ALWAYS AS (payload->>'status') STORED
);
CREATE INDEX portal_bulk_identity ON portal.bulk_orders(id);
CREATE TABLE portal.events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document text NOT NULL REFERENCES portal.documents(name),
  version bigint NOT NULL,
  row_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document,version)
);
CREATE TABLE portal.import_receipts (
  source_sha256 text PRIMARY KEY,
  counts jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal.sessions (
  token_sha256 text PRIMARY KEY,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX portal_session_expiry ON portal.sessions(expires_at);
