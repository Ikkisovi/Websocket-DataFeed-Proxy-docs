CREATE SCHEMA commerce;
CREATE TABLE commerce.migrations (
  version integer PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.orders (
  id text PRIMARY KEY,
  ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payload->>'id' = id),
  CHECK (payload->>'status' IN ('PENDING','PAID','FULFILLING','COMPLETED','FAILED','CANCELLED','MANUAL_REVIEW')),
  CHECK (payload->>'payment_status' IN ('UNPAID','PAID','PAID_MISMATCH')),
  CHECK (payload->>'kind' IN ('registration','renewal'))
);
CREATE UNIQUE INDEX commerce_provider_receipt ON commerce.orders
  ((payload->>'provider'), (payload->>'provider_payment_id'))
  WHERE payload->>'payment_status' = 'PAID' AND payload->>'provider_payment_id' IS NOT NULL;
CREATE FUNCTION commerce.guard_order_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text;
BEGIN
  FOREACH field IN ARRAY ARRAY['id','kind','registration_id','registration','user_id',
    'bundle_id','bundle','provider','provider_charge','payment_method','created_at',
    'resume_token_hash','checkout_token_hash'] LOOP
    IF NEW.payload->field IS DISTINCT FROM OLD.payload->field THEN
      RAISE EXCEPTION 'immutable_payment_snapshot' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF NEW.version <> OLD.version+1
    OR (OLD.payload->>'payment_status'='PAID' AND NEW.payload->>'payment_status'<>'PAID')
    OR (OLD.payload->>'status'='COMPLETED' AND NEW.payload->>'status'<>'COMPLETED')
    OR (OLD.payload->>'payment_status'='PAID' AND OLD.payload->>'provider_payment_id' IS NOT NULL
      AND NEW.payload->>'provider_payment_id' IS DISTINCT FROM OLD.payload->>'provider_payment_id') THEN
    RAISE EXCEPTION 'invalid_payment_transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commerce_order_update BEFORE UPDATE ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.guard_order_update();
CREATE TABLE commerce.payments (
  order_id text PRIMARY KEY REFERENCES commerce.orders(id),
  provider text NOT NULL,
  provider_transaction_id text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency IN ('CNY','USD','CAD')),
  state text NOT NULL CHECK (state IN ('UNPAID','PAID','PAID_MISMATCH')),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  check_token uuid,
  check_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commerce_payment_transaction ON commerce.payments(provider,provider_transaction_id)
  WHERE state='PAID' AND provider_transaction_id IS NOT NULL;
CREATE TABLE commerce.order_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce.orders(id),
  version bigint NOT NULL,
  action text NOT NULL,
  status text NOT NULL,
  payment_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, version)
);
CREATE TABLE commerce.fulfillment_jobs (
  order_id text PRIMARY KEY REFERENCES commerce.orders(id),
  state text NOT NULL CHECK (state IN ('queued','running','done','blocked')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_due_jobs ON commerce.fulfillment_jobs(next_attempt_at)
  WHERE state IN ('queued','running');
CREATE TABLE commerce.import_receipts (
  source_sha256 text PRIMARY KEY,
  order_count integer NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
