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

## Staff Availability & Scheduling Pattern

Separates the recurring weekly template (`availability_windows`) from one-off overrides (`availability_overrides`). Availability is always computed from the DB, never from application code.

```sql
-- Recurring weekly schedule per staff per branch
CREATE TABLE availability_windows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  staff_id      uuid NOT NULL REFERENCES staff(id),
  day_of_week   smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 6=Sat
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  UNIQUE (staff_id, branch_id, day_of_week, start_time)
);

-- One-off overrides: extra availability or blocks (holiday, sickness, training)
CREATE TABLE availability_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  staff_id      uuid NOT NULL REFERENCES staff(id),
  branch_id     uuid REFERENCES branches(id),
  override_type text NOT NULL CHECK (override_type IN ('available','blocked')),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_avail_windows_staff     ON availability_windows (staff_id, day_of_week) WHERE is_active;
CREATE INDEX idx_avail_overrides_staff   ON availability_overrides (staff_id, starts_at, ends_at);
```

---

## Appointment Booking Pattern (SORF-compliant)

Booking lifecycle: `pending` → `confirmed` → `checked_in` → `in_progress` → `completed` | `cancelled` | `no_show` | `disputed`

```sql
CREATE TYPE booking_status AS ENUM (
  'pending','confirmed','held',
  'checked_in','in_progress',
  'completed','cancelled','no_show','disputed'
);

CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  staff_id         uuid NOT NULL REFERENCES staff(id),
  service_id       uuid NOT NULL REFERENCES services(id),
  customer_id      uuid NOT NULL REFERENCES customers(id),
  status           booking_status NOT NULL DEFAULT 'pending',
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  -- Payment
  total_amount     integer NOT NULL,          -- minor units
  deposit_amount   integer NOT NULL DEFAULT 0,
  deposit_paid     boolean NOT NULL DEFAULT false,
  payment_status   text NOT NULL DEFAULT 'pending'
                   CHECK (payment_status IN ('pending','deposit_paid','paid','refunded','partial_refund')),
  -- SORF tracking
  held_until       timestamptz,              -- optimistic hold expiry (15 min)
  checked_in_at    timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  cancellation_reason text,
  no_show_at       timestamptz,
  -- Recurrence
  recurrence_rule  text,                     -- RRULE string for recurring bookings
  parent_booking_id uuid REFERENCES bookings(id),
  -- Notes
  customer_notes   text,
  staff_notes      text,
  internal_notes   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- SORF slot conflict prevention: scoped to (staff_id, branch_id)
-- Only active bookings block slots — cancelled/no_show free the slot
CREATE EXTENSION IF NOT EXISTS "btree_gist";

ALTER TABLE bookings
  ADD CONSTRAINT no_staff_double_booking
  EXCLUDE USING gist (
    staff_id WITH =,
    branch_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show', 'disputed'));

CREATE INDEX idx_bookings_staff_time    ON bookings (staff_id, starts_at, ends_at);
CREATE INDEX idx_bookings_customer      ON bookings (customer_id, created_at DESC);
CREATE INDEX idx_bookings_branch_status ON bookings (branch_id, status, starts_at);
CREATE INDEX idx_bookings_held          ON bookings (held_until) WHERE status = 'held';

SELECT update_updated_at('bookings');

-- Release expired held slots every minute
SELECT cron.schedule('release-held-slots', '* * * * *', $$
  UPDATE bookings SET status = 'cancelled', cancellation_reason = 'hold_expired'
  WHERE status = 'held' AND held_until < now();
$$);
```

---

## Loyalty & Membership Pattern

