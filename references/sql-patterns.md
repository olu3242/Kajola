# SQL Patterns Reference

Reusable Postgres patterns for Kajola-generated platforms. Copy directly into migration files.

---

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- trigram search
CREATE EXTENSION IF NOT EXISTS "unaccent";       -- accent-insensitive search
CREATE EXTENSION IF NOT EXISTS "postgis";        -- geospatial (if location features needed)
CREATE EXTENSION IF NOT EXISTS "pg_cron";        -- scheduled jobs
```

---

## Helper Functions

### updated_at trigger function

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Apply to every table:

```sql
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON [table_name]
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### current_user_tenant_id()

```sql
CREATE OR REPLACE FUNCTION current_user_tenant_id()
RETURNS uuid AS $$
  SELECT (auth.jwt() ->> 'tenant_id')::uuid;
$$ LANGUAGE sql STABLE;
```

### is_super_admin()

```sql
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
  SELECT coalesce((auth.jwt() ->> 'role') = 'super_admin', false);
$$ LANGUAGE sql STABLE;
```

### generate_otp()

```sql
CREATE OR REPLACE FUNCTION generate_otp(length integer DEFAULT 6)
RETURNS text AS $$
  SELECT string_agg(floor(random() * 10)::text, '')
  FROM generate_series(1, length);
$$ LANGUAGE sql VOLATILE;
```

---

## Row-Level Security Patterns

### Tenant isolation (standard pattern)

```sql
ALTER TABLE [table_name] ENABLE ROW LEVEL SECURITY;

-- Tenant members can read their own tenant's data
CREATE POLICY "[table_name]_tenant_select"
  ON [table_name] FOR SELECT
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

-- Tenant members can insert into their own tenant
CREATE POLICY "[table_name]_tenant_insert"
  ON [table_name] FOR INSERT
  WITH CHECK (tenant_id = current_user_tenant_id());

-- Tenant members can update their own tenant's data
CREATE POLICY "[table_name]_tenant_update"
  ON [table_name] FOR UPDATE
  USING (tenant_id = current_user_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_user_tenant_id());

-- Only super admin can delete (soft-delete pattern preferred)
CREATE POLICY "[table_name]_super_admin_delete"
  ON [table_name] FOR DELETE
  USING (is_super_admin());
```

### User owns their own rows

```sql
ALTER TABLE [table_name] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "[table_name]_owner_select"
  ON [table_name] FOR SELECT
  USING (user_id = auth.uid() OR is_super_admin());

CREATE POLICY "[table_name]_owner_insert"
  ON [table_name] FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "[table_name]_owner_update"
  ON [table_name] FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin());
```

### Public read, owner write

```sql
ALTER TABLE [table_name] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "[table_name]_public_select"
  ON [table_name] FOR SELECT
  USING (true);

CREATE POLICY "[table_name]_owner_insert"
  ON [table_name] FOR INSERT
  WITH CHECK (provider_id = auth.uid());

CREATE POLICY "[table_name]_owner_update"
  ON [table_name] FOR UPDATE
  USING (provider_id = auth.uid() OR is_super_admin());
```

### Service role bypass (for Edge Functions)

Service role always bypasses RLS automatically. No additional policy needed.
Document which operations use service role vs anon/authenticated keys.

---

## Booking / Slot Conflict Prevention

Prevent double-booking at the database level using an exclusion constraint (requires `btree_gist` extension):

```sql
CREATE EXTENSION IF NOT EXISTS "btree_gist";

ALTER TABLE bookings
  ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'rejected'));
```

