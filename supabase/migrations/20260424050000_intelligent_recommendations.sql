CREATE TYPE user_activity_event AS ENUM ('view','click','book','repeat');

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_categories TEXT[] NOT NULL DEFAULT '{}',
  avg_budget BIGINT,
  latitude NUMERIC(10,6),
  longitude NUMERIC(10,6),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artisan_id UUID NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
  event_type user_activity_event NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_cache (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  artisans JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, section)
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_created ON user_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_artisan_created ON user_activity(artisan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_event ON user_activity(event_type);
CREATE INDEX IF NOT EXISTS idx_recommendation_cache_expires ON recommendation_cache(expires_at);

CREATE OR REPLACE FUNCTION update_user_preferences_from_booking()
RETURNS TRIGGER AS $$
DECLARE
  service_category TEXT;
  avg_amount BIGINT;
  categories TEXT[];
BEGIN
  SELECT category INTO service_category FROM services WHERE id = NEW.service_id;
  SELECT COALESCE(AVG(total_amount), 0)::BIGINT INTO avg_amount
  FROM bookings
  WHERE user_id = NEW.user_id OR client_id = NEW.user_id;

  SELECT ARRAY(
    SELECT DISTINCT category
    FROM (
      SELECT services.category
      FROM bookings
      JOIN services ON services.id = bookings.service_id
      WHERE (bookings.user_id = NEW.user_id OR bookings.client_id = NEW.user_id)
        AND services.category IS NOT NULL
      ORDER BY bookings.created_at DESC
      LIMIT 10
    ) recent
  ) INTO categories;

  INSERT INTO user_preferences (user_id, preferred_categories, avg_budget, last_updated)
  VALUES (NEW.user_id, COALESCE(categories, ARRAY[]::TEXT[]), avg_amount, NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET preferred_categories = EXCLUDED.preferred_categories,
      avg_budget = EXCLUDED.avg_budget,
      last_updated = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_user_preferences_booking_trigger ON bookings;
CREATE TRIGGER update_user_preferences_booking_trigger
AFTER INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION update_user_preferences_from_booking();

CREATE OR REPLACE FUNCTION record_booking_activity()
RETURNS TRIGGER AS $$
DECLARE
  previous_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO previous_count
  FROM bookings
  WHERE (user_id = NEW.user_id OR client_id = NEW.user_id)
    AND artisan_id = NEW.artisan_id
    AND id <> NEW.id;

  INSERT INTO user_activity (user_id, artisan_id, event_type)
  VALUES (NEW.user_id, NEW.artisan_id, CASE WHEN previous_count > 0 THEN 'repeat'::user_activity_event ELSE 'book'::user_activity_event END);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS record_booking_activity_trigger ON bookings;
CREATE TRIGGER record_booking_activity_trigger
AFTER INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION record_booking_activity();

CREATE OR REPLACE FUNCTION score_recommended_artisans(target_user_id UUID, result_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  artisan_id UUID,
  recommendation_score NUMERIC,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH prefs AS (
    SELECT * FROM user_preferences WHERE user_id = target_user_id
  ),
  activity AS (
    SELECT
      ua.artisan_id,
      SUM(CASE ua.event_type WHEN 'view' THEN 5 WHEN 'click' THEN 8 WHEN 'book' THEN 22 WHEN 'repeat' THEN 35 ELSE 0 END)::NUMERIC AS affinity_score
    FROM user_activity ua
    WHERE ua.user_id = target_user_id
      AND ua.created_at > NOW() - INTERVAL '180 days'
    GROUP BY ua.artisan_id
  ),
  availability AS (
    SELECT bs.artisan_id, COUNT(*)::NUMERIC AS open_slots
    FROM booking_slots bs
    WHERE bs.status = 'available' AND bs.start_at > NOW()
    GROUP BY bs.artisan_id
  ),
  recent_bookings AS (
    SELECT b.artisan_id, COUNT(*)::NUMERIC AS recent_jobs
    FROM bookings b
    WHERE b.created_at > NOW() - INTERVAL '30 days'
    GROUP BY b.artisan_id
  )
  SELECT
    a.id,
    ROUND(
      COALESCE(s.trust_score, 0) * 0.42
      + LEAST(COALESCE(av.open_slots, 0) * 5, 20)
      + LEAST(COALESCE(act.affinity_score, 0), 35)
      + CASE WHEN a.category = ANY(COALESCE((SELECT preferred_categories FROM prefs), ARRAY[]::TEXT[])) THEN 12 ELSE 0 END
      + LEAST(COALESCE(rb.recent_jobs, 0) * 4, 20)
      + COALESCE(s.total_jobs, 0) * 0.12
    , 2) AS recommendation_score,
    CASE
      WHEN COALESCE(act.affinity_score, 0) >= 22 THEN 'Because you booked this artisan before'
      WHEN a.category = ANY(COALESCE((SELECT preferred_categories FROM prefs), ARRAY[]::TEXT[])) THEN 'Because you booked this category before'
      WHEN COALESCE(s.trust_score, 0) >= 75 THEN 'Highly rated near you'
      WHEN COALESCE(rb.recent_jobs, 0) > 0 THEN 'Popular right now'
      ELSE 'Recommended by quality and availability'
    END AS reason
  FROM artisans a
  LEFT JOIN artisan_stats s ON s.artisan_id = a.id
  LEFT JOIN activity act ON act.artisan_id = a.id
  LEFT JOIN availability av ON av.artisan_id = a.id
  LEFT JOIN recent_bookings rb ON rb.artisan_id = a.id
  ORDER BY
    CASE WHEN COALESCE(act.affinity_score, 0) >= 22 THEN 0 ELSE 1 END,
    recommendation_score DESC,
    COALESCE(s.trust_score, 0) DESC,
    COALESCE(s.total_jobs, 0) DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION score_popular_artisans(result_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  artisan_id UUID,
  recommendation_score NUMERIC,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH recent_bookings AS (
    SELECT b.artisan_id, COUNT(*)::NUMERIC AS recent_jobs
    FROM bookings b
    WHERE b.created_at > NOW() - INTERVAL '30 days'
    GROUP BY b.artisan_id
  )
  SELECT
    a.id,
    ROUND(COALESCE(rb.recent_jobs, 0) * 8 + COALESCE(s.trust_score, 0) * 0.55 + COALESCE(s.total_jobs, 0) * 0.2, 2),
    'Popular right now'
  FROM artisans a
  LEFT JOIN artisan_stats s ON s.artisan_id = a.id
  LEFT JOIN recent_bookings rb ON rb.artisan_id = a.id
  ORDER BY 2 DESC, COALESCE(s.trust_score, 0) DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_preferences_owner ON user_preferences FOR ALL USING (user_id = (auth.jwt() ->> 'sub')::UUID);
CREATE POLICY user_preferences_super_admin ON user_preferences FOR ALL USING (has_role('super_admin'));

ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_activity_owner_insert ON user_activity FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub')::UUID);
CREATE POLICY user_activity_owner_read ON user_activity FOR SELECT USING (user_id = (auth.jwt() ->> 'sub')::UUID);
CREATE POLICY user_activity_super_admin ON user_activity FOR ALL USING (has_role('super_admin'));

ALTER TABLE recommendation_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY recommendation_cache_owner ON recommendation_cache FOR ALL USING (user_id = (auth.jwt() ->> 'sub')::UUID);
CREATE POLICY recommendation_cache_super_admin ON recommendation_cache FOR ALL USING (has_role('super_admin'));