```sql
CREATE TYPE loyalty_event_type AS ENUM (
  'points_earned','points_redeemed','points_expired',
  'tier_upgrade','tier_downgrade','membership_activated','membership_renewed'
);

CREATE TABLE loyalty_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  customer_id    uuid NOT NULL REFERENCES customers(id),
  points_balance integer NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  lifetime_points integer NOT NULL DEFAULT 0,
  tier           text NOT NULL DEFAULT 'bronze'
                 CHECK (tier IN ('bronze','silver','gold','platinum')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id)
);

CREATE TABLE loyalty_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  account_id     uuid NOT NULL REFERENCES loyalty_accounts(id),
  booking_id     uuid REFERENCES bookings(id),
  event_type     loyalty_event_type NOT NULL,
  points_delta   integer NOT NULL,            -- positive = earned, negative = redeemed
  balance_after  integer NOT NULL,
  expires_at     timestamptz,                 -- null = no expiry
  description    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  customer_id      uuid NOT NULL REFERENCES customers(id),
  plan_id          uuid NOT NULL REFERENCES membership_plans(id),
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','paused','cancelled','expired')),
  starts_at        date NOT NULL,
  renews_at        date,
  ends_at          date,
  sessions_total   integer,                   -- null = unlimited
  sessions_used    integer NOT NULL DEFAULT 0,
  amount_per_cycle integer NOT NULL,
  currency         text NOT NULL DEFAULT 'NGN',
  payment_ref      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_loyalty_customer ON loyalty_accounts (tenant_id, customer_id);
CREATE INDEX idx_loyalty_txn      ON loyalty_transactions (account_id, created_at DESC);
CREATE INDEX idx_memberships_renew ON memberships (renews_at) WHERE status = 'active';

SELECT update_updated_at('loyalty_accounts');
SELECT update_updated_at('memberships');
```

---

## Branch / Franchise Multi-Location Pattern

```sql
-- Business hierarchy: tenant → business → branches → staff
CREATE TABLE businesses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  name             text NOT NULL,
  slug             text NOT NULL,
  category         text NOT NULL,             -- 'beauty', 'wellness', 'healthcare', 'home_services'
  is_franchise     boolean NOT NULL DEFAULT false,
  deposit_policy   jsonb NOT NULL DEFAULT '{"type": "percentage", "value": 30}'::jsonb,
  cancellation_policy jsonb NOT NULL DEFAULT '{"hours_notice": 24, "fee_pct": 0}'::jsonb,
  no_show_policy   jsonb NOT NULL DEFAULT '{"max_no_shows": 3, "require_prepayment": true}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE branches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  business_id      uuid NOT NULL REFERENCES businesses(id),
  name             text NOT NULL,
  address          text NOT NULL,
  location         geography(POINT, 4326),
  phone            text,
  timezone         text NOT NULL DEFAULT 'Africa/Lagos',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE franchise_owners (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL REFERENCES auth.users(id),
  business_id  uuid NOT NULL REFERENCES businesses(id),
  royalty_pct  numeric(5,2) NOT NULL DEFAULT 5.00,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Materialised view: per-branch KPIs refreshed every 15 minutes
CREATE MATERIALIZED VIEW branch_kpis AS
SELECT
  b.id                                                AS branch_id,
  b.name                                             AS branch_name,
  count(bk.id)                                       AS total_bookings_30d,
  count(bk.id) FILTER (WHERE bk.status = 'completed') AS completed_bookings_30d,
  count(bk.id) FILTER (WHERE bk.status = 'no_show')   AS no_shows_30d,
  sum(bk.total_amount) FILTER (WHERE bk.status = 'completed') AS gmv_30d,
  round(avg(r.score)::numeric, 2)                    AS avg_rating
FROM branches b
LEFT JOIN bookings bk ON bk.branch_id = b.id
  AND bk.created_at >= now() - interval '30 days'
LEFT JOIN reviews r ON r.branch_id = b.id
  AND r.created_at >= now() - interval '30 days'
GROUP BY b.id, b.name;

CREATE UNIQUE INDEX idx_branch_kpis_id ON branch_kpis (branch_id);

SELECT cron.schedule('refresh-branch-kpis', '*/15 * * * *', $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY branch_kpis;
$$);
```

---

## Waitlist Pattern

