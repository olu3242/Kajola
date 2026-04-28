-- Supply Growth Engine: artisan onboarding, verification, referrals, profile completeness, quality gating

DO $$ BEGIN
  CREATE TYPE artisan_onboarding_status AS ENUM ('not_started','profile_created','services_added','verification_pending','verified','rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE artisan_verification_type AS ENUM ('phone', 'id', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE artisan_verification_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE referral_status AS ENUM ('pending', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE artisans
  ADD COLUMN IF NOT EXISTS onboarding_status artisan_onboarding_status NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS verification_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS profile_score NUMERIC(5,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS artisan_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  type artisan_verification_type NOT NULL,
  status artisan_verification_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS artisan_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  referred_artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  status referral_status NOT NULL DEFAULT 'pending',
  reward_earned BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(referrer_id, referred_artisan_id)
);

CREATE OR REPLACE FUNCTION calculate_profile_score(target_artisan_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  has_photo BOOLEAN;
  service_count INTEGER;
  portfolio_count INTEGER;
  window_count INTEGER;
  score NUMERIC := 0;
BEGIN
  SELECT COALESCE(profile_photo_url IS NOT NULL AND profile_photo_url <> '', false)
  INTO has_photo
  FROM artisans
  WHERE id = target_artisan_id;

  SELECT COUNT(*) INTO service_count FROM services WHERE artisan_id = target_artisan_id;
  SELECT COALESCE(JSONB_ARRAY_LENGTH(profile_media), 0) INTO portfolio_count FROM artisans WHERE id = target_artisan_id;
  SELECT COUNT(*) INTO window_count FROM availability_windows WHERE artisan_id = target_artisan_id;

  score := score + CASE WHEN has_photo THEN 25 ELSE 0 END;
  score := score + CASE WHEN service_count > 0 THEN 25 ELSE 0 END;
  score := score + CASE WHEN portfolio_count > 0 THEN 25 ELSE 0 END;
  score := score + CASE WHEN window_count > 0 THEN 25 ELSE 0 END;

  RETURN ROUND(LEAST(100, score), 2);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_artisan_profile_score()
RETURNS TRIGGER AS $$
DECLARE
  artisan_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'artisans' THEN
    NEW.profile_score =
      (CASE WHEN COALESCE(NEW.profile_photo_url, '') <> '' THEN 25 ELSE 0 END)
      + (CASE WHEN COALESCE(JSONB_ARRAY_LENGTH(NEW.profile_media), 0) > 0 THEN 25 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM services WHERE artisan_id = NEW.id) THEN 25 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM availability_windows WHERE artisan_id = NEW.id) THEN 25 ELSE 0 END);
    RETURN NEW;
  END IF;

  artisan_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.artisan_id
    ELSE NEW.artisan_id
  END;

  UPDATE artisans
  SET profile_score = calculate_profile_score(artisan_id), updated_at = NOW()
  WHERE id = artisan_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refresh_artisan_profile_score ON artisans;
CREATE TRIGGER refresh_artisan_profile_score
BEFORE INSERT OR UPDATE OF profile_photo_url, profile_media ON artisans
FOR EACH ROW EXECUTE FUNCTION update_artisan_profile_score();

DROP TRIGGER IF EXISTS refresh_artisan_profile_score_on_services ON services;
CREATE TRIGGER refresh_artisan_profile_score_on_services
AFTER INSERT OR UPDATE OR DELETE ON services
FOR EACH ROW EXECUTE FUNCTION update_artisan_profile_score();

DROP TRIGGER IF EXISTS refresh_artisan_profile_score_on_availability ON availability_windows;
CREATE TRIGGER refresh_artisan_profile_score_on_availability
AFTER INSERT OR UPDATE OR DELETE ON availability_windows
FOR EACH ROW EXECUTE FUNCTION update_artisan_profile_score();

CREATE OR REPLACE FUNCTION apply_referral_rewards()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE artisan_referrals
    SET status = 'completed', reward_earned = 5000, updated_at = NOW()
    WHERE referred_artisan_id = NEW.artisan_id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS apply_referral_rewards_on_booking ON bookings;
CREATE TRIGGER apply_referral_rewards_on_booking
AFTER UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION apply_referral_rewards();

ALTER TABLE artisan_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY artisan_verifications_tenant_isolation ON artisan_verifications FOR ALL USING (
  EXISTS (SELECT 1 FROM artisans WHERE artisans.id = artisan_verifications.artisan_id AND artisans.tenant_id = current_user_tenant_id())
);
CREATE POLICY artisan_verifications_super_admin_all ON artisan_verifications FOR ALL USING (has_role('super_admin'));

ALTER TABLE artisan_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY artisan_referrals_tenant_isolation ON artisan_referrals FOR ALL USING (
  EXISTS (SELECT 1 FROM artisans WHERE artisans.id = artisan_referrals.referrer_id AND artisans.tenant_id = current_user_tenant_id())
);
CREATE POLICY artisan_referrals_super_admin_all ON artisan_referrals FOR ALL USING (has_role('super_admin'));
