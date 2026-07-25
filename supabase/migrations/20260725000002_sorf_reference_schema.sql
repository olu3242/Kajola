-- SORF Reference Schema — Kajola Baseline
-- Establishes the canonical SORF booking tables that every generated platform
-- must include. Platform-specific tables layer on top of this foundation.
-- Requires: btree_gist, postgis, pg_cron extensions.

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ── Enums ─────────────────────────────────────────────────────────────────────

-- SORF 9-state booking lifecycle (state machine enforced via allowed transitions in Edge Function)
CREATE TYPE booking_status AS ENUM (
  'pending',      -- slot selected but not yet held
  'confirmed',    -- deposit paid, slot secured
  'held',         -- optimistic 15-min lock before payment
  'checked_in',   -- customer arrived; staff acknowledged
  'in_progress',  -- service actively underway
  'completed',    -- service done; payout queued
  'cancelled',    -- cancelled before service; refund evaluated
  'no_show',      -- customer did not appear; no-show policy applied
  'disputed'      -- payout frozen pending manager review
);

CREATE TYPE payment_status AS ENUM ('pending', 'partial', 'paid', 'failed', 'refunded');

CREATE TYPE loyalty_tier AS ENUM ('bronze', 'silver', 'gold', 'platinum');

CREATE TYPE waitlist_status AS ENUM ('waiting', 'notified', 'booked', 'expired');

-- ── Helper functions ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_user_tenant_id()
RETURNS uuid AS $$
  SELECT (auth.jwt() ->> 'tenant_id')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
  SELECT (auth.jwt() ->> 'role') = 'super_admin';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Core tables ───────────────────────────────────────────────────────────────

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  currency    text NOT NULL DEFAULT 'NGN',
  timezone    text NOT NULL DEFAULT 'Africa/Lagos',
  settings    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  role          text NOT NULL DEFAULT 'customer' CHECK (role IN ('super_admin','franchise_owner','business_manager','branch_manager','staff','customer')),
  push_token    text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_users_tenant_phone ON users (tenant_id, phone);

CREATE TABLE customer_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  no_show_count   int NOT NULL DEFAULT 0,
  require_prepayment boolean NOT NULL DEFAULT false,
  preferred_locale text NOT NULL DEFAULT 'en-NG',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE TRIGGER trg_customer_profiles_updated_at BEFORE UPDATE ON customer_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_customer_profiles_tenant ON customer_profiles (tenant_id);

-- ── Business hierarchy: Business → Branch → Staff ─────────────────────────────

CREATE TABLE businesses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  category              text NOT NULL,
  -- SORF policy shapes (jsonb) — enforced in Payments Engine
  deposit_policy        jsonb NOT NULL DEFAULT '{"type":"percentage","value":30}',
  cancellation_policy   jsonb NOT NULL DEFAULT '{"hours_notice":24,"fee_pct":0}',
  no_show_policy        jsonb NOT NULL DEFAULT '{"max_no_shows":3,"require_prepayment":true}',
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_businesses_tenant ON businesses (tenant_id);

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  address     text NOT NULL,
  location    geography(POINT, 4326),
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_branches_tenant ON branches (tenant_id);
CREATE INDEX idx_branches_business ON branches (business_id);
CREATE INDEX idx_branches_location ON branches USING gist (location);

CREATE TABLE franchise_owners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  revenue_share_pct numeric(5,2) NOT NULL DEFAULT 3.00,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, business_id)
);
CREATE TRIGGER trg_franchise_owners_updated_at BEFORE UPDATE ON franchise_owners FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id),
  full_name   text NOT NULL,
  speciality  text,
  rating      numeric(3,2) NOT NULL DEFAULT 5.00 CHECK (rating BETWEEN 0 AND 5),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_staff_branch ON staff (branch_id);
CREATE INDEX idx_staff_tenant ON staff (tenant_id);

CREATE TABLE services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id      uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  duration_minutes int NOT NULL CHECK (duration_minutes > 0),
  price_kobo       bigint NOT NULL CHECK (price_kobo >= 0),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_services_business ON services (business_id);
CREATE INDEX idx_services_tenant ON services (tenant_id);

-- ── Staff availability ────────────────────────────────────────────────────────

-- Recurring weekly schedule — never compute availability in application code
CREATE TABLE availability_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_availability_windows_updated_at BEFORE UPDATE ON availability_windows FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_availability_windows_staff ON availability_windows (staff_id, day_of_week);

-- One-off overrides (blocks or extra openings) for specific dates
CREATE TABLE availability_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id      uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date          date NOT NULL,
  is_available  boolean NOT NULL,               -- false = blocked; true = extra opening
  start_time    time,                            -- null = whole day
  end_time      time,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_availability_overrides_updated_at BEFORE UPDATE ON availability_overrides FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_availability_overrides_staff_date ON availability_overrides (staff_id, date);

-- ── Bookings — SORF lifecycle core ───────────────────────────────────────────

