ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT;

UPDATE reviews SET user_id = COALESCE(user_id, client_id);

ALTER TABLE reviews
  ALTER COLUMN user_id SET NOT NULL,
  ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_booking ON reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_artisan_created ON reviews(artisan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);

CREATE TABLE IF NOT EXISTS review_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(review_id, tag)
);

CREATE TABLE IF NOT EXISTS artisan_stats (
  artisan_id UUID PRIMARY KEY REFERENCES artisans(id) ON DELETE CASCADE,
  total_jobs INTEGER NOT NULL DEFAULT 0,
  completed_jobs INTEGER NOT NULL DEFAULT 0,
  cancelled_jobs INTEGER NOT NULL DEFAULT 0,
  avg_rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  response_time_avg INTEGER NOT NULL DEFAULT 0,
  trust_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION calculate_trust_score(
  avg_rating NUMERIC,
  completed_jobs INTEGER,
  total_jobs INTEGER,
  response_time_avg INTEGER,
  recent_avg_rating NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
  rating_score NUMERIC;
  completion_score NUMERIC;
  consistency_score NUMERIC;
  response_score NUMERIC;
BEGIN
  rating_score := LEAST(100, GREATEST(0, COALESCE(avg_rating, 0) * 20)) * 0.4;
  completion_score := CASE WHEN total_jobs > 0 THEN LEAST(100, GREATEST(0, (completed_jobs::NUMERIC / total_jobs::NUMERIC) * 100)) ELSE 0 END * 0.3;
  consistency_score := LEAST(100, GREATEST(0, COALESCE(recent_avg_rating, avg_rating, 0) * 20)) * 0.2;
  response_score := CASE
    WHEN COALESCE(response_time_avg, 0) <= 0 THEN 50
    WHEN response_time_avg <= 15 THEN 100
    WHEN response_time_avg <= 60 THEN 80
    WHEN response_time_avg <= 240 THEN 55
    ELSE 25
  END * 0.1;

  RETURN ROUND(LEAST(100, rating_score + completion_score + consistency_score + response_score), 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION update_artisan_stats(target_artisan_id UUID)
RETURNS artisan_stats AS $$
DECLARE
  stats artisan_stats;
  total_count INTEGER;
  completed_count INTEGER;
  cancelled_count INTEGER;
  rating_avg NUMERIC;
  review_count INTEGER;
  recent_avg NUMERIC;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('completed','confirmed','in_progress')),
         COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO total_count, completed_count, cancelled_count
  FROM bookings
  WHERE artisan_id = target_artisan_id;

  SELECT COALESCE(AVG(rating), 0), COUNT(*)
  INTO rating_avg, review_count
  FROM reviews
  WHERE artisan_id = target_artisan_id AND flagged_at IS NULL;

  SELECT COALESCE(AVG(rating), rating_avg)
  INTO recent_avg
  FROM (
    SELECT rating
    FROM reviews
    WHERE artisan_id = target_artisan_id AND flagged_at IS NULL
    ORDER BY created_at DESC
    LIMIT 10
  ) recent_reviews;

  INSERT INTO artisan_stats (
    artisan_id,
    total_jobs,
    completed_jobs,
    cancelled_jobs,
    avg_rating,
    total_reviews,
    trust_score,
    last_updated
  )
  VALUES (
    target_artisan_id,
    total_count,
    completed_count,
    cancelled_count,
    ROUND(rating_avg, 2),
    review_count,
    calculate_trust_score(rating_avg, completed_count, total_count, 0, recent_avg),
    NOW()
  )
  ON CONFLICT (artisan_id) DO UPDATE
  SET total_jobs = EXCLUDED.total_jobs,
      completed_jobs = EXCLUDED.completed_jobs,
      cancelled_jobs = EXCLUDED.cancelled_jobs,
      avg_rating = EXCLUDED.avg_rating,
      total_reviews = EXCLUDED.total_reviews,
      trust_score = calculate_trust_score(EXCLUDED.avg_rating, EXCLUDED.completed_jobs, EXCLUDED.total_jobs, artisan_stats.response_time_avg, recent_avg),
      last_updated = NOW()
  RETURNING * INTO stats;

  RETURN stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION refresh_artisan_stats_from_booking()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_artisan_stats(COALESCE(NEW.artisan_id, OLD.artisan_id));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS refresh_artisan_stats_on_booking ON bookings;
CREATE TRIGGER refresh_artisan_stats_on_booking
AFTER INSERT OR UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION refresh_artisan_stats_from_booking();

CREATE OR REPLACE FUNCTION refresh_artisan_stats_from_review()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_artisan_stats(COALESCE(NEW.artisan_id, OLD.artisan_id));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS refresh_artisan_stats_on_review ON reviews;
CREATE TRIGGER refresh_artisan_stats_on_review
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION refresh_artisan_stats_from_review();

CREATE OR REPLACE FUNCTION assert_review_allowed()
RETURNS TRIGGER AS $$
DECLARE
  booking_record bookings;
BEGIN
  SELECT * INTO booking_record FROM bookings WHERE id = NEW.booking_id;
  IF booking_record.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  IF booking_record.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed bookings can be reviewed';
  END IF;
  IF booking_record.client_id <> NEW.user_id AND booking_record.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'Only the booking owner can review';
  END IF;
  IF booking_record.artisan_id <> NEW.artisan_id THEN
    RAISE EXCEPTION 'Review artisan does not match booking';
  END IF;
  NEW.client_id := NEW.user_id;
  NEW.tenant_id := booking_record.tenant_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assert_review_allowed_trigger ON reviews;
CREATE TRIGGER assert_review_allowed_trigger
BEFORE INSERT OR UPDATE ON reviews
FOR EACH ROW EXECUTE FUNCTION assert_review_allowed();

ALTER TABLE review_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_tags_public_read ON review_tags FOR SELECT USING (true);
CREATE POLICY review_tags_owner_insert ON review_tags FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM reviews
    WHERE reviews.id = review_tags.review_id
      AND reviews.user_id = (auth.jwt() ->> 'sub')::UUID
  )
);

ALTER TABLE artisan_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY artisan_stats_public_read ON artisan_stats FOR SELECT USING (true);
CREATE POLICY artisan_stats_super_admin_all ON artisan_stats FOR ALL USING (has_role('super_admin'));

DROP POLICY IF EXISTS tenant_isolation ON reviews;
DROP POLICY IF EXISTS super_admin_all ON reviews;
CREATE POLICY reviews_public_read ON reviews FOR SELECT USING (true);
CREATE POLICY reviews_owner_insert ON reviews FOR INSERT WITH CHECK (
  user_id = (auth.jwt() ->> 'sub')::UUID
  AND EXISTS (
    SELECT 1 FROM bookings
    WHERE bookings.id = reviews.booking_id
      AND bookings.status = 'completed'
      AND (bookings.client_id = (auth.jwt() ->> 'sub')::UUID OR bookings.user_id = (auth.jwt() ->> 'sub')::UUID)
  )
);
CREATE POLICY reviews_super_admin_all ON reviews FOR ALL USING (has_role('super_admin'));

INSERT INTO artisan_stats (artisan_id)
SELECT id FROM artisans
ON CONFLICT (artisan_id) DO NOTHING;

SELECT update_artisan_stats(id) FROM artisans;