Trigger-based alternative (when exclusion constraints aren't suitable):

```sql
CREATE OR REPLACE FUNCTION prevent_booking_conflict()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE provider_id = NEW.provider_id
      AND status NOT IN ('cancelled', 'rejected')
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tstzrange(starts_at, ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'Booking conflict: provider already has a booking in this time slot'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_booking_conflict
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_booking_conflict();
```

---

## Soft Delete Pattern

```sql
-- Add to any table that needs soft delete
ALTER TABLE [table_name] ADD COLUMN deleted_at timestamptz;

-- Filter deleted rows from all queries automatically
CREATE OR REPLACE VIEW [table_name]_active AS
  SELECT * FROM [table_name] WHERE deleted_at IS NULL;

-- Update RLS policies to exclude deleted rows
CREATE POLICY "[table_name]_exclude_deleted"
  ON [table_name] FOR SELECT
  USING (deleted_at IS NULL AND ...);

-- Soft delete function
CREATE OR REPLACE FUNCTION soft_delete_[table_name](record_id uuid)
RETURNS void AS $$
  UPDATE [table_name] SET deleted_at = now() WHERE id = record_id;
$$ LANGUAGE sql;
```

---

## Wallet / Balance Pattern

```sql
CREATE TABLE wallets (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  balance_kobo    bigint NOT NULL DEFAULT 0 CHECK (balance_kobo >= 0),  -- store in smallest unit
  currency        text NOT NULL DEFAULT 'NGN',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_user_unique UNIQUE (user_id, currency)
);

CREATE TABLE wallet_transactions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id       uuid NOT NULL REFERENCES wallets(id),
  type            text NOT NULL CHECK (type IN ('credit', 'debit')),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  balance_after_kobo bigint NOT NULL,
  reference       text NOT NULL UNIQUE,
  description     text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Atomic balance update with transaction record
CREATE OR REPLACE FUNCTION update_wallet_balance(
  p_wallet_id     uuid,
  p_type          text,
  p_amount_kobo   bigint,
  p_reference     text,
  p_description   text,
  p_metadata      jsonb DEFAULT '{}'
)
RETURNS wallet_transactions AS $$
DECLARE
  v_wallet wallets;
  v_new_balance bigint;
  v_txn wallet_transactions;
BEGIN
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;

  IF p_type = 'debit' AND v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient balance' USING ERRCODE = 'check_violation';
  END IF;

  v_new_balance := CASE p_type
    WHEN 'credit' THEN v_wallet.balance_kobo + p_amount_kobo
    WHEN 'debit'  THEN v_wallet.balance_kobo - p_amount_kobo
  END;

  UPDATE wallets SET balance_kobo = v_new_balance WHERE id = p_wallet_id;

  INSERT INTO wallet_transactions (wallet_id, type, amount_kobo, balance_after_kobo, reference, description, metadata)
  VALUES (p_wallet_id, p_type, p_amount_kobo, v_new_balance, p_reference, p_description, p_metadata)
  RETURNING * INTO v_txn;

  RETURN v_txn;
END;
$$ LANGUAGE plpgsql;
```

---

## OTP / Phone Auth Pattern

```sql
CREATE TABLE phone_otps (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone       text NOT NULL,
  otp_hash    text NOT NULL,              -- bcrypt hash, never store plaintext
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  verified_at timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX phone_otps_phone_idx ON phone_otps (phone, created_at DESC);

-- Clean up expired OTPs daily
SELECT cron.schedule('cleanup-expired-otps', '0 3 * * *', $$
  DELETE FROM phone_otps WHERE expires_at < now() - interval '1 day';
$$);
```

Edge function logic (pseudo-code):
1. On send OTP: generate 6-digit code, hash with bcrypt, insert row, call Termii API
2. On verify OTP: find latest unexpired row for phone, compare bcrypt hash, mark verified, issue Supabase session
3. Rate limit: max 3 OTP requests per phone per 10 minutes (check count in `phone_otps`)

---

## Full-Text Search Pattern

```sql
-- Add search vector column
ALTER TABLE [table_name] ADD COLUMN search_vector tsvector;

-- Populate search vector
UPDATE [table_name]
SET search_vector = to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''));

-- Create GIN index
CREATE INDEX [table_name]_search_idx ON [table_name] USING GIN (search_vector);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_[table_name]_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.name, '') || ' ' || coalesce(NEW.description, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER [table_name]_search_vector_update
  BEFORE INSERT OR UPDATE ON [table_name]
  FOR EACH ROW EXECUTE FUNCTION update_[table_name]_search_vector();
```

Search query with ranking:

```sql
SELECT *, ts_rank(search_vector, query) AS rank
FROM [table_name], plainto_tsquery('english', $1) query
WHERE search_vector @@ query
  AND tenant_id = current_user_tenant_id()
ORDER BY rank DESC
LIMIT 20;
```

---

## PostGIS Location Pattern

```sql
-- Add location column
ALTER TABLE [table_name] ADD COLUMN location geography(POINT, 4326);

-- Create spatial index
CREATE INDEX [table_name]_location_idx ON [table_name] USING GIST (location);

-- Insert with coordinates
INSERT INTO [table_name] (location) VALUES (ST_MakePoint(lng, lat));

-- Find within radius (metres)
SELECT *, ST_Distance(location, ST_MakePoint($lng, $lat)::geography) AS distance_metres
FROM [table_name]
WHERE ST_DWithin(location, ST_MakePoint($lng, $lat)::geography, $radius_metres)
ORDER BY distance_metres
LIMIT 20;
```

---

## Audit Log Pattern

```sql
CREATE TABLE audit_logs (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id),
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,             -- e.g. 'booking.created', 'payment.refunded'
  entity_type text NOT NULL,             -- e.g. 'booking', 'user'
  entity_id   uuid NOT NULL,
  old_data    jsonb,
  new_data    jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, created_at DESC);

-- Append-only: no UPDATE or DELETE
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_admin_only"
  ON audit_logs FOR SELECT
  USING (tenant_id = current_user_tenant_id() AND is_super_admin());
```

---

## Common Index Patterns

```sql
-- Compound index for tenant + status queries
CREATE INDEX [table]_tenant_status_idx ON [table] (tenant_id, status) WHERE deleted_at IS NULL;

-- Partial index for active records
CREATE INDEX [table]_active_idx ON [table] (tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- FK index (Postgres does not auto-index FK columns)
CREATE INDEX [table]_[fk_column]_idx ON [table] ([fk_column]);

-- Text search with trigrams (for LIKE queries)
CREATE INDEX [table]_name_trgm_idx ON [table] USING GIN (name gin_trgm_ops);
```

---

## Mobile Money Transaction Pattern

Universal table for M-Pesa, MTN Mobile Money, Orange Money, and Flutterwave. Covers both C2B (customer pays) and B2C/B2B (platform pays out).

```sql
CREATE TYPE momo_provider AS ENUM (
  'mpesa_ke',       -- M-Pesa Kenya (Daraja)
  'mpesa_tz',       -- M-Pesa Tanzania
  'mtn_gh',         -- MTN Mobile Money Ghana
  'mtn_cm',         -- MTN Mobile Money Cameroon
  'orange_ci',      -- Orange Money Côte d'Ivoire
  'orange_sn',      -- Orange Money Senegal
  'vodafone_gh',    -- Vodafone Cash Ghana
  'airtel_ke'       -- Airtel Money Kenya
);

CREATE TYPE momo_direction AS ENUM ('c2b', 'b2c', 'b2b', 'reversal');
CREATE TYPE momo_status    AS ENUM ('pending', 'completed', 'failed', 'reversed', 'timeout');

CREATE TABLE mobile_money_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  booking_id       uuid REFERENCES bookings(id),    -- nullable: some payouts not booking-linked
  provider         momo_provider NOT NULL,
  direction        momo_direction NOT NULL,
  phone            text NOT NULL,                   -- E.164 without + for M-Pesa; with + for others
  amount           integer NOT NULL,                -- whole units (shillings, cedis, francs)
  currency         text NOT NULL,                   -- ISO 4217: KES, GHS, XOF, …
  status           momo_status NOT NULL DEFAULT 'pending',
  provider_ref     text,                            -- provider's transaction ID (e.g. QHX12345KL)
  checkout_req_id  text,                            -- M-Pesa CheckoutRequestID (STK Push only)
  idempotency_key  text NOT NULL UNIQUE,            -- e.g. 'stk_{booking_id}' or 'b2c_{booking_id}'
  raw_callback     jsonb,                           -- full provider callback body for replay
  failure_reason   text,
  initiated_at     timestamptz NOT NULL DEFAULT now(),
  settled_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_momo_tenant_status    ON mobile_money_transactions (tenant_id, status);
CREATE INDEX idx_momo_booking          ON mobile_money_transactions (booking_id);
CREATE INDEX idx_momo_provider_ref     ON mobile_money_transactions (provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX idx_momo_idempotency      ON mobile_money_transactions (idempotency_key);
CREATE INDEX idx_momo_checkout_req     ON mobile_money_transactions (checkout_req_id) WHERE checkout_req_id IS NOT NULL;

SELECT update_updated_at('mobile_money_transactions');
```

---

## USSD Session Pattern

For platforms using Africa's Talking USSD gateway. Sessions are stateless — full input history arrives in each request; state is reconstructed from the `text` field.

```sql
CREATE TABLE ussd_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  session_id    text NOT NULL,          -- Africa's Talking sessionId (unique per USSD dial)
  phone         text NOT NULL,          -- caller's phone number (E.164)
  service_code  text NOT NULL,          -- shortcode, e.g. '*384*1234#'
  input_text    text NOT NULL DEFAULT '', -- full cumulative input, e.g. '1*2*3'
  step_count    smallint NOT NULL DEFAULT 0,
  resolved_user uuid REFERENCES auth.users(id), -- null if unauthenticated USSD
  last_response text,                   -- last CON/END response sent (for debug)
  ended_at      timestamptz,            -- null if session still open
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ussd_session_id ON ussd_sessions (session_id);
CREATE INDEX idx_ussd_phone_recent     ON ussd_sessions (phone, created_at DESC);

SELECT update_updated_at('ussd_sessions');

-- Sessions expire in 3 minutes (Africa's Talking default); clean up daily
SELECT cron.schedule('cleanup-ussd-sessions', '30 3 * * *', $$
  DELETE FROM ussd_sessions WHERE created_at < now() - interval '1 day';
$$);
```

---

## SMS / Notification Log Pattern

Tracks outbound SMS and push messages for delivery confirmation, retry, and audit.

```sql
CREATE TYPE sms_provider   AS ENUM ('termii', 'africa_talking', 'twilio', 'bulk_sms');
CREATE TYPE sms_channel    AS ENUM ('sms', 'whatsapp', 'dnd', 'ussd');
CREATE TYPE sms_status     AS ENUM ('queued', 'sent', 'delivered', 'failed', 'rejected');

CREATE TABLE sms_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  provider         sms_provider NOT NULL,
  channel          sms_channel NOT NULL DEFAULT 'sms',
  recipient_phone  text NOT NULL,
  locale           text NOT NULL DEFAULT 'en-NG',    -- e.g. 'en-GH', 'fr-CI', 'sw-KE'
  template_key     text,                             -- i18n key, e.g. 'booking_confirmed'
  message          text NOT NULL,
  provider_msg_id  text,                             -- provider's message ID for status lookup
  status           sms_status NOT NULL DEFAULT 'queued',
  attempts         smallint NOT NULL DEFAULT 0,
  last_error       text,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_logs_tenant       ON sms_logs (tenant_id, created_at DESC);
CREATE INDEX idx_sms_logs_phone        ON sms_logs (recipient_phone, created_at DESC);
CREATE INDEX idx_sms_logs_status       ON sms_logs (status) WHERE status IN ('queued', 'failed');
CREATE INDEX idx_sms_logs_provider_ref ON sms_logs (provider_msg_id) WHERE provider_msg_id IS NOT NULL;

ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY sms_logs_manager ON sms_logs
  USING (tenant_id = current_user_tenant_id() AND current_setting('app.role', true) IN ('manager','admin','service'));
```

---

## Idempotency Key Pattern (General)

Use for any operation that must not be executed more than once even if the network retries.

```sql
CREATE TABLE idempotency_keys (
  key          text PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  operation    text NOT NULL,          -- e.g. 'stk_push', 'b2c_payout', 'otp_send'
  status       text NOT NULL DEFAULT 'processing'
               CHECK (status IN ('processing', 'completed', 'failed')),
  response     jsonb,                  -- cached response to return on duplicate
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_idem_tenant_op ON idempotency_keys (tenant_id, operation);
CREATE INDEX idx_idem_expires   ON idempotency_keys (expires_at);

-- Clean up expired keys daily
SELECT cron.schedule('cleanup-idempotency-keys', '0 4 * * *', $$
  DELETE FROM idempotency_keys WHERE expires_at < now();
$$);
```

Usage in Edge Function:

```typescript
async function guardIdempotent(key: string, operation: string, tenantId: string): Promise<{ isNew: boolean; cached?: unknown }> {
  const { error, data } = await supabase
    .from('idempotency_keys')
    .upsert({ key, operation, tenant_id: tenantId, status: 'processing' }, { onConflict: 'key', ignoreDuplicates: true })
    .select('status, response')
    .single();

  if (error) return { isNew: true }; // upsert won = new request
  if (data?.status === 'completed') return { isNew: false, cached: data.response };
  return { isNew: true }; // was processing — let it through (rare race)
}
```
