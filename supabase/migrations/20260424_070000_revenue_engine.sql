-- Revenue Engine: transaction fees, featured listings, subscriptions, promotions, analytics, and ranking boosts

DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM ('free','pro','elite');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE tenants
  ALTER COLUMN subscription_tier TYPE subscription_tier
  USING (
    CASE
      WHEN subscription_tier::text IN ('free','pro','elite') THEN subscription_tier::text::subscription_tier
      ELSE 'free'::subscription_tier
    END
  );

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS platform_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMPTZ;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS platform_fee_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_code TEXT;

DO $$ BEGIN
  CREATE TYPE billing_transaction_type AS ENUM ('booking','subscription','featured_listing','referral_bonus');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE billing_transaction_status AS ENUM ('pending','completed','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE featured_listing_type AS ENUM ('boost','top_placement');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE featured_listing_status AS ENUM ('active','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS featured_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  type featured_listing_type NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  status featured_listing_status NOT NULL DEFAULT 'active',
  purchase_reference TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  artisan_id UUID REFERENCES artisans(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  featured_listing_id UUID REFERENCES featured_listings(id) ON DELETE SET NULL,
  type billing_transaction_type NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  platform_fee_cents BIGINT NOT NULL DEFAULT 0,
  net_amount_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  discount_code TEXT,
  provider TEXT,
  reference TEXT NOT NULL,
  status billing_transaction_status NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  percent_off NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (percent_off >= 0 AND percent_off <= 100),
  max_uses INTEGER NOT NULL DEFAULT 0 CHECK (max_uses >= 0),
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artisan_analytics (
  artisan_id UUID PRIMARY KEY REFERENCES artisans(id) ON DELETE CASCADE,
  views BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  bookings BIGINT NOT NULL DEFAULT 0,
  conversion_rate NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN views = 0 THEN 0 ELSE ROUND((bookings::NUMERIC / views::NUMERIC) * 100, 2) END
  ) STORED,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION calculate_platform_fee(amount_cents BIGINT, percent NUMERIC)
RETURNS BIGINT AS $$
BEGIN
  RETURN GREATEST(0, ROUND(amount_cents * COALESCE(percent, 0) / 100.0));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION calculate_discount_amount(total_cents BIGINT, code TEXT, target_tenant_id UUID)
RETURNS BIGINT AS $$
DECLARE
  discount_row RECORD;
  discount BIGINT := 0;
BEGIN
  IF code IS NULL OR code = '' THEN
    RETURN 0;
  END IF;
  SELECT * INTO discount_row
  FROM discount_codes
  WHERE tenant_id = target_tenant_id
    AND LOWER(discount_codes.code) = LOWER(code)
    AND active
    AND starts_at <= NOW()
    AND ends_at >= NOW()
    AND (max_uses = 0 OR used_count < max_uses)
  LIMIT 1;

  IF discount_row IS NULL THEN
    RETURN 0;
  END IF;

  discount := GREATEST(0, discount_row.amount_cents);
  IF discount_row.percent_off > 0 THEN
    discount := GREATEST(0, ROUND(total_cents * discount_row.percent_off / 100.0));
  END IF;

  RETURN LEAST(discount, total_cents);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_artisan_analytics_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO artisan_analytics (artisan_id, views, clicks, bookings, last_updated)
  VALUES (
    NEW.artisan_id,
    CASE WHEN NEW.event_type = 'view' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'click' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type IN ('book','repeat') THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (artisan_id) DO UPDATE
  SET
    views = artisan_analytics.views + CASE WHEN NEW.event_type = 'view' THEN 1 ELSE 0 END,
    clicks = artisan_analytics.clicks + CASE WHEN NEW.event_type = 'click' THEN 1 ELSE 0 END,
    bookings = artisan_analytics.bookings + CASE WHEN NEW.event_type IN ('book','repeat') THEN 1 ELSE 0 END,
    last_updated = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS record_artisan_analytics_event_trigger ON user_activity;
CREATE TRIGGER record_artisan_analytics_event_trigger
AFTER INSERT ON user_activity
FOR EACH ROW EXECUTE FUNCTION record_artisan_analytics_event();

ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY discount_codes_tenant_read ON discount_codes FOR SELECT USING (tenant_id = current_user_tenant_id());
CREATE POLICY discount_codes_tenant_insert ON discount_codes FOR INSERT WITH CHECK (tenant_id = current_user_tenant_id());
CREATE POLICY discount_codes_tenant_update ON discount_codes FOR UPDATE USING (tenant_id = current_user_tenant_id()) WITH CHECK (tenant_id = current_user_tenant_id());
CREATE POLICY discount_codes_super_admin ON discount_codes FOR ALL USING (has_role('super_admin'));

ALTER TABLE featured_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY featured_listings_tenant_read ON featured_listings FOR SELECT USING (tenant_id = current_user_tenant_id());
CREATE POLICY featured_listings_tenant_insert ON featured_listings FOR INSERT WITH CHECK (tenant_id = current_user_tenant_id());
CREATE POLICY featured_listings_tenant_update ON featured_listings FOR UPDATE USING (tenant_id = current_user_tenant_id()) WITH CHECK (tenant_id = current_user_tenant_id());
CREATE POLICY featured_listings_super_admin ON featured_listings FOR ALL USING (has_role('super_admin'));

ALTER TABLE billing_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_transactions_tenant_read ON billing_transactions FOR SELECT USING (tenant_id = current_user_tenant_id());
CREATE POLICY billing_transactions_tenant_insert ON billing_transactions FOR INSERT WITH CHECK (tenant_id = current_user_tenant_id());
CREATE POLICY billing_transactions_tenant_update ON billing_transactions FOR UPDATE USING (tenant_id = current_user_tenant_id()) WITH CHECK (tenant_id = current_user_tenant_id());
CREATE POLICY billing_transactions_super_admin ON billing_transactions FOR ALL USING (has_role('super_admin'));

ALTER TABLE artisan_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY artisan_analytics_public_read ON artisan_analytics FOR SELECT USING (true);
CREATE POLICY artisan_analytics_super_admin ON artisan_analytics FOR ALL USING (has_role('super_admin'));