```sql
CREATE TABLE waitlist_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  staff_id        uuid REFERENCES staff(id),     -- null = any staff
  service_id      uuid NOT NULL REFERENCES services(id),
  customer_id     uuid NOT NULL REFERENCES customers(id),
  preferred_dates date[],                         -- null = any date
  preferred_times tstzrange[],                    -- null = any time
  status          text NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','notified','booked','expired','cancelled')),
  notified_at     timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_waitlist_branch_service ON waitlist_entries (branch_id, service_id)
  WHERE status = 'waiting';

-- When a booking is cancelled, trigger waitlist notification
CREATE OR REPLACE FUNCTION notify_waitlist_on_cancellation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'no_show') AND OLD.status NOT IN ('cancelled', 'no_show') THEN
    -- Mark matching waitlist entries as 'notified' (Edge Function handles actual SMS)
    UPDATE waitlist_entries
    SET status = 'notified', notified_at = now()
    WHERE branch_id  = NEW.branch_id
      AND service_id = NEW.service_id
      AND status     = 'waiting'
      AND (staff_id IS NULL OR staff_id = NEW.staff_id)
      AND expires_at  > now()
    ORDER BY created_at ASC   -- FIFO: earliest waitlist entry gets first notification
    LIMIT 3;                  -- notify top 3 in case first doesn't respond
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_booking_cancelled_notify_waitlist
  AFTER UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION notify_waitlist_on_cancellation();
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

---

## GPS Pings — Append-Only Location Tracking

Real-time position stream for dispatch, home services, and logistics verticals. Append-only — never updated or deleted. Supabase Realtime broadcast per booking.

```sql
-- Table: gps_pings
-- Append-only: no UPDATE/DELETE allowed (enforced by RLS + trigger)
CREATE TABLE gps_pings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  provider_id   uuid NOT NULL REFERENCES staff(id),
  location      geography(POINT, 4326) NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  accuracy_m    float,               -- GPS accuracy in metres (optional)
  speed_kmh     float,               -- optional
  bearing_deg   float                -- 0–359, optional
);

-- Guard: reject pings with future timestamps (clock skew protection)
CREATE OR REPLACE FUNCTION guard_gps_ping_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recorded_at > now() + interval '30 seconds' THEN
    RAISE EXCEPTION 'gps_ping recorded_at cannot be in the future';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_gps_ping_timestamp
BEFORE INSERT ON gps_pings
FOR EACH ROW EXECUTE FUNCTION guard_gps_ping_timestamp();

-- Prevent updates and deletes (append-only enforcement)
CREATE OR REPLACE FUNCTION deny_gps_ping_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gps_pings is append-only';
END;
$$;

CREATE TRIGGER trg_deny_gps_ping_update
BEFORE UPDATE ON gps_pings FOR EACH ROW EXECUTE FUNCTION deny_gps_ping_mutation();

CREATE TRIGGER trg_deny_gps_ping_delete
BEFORE DELETE ON gps_pings FOR EACH ROW EXECUTE FUNCTION deny_gps_ping_mutation();

-- RLS: provider inserts own pings; tenant reads own booking pings
ALTER TABLE gps_pings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "provider_insert_own_pings" ON gps_pings FOR INSERT
  WITH CHECK (provider_id = auth.uid() AND tenant_id = current_user_tenant_id());
CREATE POLICY "tenant_read_pings" ON gps_pings FOR SELECT
  USING (tenant_id = current_user_tenant_id());

-- Spatial index for proximity queries
CREATE INDEX idx_gps_pings_location ON gps_pings USING GIST (location);
CREATE INDEX idx_gps_pings_booking_recorded ON gps_pings (booking_id, recorded_at DESC);

-- Latest ping per booking (for map display)
CREATE OR REPLACE VIEW latest_gps_pings AS
SELECT DISTINCT ON (booking_id)
  booking_id, provider_id, location, recorded_at, accuracy_m, speed_kmh
FROM gps_pings
ORDER BY booking_id, recorded_at DESC;
```

Supabase Realtime: publish a broadcast message on channel `booking:{booking_id}` after insert via an Edge Function or DB webhook. Clients subscribe to this channel for live map updates.

---

## Job Photos — Evidence Table

Before/after/damage photo evidence for home services, equipment rental, and inspection verticals. Files stored in a private Supabase Storage bucket.

```sql
-- Enum for photo type
CREATE TYPE photo_type AS ENUM ('before', 'after', 'damage', 'completion', 'id_verification');

-- Table: job_photos
CREATE TABLE job_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  photo_type    photo_type NOT NULL,
  storage_path  text NOT NULL,   -- path in private 'job-evidence' bucket, e.g. "{tenant_id}/{booking_id}/before-001.jpg"
  caption       text,
  taken_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

-- Only parties to the booking (provider + customer) and tenant admins may view
CREATE POLICY "booking_parties_read_photos" ON job_photos FOR SELECT
  USING (
    tenant_id = current_user_tenant_id()
    AND (
      uploaded_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.id = job_photos.booking_id
          AND (b.customer_id = auth.uid() OR b.staff_id = auth.uid())
      )
    )
  );