CREATE TABLE bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id           uuid NOT NULL REFERENCES branches(id),
  staff_id            uuid NOT NULL REFERENCES staff(id),
  service_id          uuid NOT NULL REFERENCES services(id),
  customer_id         uuid NOT NULL REFERENCES users(id),
  status              booking_status NOT NULL DEFAULT 'pending',
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  held_until          timestamptz,               -- set on status='held'; cleared on confirm/cancel
  deposit_paid        boolean NOT NULL DEFAULT false,
  deposit_amount_kobo bigint,
  total_amount_kobo   bigint NOT NULL,
  recurrence_rule     text,                      -- RRULE string for recurring bookings
  no_show_probability numeric(4,3),              -- AI-computed 0–1 score
  notes               text,
  checked_in_at       timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- SORF slot conflict prevention: one booking per (staff, branch) per time slot
  EXCLUDE USING gist (
    staff_id  WITH =,
    branch_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'))
);
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_bookings_staff_time ON bookings (staff_id, starts_at, ends_at);
CREATE INDEX idx_bookings_customer ON bookings (customer_id);
CREATE INDEX idx_bookings_tenant_status ON bookings (tenant_id, status);
CREATE INDEX idx_bookings_branch ON bookings (branch_id);
CREATE INDEX idx_bookings_held_until ON bookings (held_until) WHERE status = 'held';

-- ── Waitlist ──────────────────────────────────────────────────────────────────

CREATE TABLE waitlist_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES branches(id),
  service_id    uuid NOT NULL REFERENCES services(id),
  staff_id      uuid REFERENCES staff(id),       -- null = any available staff
  customer_id   uuid NOT NULL REFERENCES users(id),
  preferred_date date,
  preferred_time_start time,
  preferred_time_end   time,
  status        waitlist_status NOT NULL DEFAULT 'waiting',
  notified_at   timestamptz,
  expires_at    timestamptz,                     -- 15-min acceptance window
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_waitlist_entries_updated_at BEFORE UPDATE ON waitlist_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_waitlist_entries_branch_service ON waitlist_entries (branch_id, service_id) WHERE status = 'waiting';
CREATE INDEX idx_waitlist_entries_customer ON waitlist_entries (customer_id);

-- Notify next waitlist entry when a booking is cancelled or no_show
CREATE OR REPLACE FUNCTION notify_waitlist_on_cancellation()
RETURNS trigger AS $$
BEGIN
  IF (NEW.status IN ('cancelled', 'no_show') AND OLD.status NOT IN ('cancelled', 'no_show')) THEN
    INSERT INTO automation_jobs (job_type, payload, idempotency_key)
    VALUES (
      'waitlist.notify',
      jsonb_build_object(
        'branch_id',  NEW.branch_id,
        'service_id', NEW.service_id,
        'staff_id',   NEW.staff_id,
        'starts_at',  NEW.starts_at
      ),
      'waitlist-notify-' || NEW.branch_id || '-' || NEW.service_id || '-' || NEW.starts_at
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bookings_notify_waitlist
  AFTER UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION notify_waitlist_on_cancellation();

-- ── Loyalty & Membership ──────────────────────────────────────────────────────

CREATE TABLE loyalty_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points_balance int NOT NULL DEFAULT 0,
  tier           loyalty_tier NOT NULL DEFAULT 'bronze',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id)
);
CREATE TRIGGER trg_loyalty_accounts_updated_at BEFORE UPDATE ON loyalty_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE loyalty_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loyalty_account_id uuid NOT NULL REFERENCES loyalty_accounts(id),
  booking_id        uuid REFERENCES bookings(id),
  points_delta      int NOT NULL,                -- positive = earn; negative = redeem
  reason            text NOT NULL,
  idempotency_key   text NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_loyalty_transactions_account ON loyalty_transactions (loyalty_account_id);

-- ── Payments ──────────────────────────────────────────────────────────────────

CREATE TABLE payment_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id        uuid REFERENCES bookings(id),
  customer_id       uuid NOT NULL REFERENCES users(id),
  provider          text NOT NULL CHECK (provider IN ('paystack','flutterwave','mpesa_stk','mpesa_b2c','mtn_momo','orange_money','cash')),
  provider_ref      text,                         -- provider transaction ID
  amount_kobo       bigint NOT NULL,
  currency          text NOT NULL DEFAULT 'NGN',
  status            payment_status NOT NULL DEFAULT 'pending',
  idempotency_key   text NOT NULL UNIQUE,
  raw_payload       jsonb,                        -- full provider webhook payload
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_payment_transactions_updated_at BEFORE UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_payment_transactions_booking ON payment_transactions (booking_id);
CREATE INDEX idx_payment_transactions_provider_ref ON payment_transactions (provider, provider_ref);

