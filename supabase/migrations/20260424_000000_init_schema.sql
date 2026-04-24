-- Kajola initial schema migration

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE user_role AS ENUM ('super_admin','tenant_admin','artisan','client');
CREATE TYPE tenant_type AS ENUM ('individual','business','cooperative');
CREATE TYPE booking_status AS ENUM ('pending','confirmed','in_progress','completed','cancelled','no_show');
CREATE TYPE payment_status AS ENUM ('pending','partial','paid','failed','refunded');
CREATE TYPE notification_channel AS ENUM ('sms','in_app','whatsapp','email');
CREATE TYPE slot_status AS ENUM ('available','held','booked','cancelled');
CREATE TYPE service_status AS ENUM ('draft','published','archived');

-- RLS helper functions
CREATE OR REPLACE FUNCTION current_user_tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() ->> 'tenant_id')::UUID;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION has_role(required_role TEXT)
RETURNS BOOLEAN AS $$
  SELECT (auth.jwt() ->> 'role') = required_role;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_system_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO system_events (tenant_id, event_type, payload, source, created_by)
  VALUES (
    NEW.tenant_id,
    TG_ARGV[0],
    row_to_json(NEW),
    TG_TABLE_NAME,
    COALESCE(auth.jwt() ->> 'sub', 'system')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type tenant_type NOT NULL DEFAULT 'business',
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  currency TEXT NOT NULL DEFAULT 'NGN',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_uid UUID NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'client',
  phone TEXT NOT NULL,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Artisans
CREATE TABLE artisans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  category TEXT NOT NULL,
  headline TEXT,
  description TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  latitude NUMERIC(10,6),
  longitude NUMERIC(10,6),
  address TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  rating NUMERIC(2,1) NOT NULL DEFAULT 0,
  reviews_count INTEGER NOT NULL DEFAULT 0,
  profile_media JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Services
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status service_status NOT NULL DEFAULT 'draft',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Availability windows
CREATE TABLE availability_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  slot_interval_minutes INTEGER NOT NULL CHECK (slot_interval_minutes > 0),
  max_bookings_per_slot INTEGER NOT NULL DEFAULT 1 CHECK (max_bookings_per_slot > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

-- Booking slots
CREATE TABLE booking_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  window_id UUID NOT NULL REFERENCES availability_windows(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status slot_status NOT NULL DEFAULT 'available',
  held_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at > start_at)
);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES booking_slots(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status booking_status NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reviews
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System events
CREATE TABLE system_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Automation rules
CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Automation runs
CREATE TABLE automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES system_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Triggers
CREATE TRIGGER set_updated_at_tenants
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_users
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_artisans
BEFORE UPDATE ON artisans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_services
BEFORE UPDATE ON services
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_windows
BEFORE UPDATE ON availability_windows
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_slots
BEFORE UPDATE ON booking_slots
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_bookings
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_payments
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_reviews
BEFORE UPDATE ON reviews
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_notifications
BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_automation_rules
BEFORE UPDATE ON automation_rules
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_automation_runs
BEFORE UPDATE ON automation_runs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER record_booking_created_event
AFTER INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION record_system_event('booking_created');

CREATE TRIGGER record_payment_created_event
AFTER INSERT ON payments
FOR EACH ROW EXECUTE FUNCTION record_system_event('payment_created');

-- Indexes
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_artisans_tenant_id ON artisans(tenant_id);
CREATE INDEX idx_artisans_user_id ON artisans(user_id);
CREATE INDEX idx_services_artisan_id ON services(artisan_id);
CREATE INDEX idx_services_tenant_id ON services(tenant_id);
CREATE INDEX idx_availability_windows_artisan_id ON availability_windows(artisan_id);
CREATE INDEX idx_booking_slots_artisan_id ON booking_slots(artisan_id);
CREATE INDEX idx_booking_slots_service_id ON booking_slots(service_id);
CREATE INDEX idx_booking_slots_status ON booking_slots(status);
CREATE INDEX idx_booking_slots_start_at ON booking_slots(start_at);
CREATE INDEX idx_bookings_client_id ON bookings(client_id);
CREATE INDEX idx_bookings_artisan_id ON bookings(artisan_id);
CREATE INDEX idx_bookings_slot_id ON bookings(slot_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_payments_booking_id ON payments(booking_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_reviews_artisan_id ON reviews(artisan_id);
CREATE INDEX idx_reviews_booking_id ON reviews(booking_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_channel ON notifications(channel);
CREATE INDEX idx_system_events_tenant_id ON system_events(tenant_id);
CREATE INDEX idx_system_events_event_type ON system_events(event_type);
CREATE INDEX idx_automation_rules_tenant_id ON automation_rules(tenant_id);
CREATE INDEX idx_automation_runs_status ON automation_runs(status);

-- RLS policies
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants FOR ALL USING (id = current_user_tenant_id());
CREATE POLICY super_admin_all ON tenants FOR ALL USING (has_role('super_admin')); 

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON users FOR ALL USING (has_role('super_admin'));

ALTER TABLE artisans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON artisans FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON artisans FOR ALL USING (has_role('super_admin'));

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON services FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON services FOR ALL USING (has_role('super_admin'));

ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON availability_windows FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON availability_windows FOR ALL USING (has_role('super_admin'));

ALTER TABLE booking_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON booking_slots FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON booking_slots FOR ALL USING (has_role('super_admin'));

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bookings FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON bookings FOR ALL USING (has_role('super_admin'));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON payments FOR ALL USING (has_role('super_admin'));

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reviews FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON reviews FOR ALL USING (has_role('super_admin'));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON notifications FOR ALL USING (has_role('super_admin'));

ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON system_events FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON system_events FOR ALL USING (has_role('super_admin'));

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_rules FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON automation_rules FOR ALL USING (has_role('super_admin'));

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_runs FOR ALL USING (tenant_id = current_user_tenant_id());
CREATE POLICY super_admin_all ON automation_runs FOR ALL USING (has_role('super_admin'));