-- Provider may insert own photos during active/completed bookings
CREATE POLICY "provider_insert_job_photos" ON job_photos FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND tenant_id = current_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = job_photos.booking_id
        AND b.staff_id = auth.uid()
        AND b.status IN ('checked_in', 'in_progress', 'completed')
    )
  );

CREATE INDEX idx_job_photos_booking ON job_photos (booking_id, photo_type, taken_at);

-- Storage bucket policy (set in Supabase dashboard or migration):
-- Bucket name: "job-evidence", private (no public URL)
-- Authenticated users may GET objects where path starts with their tenant_id
-- Service role may read all (for dispute resolution)
```

---

## Equipment / Vehicle Rental — daterange EXCLUDE USING gist

Rental conflicts are date-based (full days), not timestamp-based. Uses `daterange` with `EXCLUDE USING gist` — parallel to the `tstzrange` pattern used for 1:1 appointments.

```sql
-- Requires btree_gist extension (enabled globally)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- equipment table (or vehicles — same pattern)
CREATE TABLE equipment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES businesses(id),
  branch_id       uuid REFERENCES branches(id),
  name            text NOT NULL,
  category        text NOT NULL,
  daily_rate_kobo bigint NOT NULL,
  security_deposit_kobo bigint NOT NULL DEFAULT 0,
  is_available    boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- rental_bookings — date-range conflict prevention
CREATE TABLE rental_bookings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES businesses(id),
  equipment_id         uuid NOT NULL REFERENCES equipment(id),
  customer_id          uuid NOT NULL REFERENCES users(id),
  rental_period        daterange NOT NULL,          -- e.g. '[2026-08-01,2026-08-05)'
  status               booking_status NOT NULL DEFAULT 'pending',
  held_until           timestamptz,
  total_amount_kobo    bigint NOT NULL,
  security_deposit_kobo bigint NOT NULL DEFAULT 0,
  deposit_status       text NOT NULL DEFAULT 'pending' CHECK (deposit_status IN ('pending','held','returned','forfeited')),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- Date-range exclusion: no two active rentals for the same equipment may overlap
  CONSTRAINT no_overlapping_rentals
    EXCLUDE USING gist (
      equipment_id WITH =,
      rental_period WITH &&
    ) WHERE (status NOT IN ('cancelled', 'no_show'))
);

ALTER TABLE rental_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_rental_bookings" ON rental_bookings
  USING (tenant_id = current_user_tenant_id());

-- Condition records (damage assessment at return)
CREATE TABLE condition_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id       uuid NOT NULL REFERENCES rental_bookings(id),
  recorded_by     uuid NOT NULL REFERENCES users(id),
  condition_at    text NOT NULL CHECK (condition_at IN ('pickup', 'return')),
  notes           text,
  damage_found    boolean NOT NULL DEFAULT false,
  deposit_action  text CHECK (deposit_action IN ('return', 'partial_forfeit', 'full_forfeit')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rental_bookings_equipment ON rental_bookings USING GIST (equipment_id, rental_period);
CREATE INDEX idx_rental_bookings_customer ON rental_bookings (customer_id, status);
```

---

## Class Session Capacity — FOR UPDATE Atomic Enrollment

Fitness/gym class booking uses a FOR UPDATE lock to atomically check and decrement capacity. Prevents overselling without EXCLUDE USING gist (which is for 1:1 time slots).

```sql
-- class_sessions table
CREATE TABLE class_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES businesses(id),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  instructor_id   uuid NOT NULL REFERENCES staff(id),
  service_id      uuid NOT NULL REFERENCES services(id),  -- e.g. "Yoga", "HIIT"
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  capacity        int NOT NULL CHECK (capacity > 0),
  enrolled_count  int NOT NULL DEFAULT 0 CHECK (enrolled_count >= 0),
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT enrolled_not_over_capacity CHECK (enrolled_count <= capacity)
);

-- class_enrollments table
CREATE TABLE class_enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES class_sessions(id),
  customer_id     uuid NOT NULL REFERENCES users(id),
  tenant_id       uuid NOT NULL REFERENCES businesses(id),
  status          text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','waitlisted','cancelled','attended','no_show')),
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_at    timestamptz,

  UNIQUE (session_id, customer_id)  -- one enrollment per customer per session
);

ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_class_sessions" ON class_sessions USING (tenant_id = current_user_tenant_id());
CREATE POLICY "tenant_class_enrollments" ON class_enrollments USING (tenant_id = current_user_tenant_id());