CREATE TABLE wallets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id        uuid REFERENCES staff(id),
  business_id     uuid REFERENCES businesses(id),
  balance_kobo    bigint NOT NULL DEFAULT 0 CHECK (balance_kobo >= 0),
  currency        text NOT NULL DEFAULT 'NGN',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE wallet_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wallet_id       uuid NOT NULL REFERENCES wallets(id),
  booking_id      uuid REFERENCES bookings(id),
  delta_kobo      bigint NOT NULL,               -- positive = credit; negative = debit
  balance_after   bigint NOT NULL,
  description     text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_transactions_wallet ON wallet_transactions (wallet_id);

-- ── Automation ────────────────────────────────────────────────────────────────

CREATE TABLE automation_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','dead')),
  idempotency_key text UNIQUE,
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 3,
  next_run_at     timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_automation_jobs_updated_at BEFORE UPDATE ON automation_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_automation_jobs_pending ON automation_jobs (next_run_at) WHERE status = 'pending';

CREATE TABLE webhook_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  event_type  text,
  raw_payload jsonb NOT NULL,
  processed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_logs_unprocessed ON webhook_logs (created_at) WHERE processed = false;

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id),
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_tenant ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_record ON audit_logs (table_name, record_id);

CREATE TABLE phone_otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  otp_hash    text NOT NULL,
  expires_at  timestamptz NOT NULL,
  verified    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_phone_otps_phone ON phone_otps (phone, expires_at) WHERE verified = false;

CREATE TABLE sms_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id),
  recipient   text NOT NULL,
  provider    text NOT NULL,
  template_id text,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'queued',
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_logs_tenant ON sms_logs (tenant_id, created_at DESC);

-- ── Branch KPIs materialised view (multi-branch / franchise platforms) ─────────

CREATE MATERIALIZED VIEW branch_kpis AS
SELECT
  b.id                                                           AS branch_id,
  b.tenant_id,
  b.business_id,
  b.name                                                         AS branch_name,
  count(bk.id)                                                   AS total_bookings,
  count(bk.id) FILTER (WHERE bk.status = 'completed')           AS completed_bookings,
  count(bk.id) FILTER (WHERE bk.status = 'no_show')             AS no_show_bookings,
  round(
    count(bk.id) FILTER (WHERE bk.status = 'completed')::numeric
    / NULLIF(count(bk.id) FILTER (WHERE bk.status IN ('completed','no_show')), 0),
    4
  )                                                              AS completion_rate,
  coalesce(sum(pt.amount_kobo) FILTER (WHERE pt.status = 'paid'), 0) AS gmv_kobo,
  max(bk.created_at)                                             AS last_booking_at
FROM branches b
LEFT JOIN bookings   bk ON bk.branch_id = b.id AND bk.created_at >= now() - interval '30 days'
LEFT JOIN payment_transactions pt ON pt.booking_id = bk.id
GROUP BY b.id, b.tenant_id, b.business_id, b.name
WITH DATA;

CREATE UNIQUE INDEX idx_branch_kpis_branch ON branch_kpis (branch_id);
CREATE INDEX idx_branch_kpis_tenant ON branch_kpis (tenant_id);

-- Refresh every 15 minutes (requires pg_cron)
SELECT cron.schedule('refresh-branch-kpis', '*/15 * * * *', $$REFRESH MATERIALIZED VIEW CONCURRENTLY branch_kpis$$);

-- ── Slot hold expiry (pg_cron) ────────────────────────────────────────────────

-- Release held slots that expired without payment
SELECT cron.schedule('expire-held-bookings', '*/5 * * * *', $$
  UPDATE bookings
  SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'hold_expired'
  WHERE status = 'held' AND held_until < now()
$$);

-- ── RLS policies ──────────────────────────────────────────────────────────────

ALTER TABLE tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_owners    ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff               ENABLE ROW LEVEL SECURITY;
ALTER TABLE services            ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_windows   ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_otps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs            ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped policies (super_admin bypasses via is_super_admin())
CREATE POLICY "tenant_isolation" ON tenants
  USING (id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON users
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON customer_profiles
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON businesses
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON branches
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON franchise_owners
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON staff
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON services
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON availability_windows
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON availability_overrides
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON bookings
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON waitlist_entries
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON loyalty_accounts
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON loyalty_transactions
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON payment_transactions
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON wallets
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "tenant_isolation" ON wallet_transactions
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

CREATE POLICY "service_role_only" ON automation_jobs
  USING (is_super_admin());

CREATE POLICY "service_role_only" ON webhook_logs
  USING (is_super_admin());

CREATE POLICY "tenant_isolation" ON audit_logs
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());

-- OTPs: anonymous can insert; own records only can select
CREATE POLICY "otp_insert" ON phone_otps FOR INSERT WITH CHECK (true);
CREATE POLICY "otp_select" ON phone_otps FOR SELECT USING (phone = (SELECT phone FROM users WHERE id = auth.uid()));

CREATE POLICY "tenant_isolation" ON sms_logs
  USING (tenant_id = current_user_tenant_id() OR is_super_admin());
