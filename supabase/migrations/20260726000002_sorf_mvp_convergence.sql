-- SORF MVP Convergence — additive upgrade to the init_schema baseline
-- Extends existing types/tables and creates the SORF business hierarchy.
-- Safe to run after all prior migrations; uses IF NOT EXISTS / ADD VALUE everywhere.

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ── Extend booking_status enum (ADD VALUE is idempotent in intent; wrap in DO) ─
DO $$ BEGIN
  ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'held'       BEFORE 'cancelled';
  ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'checked_in' BEFORE 'cancelled';
  ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'disputed'   AFTER  'no_show';
  ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'awaiting_payment' BEFORE 'confirmed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── New standalone enums ───────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE loyalty_tier AS ENUM ('bronze', 'silver', 'gold', 'platinum');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE waitlist_status AS ENUM ('waiting', 'notified', 'booked', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Extend tenants ────────────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone         text NOT NULL DEFAULT 'Africa/Lagos',
  ADD COLUMN IF NOT EXISTS platform_fee_pct numeric(5,2) NOT NULL DEFAULT 8.50,
  ADD COLUMN IF NOT EXISTS deposit_policy   jsonb NOT NULL DEFAULT '{"type":"percentage","value":30}'::jsonb,
  ADD COLUMN IF NOT EXISTS cancel_policy    jsonb NOT NULL DEFAULT '{"hours_notice":24,"fee_pct":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS no_show_policy   jsonb NOT NULL DEFAULT '{"max_no_shows":3,"require_prepayment":true}'::jsonb;

-- ── Extend users ──────────────────────────────────────────────────────────────
-- Allow 'staff'/'business_manager'/'branch_manager'/'franchise_owner' roles
-- The existing CHECK on user_role enum won't allow free text. We keep using
-- the enum but extend with a text override column for SORF roles.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sorf_role text CHECK (sorf_role IN (
    'super_admin','franchise_owner','business_manager',
    'branch_manager','staff','customer'));

-- ── Extend bookings with SORF columns ────────────────────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS held_until          timestamptz,
  ADD COLUMN IF NOT EXISTS total_amount_kobo   bigint,
  ADD COLUMN IF NOT EXISTS deposit_amount_kobo bigint,
  ADD COLUMN IF NOT EXISTS deposit_paid        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at       timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key     uuid UNIQUE;

-- SORF slot conflict prevention (requires btree_gist)
-- Only add if the constraint doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap_idx'
  ) THEN
    EXECUTE 'CREATE INDEX bookings_no_overlap_idx ON bookings
      USING gist (artisan_id,
        tstzrange(COALESCE(starts_at, requested_at),
                  COALESCE(ends_at, requested_at + interval ''1 hour''), ''[)''))
      WHERE status NOT IN (''cancelled'', ''no_show'')';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_held_until ON bookings (held_until) WHERE status = 'held';

-- ── Extend services ───────────────────────────────────────────────────────────
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS price_kobo   bigint GENERATED ALWAYS AS (price_cents) STORED,
  ADD COLUMN IF NOT EXISTS is_active    boolean NOT NULL DEFAULT true;

-- ── New SORF tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name          text NOT NULL,
  loyalty_points     integer NOT NULL DEFAULT 0,
  loyalty_tier       loyalty_tier NOT NULL DEFAULT 'bronze',
  no_show_count      integer NOT NULL DEFAULT 0,
  require_prepayment boolean NOT NULL DEFAULT false,
  preferred_locale   text NOT NULL DEFAULT 'en-NG',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers see own profile"
  ON customer_profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "tenant isolation" ON customer_profiles FOR ALL
  USING (tenant_id = current_user_tenant_id());

CREATE TABLE IF NOT EXISTS businesses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL,
  category            text NOT NULL,
  description         text,
  logo_url            text,
  deposit_policy      jsonb NOT NULL DEFAULT '{"type":"percentage","value":30}'::jsonb,
  cancellation_policy jsonb NOT NULL DEFAULT '{"hours_notice":24,"fee_pct":0}'::jsonb,
  no_show_policy      jsonb NOT NULL DEFAULT '{"max_no_shows":3,"require_prepayment":true}'::jsonb,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant isolation" ON businesses FOR ALL USING (tenant_id = current_user_tenant_id());

CREATE TABLE IF NOT EXISTS branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  address     text NOT NULL,
  city        text NOT NULL DEFAULT 'Lagos',
  state       text NOT NULL DEFAULT 'Lagos State',
  location    geography(POINT, 4326),
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant isolation" ON branches FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY "public read active branches"
  ON branches FOR SELECT USING (is_active = true);