-- DB function: atomic enrollment with FOR UPDATE capacity check
-- Call from Edge Function; wraps in a transaction
CREATE OR REPLACE FUNCTION enroll_in_class(
  p_session_id  uuid,
  p_customer_id uuid,
  p_tenant_id   uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session class_sessions%ROWTYPE;
BEGIN
  -- Lock the session row for the duration of this transaction
  SELECT * INTO v_session FROM class_sessions
  WHERE id = p_session_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.enrolled_count >= v_session.capacity THEN
    -- Add to waitlist instead
    INSERT INTO class_enrollments (session_id, customer_id, tenant_id, status)
    VALUES (p_session_id, p_customer_id, p_tenant_id, 'waitlisted')
    ON CONFLICT (session_id, customer_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'status', 'waitlisted');
  END IF;

  -- Enroll and increment counter atomically
  INSERT INTO class_enrollments (session_id, customer_id, tenant_id, status)
  VALUES (p_session_id, p_customer_id, p_tenant_id, 'confirmed')
  ON CONFLICT (session_id, customer_id) DO UPDATE SET status = 'confirmed';

  UPDATE class_sessions
  SET enrolled_count = enrolled_count + 1
  WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true, 'status', 'confirmed',
    'spots_remaining', v_session.capacity - v_session.enrolled_count - 1);
END;
$$;

-- Trigger: decrement count on cancellation
CREATE OR REPLACE FUNCTION decrement_class_enrollment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'confirmed' THEN
    UPDATE class_sessions SET enrolled_count = GREATEST(0, enrolled_count - 1)
    WHERE id = NEW.session_id;
    -- Promote first waitlisted customer
    UPDATE class_enrollments SET status = 'confirmed'
    WHERE id = (
      SELECT id FROM class_enrollments
      WHERE session_id = NEW.session_id AND status = 'waitlisted'
      ORDER BY enrolled_at ASC LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_decrement_class_enrollment
AFTER UPDATE ON class_enrollments
FOR EACH ROW EXECUTE FUNCTION decrement_class_enrollment();

CREATE INDEX idx_class_sessions_starts_at ON class_sessions (branch_id, starts_at);
CREATE INDEX idx_class_enrollments_session ON class_enrollments (session_id, status);
CREATE INDEX idx_class_enrollments_customer ON class_enrollments (customer_id, status);
```

---

## Multi-Currency Booking Support

Use when a single `tenant` operates across multiple countries with different currencies (e.g. Nigeria NGN + Ghana GHS) and needs to route payments to the correct provider per booking.

```sql
-- Currency enum (extend as needed)
CREATE TYPE supported_currency AS ENUM ('NGN', 'GHS', 'KES', 'UGX', 'XOF', 'ZAR');

-- Payment provider enum
CREATE TYPE payment_provider AS ENUM (
  'paystack', 'flutterwave', 'mpesa_daraja', 'mtn_momo', 'orange_money'
);

-- Branch-level currency and provider configuration
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS currency          supported_currency NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS payment_provider  payment_provider   NOT NULL DEFAULT 'paystack';

-- Multi-currency payment transactions
CREATE TABLE payment_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  booking_id        uuid NOT NULL REFERENCES bookings(id),
  provider          payment_provider NOT NULL,
  provider_ref      text UNIQUE,          -- Paystack ref / Flutterwave tx_ref / MoMo externalId
  amount            numeric(16,2) NOT NULL,
  currency          supported_currency NOT NULL,
  amount_ngn_equiv  numeric(16,2),        -- FX snapshot at time of payment (for reporting)
  fx_rate           numeric(12,6),        -- e.g. 1 GHS = 85.5 NGN at time of payment
  status            payment_status NOT NULL DEFAULT 'pending',
  idempotency_key   text UNIQUE NOT NULL,
  is_deposit        boolean NOT NULL DEFAULT false,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_transactions_booking   ON payment_transactions(booking_id);
CREATE INDEX idx_payment_transactions_provider  ON payment_transactions(provider, provider_ref);

-- FX rate log — snapshot of exchange rates used (for audit)
CREATE TABLE fx_rate_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency  supported_currency NOT NULL,
  to_currency    supported_currency NOT NULL DEFAULT 'NGN',
  rate           numeric(12,6) NOT NULL,
  source         text NOT NULL DEFAULT 'manual',  -- 'manual' | 'openexchangerates' | 'fixer'
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_currency, to_currency, date_trunc('hour', recorded_at))
);