CREATE INDEX IF NOT EXISTS idx_branches_tenant    ON branches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_branches_business  ON branches(business_id);
CREATE INDEX IF NOT EXISTS idx_branches_location  ON branches USING gist(location);

CREATE TABLE IF NOT EXISTS staff_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id),
  full_name   text NOT NULL,
  speciality  text,
  bio         text,
  avatar_url  text,
  rating      numeric(3,2) NOT NULL DEFAULT 5.00 CHECK (rating BETWEEN 0 AND 5),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant isolation" ON staff_members FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY "public read active staff"
  ON staff_members FOR SELECT USING (is_active = true);
CREATE INDEX IF NOT EXISTS idx_staff_members_branch  ON staff_members(branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_tenant  ON staff_members(tenant_id);

-- Staff recurring availability
CREATE TABLE IF NOT EXISTS staff_availability_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, day_of_week, start_time)
);
ALTER TABLE staff_availability_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant isolation" ON staff_availability_windows FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_saw_staff ON staff_availability_windows(staff_id, day_of_week);

-- Date-specific overrides
CREATE TABLE IF NOT EXISTS staff_availability_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id     uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  override_date date NOT NULL,
  is_available  boolean NOT NULL DEFAULT false,
  start_time    time,
  end_time      time,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, override_date)
);
ALTER TABLE staff_availability_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant isolation" ON staff_availability_overrides FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_sao_staff_date ON staff_availability_overrides(staff_id, override_date);

-- Waitlist
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id            uuid NOT NULL REFERENCES branches(id),
  service_id           uuid NOT NULL REFERENCES services(id),
  staff_id             uuid REFERENCES staff_members(id),
  customer_id          uuid NOT NULL REFERENCES users(id),
  preferred_date       date,
  preferred_time_start time,
  preferred_time_end   time,
  status               waitlist_status NOT NULL DEFAULT 'waiting',
  notified_at          timestamptz,
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers see own waitlist" ON waitlist_entries FOR SELECT
  USING (customer_id = auth.uid());
CREATE POLICY "tenant isolation" ON waitlist_entries FOR ALL
  USING (tenant_id = current_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_waitlist_branch_service ON waitlist_entries(branch_id, service_id)
  WHERE status = 'waiting';

-- Gratuities (tips — 100% to staff, never platform fee)
CREATE TABLE IF NOT EXISTS gratuities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id            uuid NOT NULL REFERENCES bookings(id) UNIQUE,
  customer_id           uuid NOT NULL REFERENCES users(id),
  artisan_id            uuid NOT NULL REFERENCES artisans(id),
  amount_kobo           bigint NOT NULL CHECK (amount_kobo > 0),
  message               text,
  paystack_transfer_code text,
  transferred_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gratuities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers insert own gratuities"
  ON gratuities FOR INSERT WITH CHECK (customer_id = auth.uid());
CREATE POLICY "customers see own gratuities"
  ON gratuities FOR SELECT USING (customer_id = auth.uid());
CREATE POLICY "artisans see received gratuities"
  ON gratuities FOR SELECT
  USING (artisan_id IN (SELECT id FROM artisans WHERE user_id = auth.uid()));

-- Idempotency keys (prevent duplicate operations)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        text PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  response   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages idempotency"
  ON idempotency_keys FOR ALL USING (true);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- Audit log (append-only)
CREATE TABLE IF NOT EXISTS audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  actor_id     text,                               -- auth.uid() or 'system'
  actor_role   text,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  action       text NOT NULL,
  before_state jsonb,
  after_state  jsonb NOT NULL DEFAULT '{}',
  ip_address   inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role inserts audit logs"
  ON audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "admins read audit logs"
  ON audit_logs FOR SELECT
  USING (has_role('super_admin'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity    ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant    ON audit_logs(tenant_id, created_at DESC);

-- ── Helper: release stale holds ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_stale_holds() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE released integer;
BEGIN
  UPDATE bookings
  SET status = 'cancelled', cancellation_reason = 'hold_expired', updated_at = now()
  WHERE status = 'held' AND held_until < now();
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;

-- ── Seed: Kajola platform tenant ──────────────────────────────────────────────
INSERT INTO tenants (id, name, slug, currency, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Kajola Lagos',
  'kajola-lagos',
  'NGN',
  'Africa/Lagos'
) ON CONFLICT (slug) DO NOTHING;