-- Helper function: resolve which payment provider to use for a booking
CREATE OR REPLACE FUNCTION get_payment_provider_for_booking(p_booking_id uuid)
RETURNS payment_provider LANGUAGE sql STABLE AS $$
  SELECT br.payment_provider
  FROM bookings bk
  JOIN branches br ON br.id = bk.branch_id
  WHERE bk.id = p_booking_id;
$$;

-- RLS: tenant isolation
ALTER TABLE payment_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rate_snapshots     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON payment_transactions
  USING (tenant_id = current_user_tenant_id());
```

**Edge Function routing pattern**:
```typescript
const provider = await getPaymentProviderForBooking(bookingId)
switch (provider) {
  case 'paystack':    return await initiatePaystackPayment(params)
  case 'flutterwave': return await initiateFlutterwavePayment(params)
  case 'mtn_momo':    return await initiateMomoPayment(params)
  case 'mpesa_daraja': return await initiateMpesaStkPush(params)
  default: throw new Error(`Unsupported payment provider: ${provider}`)
}
```

---

## Event Deliverables Tracking

Use for platforms where a booking has a set of promised outputs (photos, video files, reports) that must be fulfilled before the booking is marked `completed`. Most applicable to event photography, videography, legal, and professional services.

```sql
CREATE TYPE deliverable_type AS ENUM (
  'photos', 'video_highlight', 'video_full', 'album', 'report', 'design_file', 'audio_recording'
);

CREATE TYPE deliverable_status AS ENUM (
  'pending', 'in_progress', 'delivered', 'disputed', 'waived'
);

-- Event packages with deliverables summary
CREATE TABLE event_packages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  name                 text NOT NULL,
  description          text,
  duration_hours       int NOT NULL DEFAULT 8,
  price_kobo           bigint NOT NULL,
  deliverables_summary jsonb NOT NULL DEFAULT '[]',
  -- e.g. [{"type":"photos","count":500},{"type":"video_highlight","duration_min":3}]
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_packages_tenant ON event_packages(tenant_id) WHERE is_active;

-- Deliverables per booking
CREATE TABLE deliverables (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  deliverable_type   deliverable_type NOT NULL,
  promised_count     int,              -- NULL for types without count (full video)
  promised_duration  interval,         -- NULL for photo-only deliverables
  delivered_count    int DEFAULT 0,
  status             deliverable_status NOT NULL DEFAULT 'pending',
  delivery_deadline  timestamptz NOT NULL,
  storage_paths      text[] DEFAULT '{}',
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deliverables_booking ON deliverables(booking_id, status);
CREATE INDEX idx_deliverables_deadline ON deliverables(delivery_deadline) WHERE status = 'pending';

-- Guard: prevent booking completion until all deliverables are delivered or waived
CREATE OR REPLACE FUNCTION check_deliverables_before_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_pending_count int;
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    SELECT COUNT(*) INTO v_pending_count
    FROM deliverables
    WHERE booking_id = NEW.id
      AND status NOT IN ('delivered', 'waived');

    IF v_pending_count > 0 THEN
      RAISE EXCEPTION
        'Cannot complete booking: % deliverable(s) are not yet delivered or waived',
        v_pending_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_deliverables_before_complete
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION check_deliverables_before_complete();

-- Portfolio items for creative staff profiles
CREATE TYPE portfolio_media_type AS ENUM ('photo', 'video', 'reel', 'audio');

CREATE TABLE portfolio_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  staff_id        uuid NOT NULL REFERENCES staff(id),
  media_type      portfolio_media_type NOT NULL,
  storage_path    text NOT NULL,      -- full-resolution (private bucket, signed URLs)
  thumbnail_path  text,               -- compressed thumbnail (public bucket, CDN)
  event_type      text,               -- 'wedding' | 'corporate' | 'birthday' | 'concert'
  taken_at        date,
  is_featured     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_staff ON portfolio_items(staff_id, is_featured);

ALTER TABLE event_packages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON event_packages
  USING (tenant_id = current_user_tenant_id());
CREATE POLICY "tenant_isolation" ON deliverables
  USING (tenant_id = current_user_tenant_id());
CREATE POLICY "tenant_isolation" ON portfolio_items
  USING (tenant_id = current_user_tenant_id());
```
