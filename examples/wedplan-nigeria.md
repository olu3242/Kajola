# WedPlan Nigeria — Complete System Architecture

**Platform:** WedPlan Nigeria  
**Vertical:** Wedding Vendor Marketplace  
**Market:** Nigeria (NGN)  
**Auth:** Phone OTP via Termii  
**Payments:** Paystack (deposit + balance)  
**Comms:** Termii SMS + WhatsApp Business API  

---

## Section 1: Product Requirements Document (PRD)

### Overview
WedPlan Nigeria is a two-sided marketplace connecting Nigerian couples with vetted wedding vendors — photographers, caterers, DJs, florists, venues, videographers, makeup artists, and decorators. Couples create a wedding event, discover vendors by category and location, receive quotes, and pay a mandatory 50% deposit to confirm each vendor booking.

### Problem
Nigeria's ₦500B+ wedding industry runs almost entirely through Instagram DMs and WhatsApp referrals. Couples spend 3–6 months chasing vendors for pricing and availability; vendors double-book and lose deposits because they have no calendar system. No-shows on wedding day are a recurring nightmare.

### Solution
1. **Discovery**: Browse verified vendor profiles with portfolio photos, pricing bands, reviews, and real-time availability
2. **Quote workflow**: Couple submits enquiry → vendor responds with quote within 24h
3. **Deposit lock**: 50% Paystack deposit confirms the booking and blocks the vendor's calendar
4. **Day-of logistics**: Vendor check-in, digital contract, event completion
5. **Post-event settlement**: Balance payment triggers vendor payout; couple leaves a review

### Users
| Role | Description |
|---|---|
| Couple | Creates event, discovers and books vendors |
| Vendor | Business owner (photographer, caterer, etc.) managing their calendar |
| Planner | Wedding planner managing multiple couples (enterprise tier) |
| Admin | Platform operations |

### Core Metrics
- GMV: total vendor booking value through the platform
- Booking confirmation rate: quotes accepted → deposit paid (target: 40%)
- Vendor fill rate: % of available dates booked 90 days out
- NPS: post-event couple satisfaction

---

## Section 2: Default Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Database | Supabase Postgres 15 | PostGIS; pg_cron; pgcrypto |
| Auth | Supabase Auth | Phone OTP via Termii; no email auth |
| Backend | Supabase Edge Functions (Deno/TypeScript) | book-slot, confirm-payment, submit-quote |
| Web | Next.js 14 (App Router) | Couple portal + vendor dashboard |
| Mobile | Expo 51 (React Native) | iOS + Android couple app |
| Storage | Supabase Storage | `vendor-portfolio` (public); `booking-contracts` (private) |
| Payments | Paystack | NGN; deposit + balance; HMAC-SHA-512 webhook |
| SMS / OTP | Termii | Phone OTP; booking notifications |
| Comms | WhatsApp Business API (Meta Cloud v19.0) | Confirmations, reminders |
| Cron | pg_cron | Hold expiry, reminders, review prompts |
| Maps | Google Maps / OpenStreetMap | Vendor location search |

---

## Section 3: SQL Schema

### 3.1 Enums

```sql
CREATE TYPE booking_status AS ENUM (
  'pending', 'confirmed', 'held', 'checked_in',
  'in_progress', 'completed', 'cancelled', 'no_show', 'disputed'
);

CREATE TYPE payment_method AS ENUM (
  'card', 'bank_transfer', 'ussd', 'cash', 'mobile_money'
);

CREATE TYPE payment_status AS ENUM (
  'pending', 'processing', 'paid', 'failed', 'refunded'
);

CREATE TYPE vendor_category AS ENUM (
  'photographer', 'caterer', 'dj', 'florist', 'venue',
  'videographer', 'makeup_artist', 'decorator', 'mc', 'band', 'cake'
);

CREATE TYPE quote_status AS ENUM (
  'pending', 'sent', 'accepted', 'rejected', 'expired'
);

CREATE TYPE wedding_event_type AS ENUM (
  'wedding', 'traditional', 'court', 'reception', 'engagement', 'pre_wedding'
);

CREATE TYPE loyalty_event_type AS ENUM (
  'points_earned', 'points_redeemed', 'points_expired', 'bonus_awarded', 'referral_bonus'
);
```

### 3.2 Core Multi-Tenant Tables

```sql
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  plan       text NOT NULL DEFAULT 'starter',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  full_name           text NOT NULL,
  phone               text NOT NULL,
  whatsapp_opted_in   boolean NOT NULL DEFAULT false,
  expo_push_token     text,
  role                text NOT NULL DEFAULT 'couple'
                      CHECK (role IN ('couple','vendor','planner','admin')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_tenant ON profiles(tenant_id);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE businesses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  owner_id             uuid NOT NULL REFERENCES profiles(id),
  name                 text NOT NULL,
  slug                 text UNIQUE NOT NULL,
  category             vendor_category NOT NULL,
  description          text,
  base_price_kobo      bigint NOT NULL DEFAULT 0,
  deposit_policy       jsonb NOT NULL DEFAULT '{"deposit_percentage":50,"deposit_type":"percentage"}'::jsonb,
  cancellation_policy  jsonb NOT NULL DEFAULT '{"window_hours":72,"refund_percentage":80}'::jsonb,
  no_show_policy       jsonb NOT NULL DEFAULT '{"charge_percentage":100}'::jsonb,
  is_verified          boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_businesses_tenant    ON businesses(tenant_id);
CREATE INDEX idx_businesses_category  ON businesses(category);
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL DEFAULT 'Main',
  address     text,
  city        text NOT NULL DEFAULT 'Lagos',
  state       text NOT NULL DEFAULT 'Lagos',
  location    geography(POINT, 4326),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_branches_business ON branches(business_id);
CREATE INDEX idx_branches_location  ON branches USING gist(location);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  profile_id  uuid REFERENCES profiles(id),
  full_name   text NOT NULL,
  role        text NOT NULL DEFAULT 'vendor',
  rating      numeric(3,2) NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_business ON staff(business_id);
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 3.3 Wedding Events

```sql
-- Anchor table: each couple's wedding event
CREATE TABLE events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  couple_id     uuid NOT NULL REFERENCES profiles(id),
  event_type    wedding_event_type NOT NULL DEFAULT 'wedding',
  event_name    text NOT NULL,
  event_date    date NOT NULL,
  venue_address text,
  venue_city    text NOT NULL DEFAULT 'Lagos',
  guest_count   integer NOT NULL DEFAULT 200,
  budget_kobo   bigint,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_couple ON events(couple_id);
CREATE INDEX idx_events_date   ON events(event_date);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 3.4 Vendor Availability

```sql
CREATE TABLE availability_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_avail_windows_staff ON availability_windows(staff_id);
ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;

CREATE TABLE availability_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES branches(id),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  override_type text NOT NULL CHECK (override_type IN ('available','blocked')),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_avail_overrides_staff ON availability_overrides(staff_id, starts_at);
ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;
```

### 3.5 Bookings (SORF Core)

```sql
-- Vendor booking requests linked to a wedding event
CREATE TABLE bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  event_id            uuid REFERENCES events(id),
  couple_id           uuid NOT NULL REFERENCES profiles(id),
  staff_id            uuid NOT NULL REFERENCES staff(id),
  branch_id           uuid NOT NULL REFERENCES branches(id),
  business_id         uuid NOT NULL REFERENCES businesses(id),
  status              booking_status NOT NULL DEFAULT 'pending',
  vendor_category     vendor_category NOT NULL,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  held_until          timestamptz,
  total_amount_kobo   bigint NOT NULL DEFAULT 0,
  deposit_amount_kobo bigint NOT NULL DEFAULT 0,
  balance_amount_kobo bigint NOT NULL DEFAULT 0,
  deposit_paid_at     timestamptz,
  balance_paid_at     timestamptz,
  payment_method      payment_method,
  cancellation_reason text,
  special_requests    text,
  contract_path       text,
  idempotency_key     text UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Prevent double-booking a vendor on the same day
  EXCLUDE USING gist (
    staff_id  WITH =,
    branch_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show', 'disputed'))
);

CREATE INDEX idx_bookings_event      ON bookings(event_id);
CREATE INDEX idx_bookings_couple     ON bookings(couple_id);
CREATE INDEX idx_bookings_staff_date ON bookings(staff_id, starts_at);
CREATE INDEX idx_bookings_status     ON bookings(status);
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 3.6 Quotes

```sql
CREATE TABLE quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vendor_id   uuid NOT NULL REFERENCES staff(id),
  status      quote_status NOT NULL DEFAULT 'pending',
  amount_kobo bigint NOT NULL,
  inclusions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  timeline    jsonb NOT NULL DEFAULT '[]'::jsonb,
  valid_until timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_quotes_booking ON quotes(booking_id);
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 3.7 Payments

```sql
CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  booking_id           uuid NOT NULL REFERENCES bookings(id),
  payer_id             uuid NOT NULL REFERENCES profiles(id),
  amount_kobo          bigint NOT NULL,
  payment_type         text NOT NULL CHECK (payment_type IN ('deposit','balance','refund')),
  status               payment_status NOT NULL DEFAULT 'pending',
  payment_method       payment_method,
  paystack_ref         text UNIQUE,
  paystack_access_code text,
  metadata             jsonb,
  paid_at              timestamptz,
  idempotency_key      text UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_booking ON payments(booking_id);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
```

### 3.8 Vendor Profiles & Portfolio

```sql
CREATE TABLE provider_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  slug            text UNIQUE NOT NULL,
  tagline         text,
  bio             text,
  category        vendor_category NOT NULL,
  min_price_kobo  bigint NOT NULL DEFAULT 0,
  max_price_kobo  bigint NOT NULL DEFAULT 0,
  avg_rating      numeric(3,2) NOT NULL DEFAULT 0,
  review_count    integer NOT NULL DEFAULT 0,
  portfolio_count integer NOT NULL DEFAULT 0,
  weddings_done   integer NOT NULL DEFAULT 0,
  location        geography(POINT, 4326),
  service_cities  text[] NOT NULL DEFAULT '{}',
  is_featured     boolean NOT NULL DEFAULT false,
  search_vector   tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(tagline,'') || ' ' || coalesce(bio,''))
  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_profiles_slug     ON provider_profiles(slug);
CREATE INDEX idx_provider_profiles_category ON provider_profiles(category);
CREATE INDEX idx_provider_profiles_location ON provider_profiles USING gist(location);
CREATE INDEX idx_provider_profiles_search   ON provider_profiles USING gin(search_vector);
ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE portfolio_photos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  storage_path   text NOT NULL,
  thumbnail_path text,
  caption        text,
  wedding_date   date,
  is_featured    boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_provider ON portfolio_photos(provider_id);
ALTER TABLE portfolio_photos ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION sync_portfolio_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE provider_profiles
  SET portfolio_count = (
    SELECT count(*) FROM portfolio_photos
    WHERE provider_id = COALESCE(NEW.provider_id, OLD.provider_id)
  )
  WHERE id = COALESCE(NEW.provider_id, OLD.provider_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_portfolio_count
  AFTER INSERT OR DELETE ON portfolio_photos
  FOR EACH ROW EXECUTE FUNCTION sync_portfolio_count();
```

### 3.9 Waitlist

```sql
CREATE TABLE waitlist_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  booking_id uuid REFERENCES bookings(id),
  staff_id   uuid NOT NULL REFERENCES staff(id),
  branch_id  uuid NOT NULL REFERENCES branches(id),
  couple_id  uuid NOT NULL REFERENCES profiles(id),
  event_date date NOT NULL,
  status     text NOT NULL DEFAULT 'waiting'
             CHECK (status IN ('waiting','notified','booked','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_waitlist_staff_date ON waitlist_entries(staff_id, event_date);
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION notify_waitlist_on_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status IN ('cancelled','no_show') AND OLD.status NOT IN ('cancelled','no_show') THEN
    UPDATE waitlist_entries
    SET status = 'notified'
    WHERE staff_id   = NEW.staff_id
      AND event_date = NEW.starts_at::date
      AND status     = 'waiting'
    LIMIT 1;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_notify_waitlist
  AFTER UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION notify_waitlist_on_cancellation();
```

### 3.10 Reviews

```sql
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  reviewer_id uuid NOT NULL REFERENCES profiles(id),
  staff_id    uuid NOT NULL REFERENCES staff(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text,
  is_public   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_vendor_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE staff
  SET rating = (SELECT avg(rating) FROM reviews WHERE staff_id = NEW.staff_id)
  WHERE id = NEW.staff_id;

  UPDATE provider_profiles
  SET avg_rating   = (SELECT avg(r.rating) FROM reviews r WHERE r.business_id = NEW.business_id),
      review_count = (SELECT count(*) FROM reviews WHERE business_id = NEW.business_id AND is_public)
  WHERE business_id = NEW.business_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_update_vendor_rating
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_vendor_rating();
```

### 3.11 Loyalty, Automation & Observability

```sql
CREATE TABLE loyalty_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  profile_id uuid NOT NULL REFERENCES profiles(id),
  points     integer NOT NULL DEFAULT 0,
  tier       text NOT NULL DEFAULT 'bronze'
             CHECK (tier IN ('bronze','silver','gold','platinum')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE loyalty_accounts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON loyalty_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE loyalty_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  account_id      uuid NOT NULL REFERENCES loyalty_accounts(id),
  booking_id      uuid REFERENCES bookings(id),
  event_type      loyalty_event_type NOT NULL,
  points_delta    integer NOT NULL,
  balance_after   integer NOT NULL,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

CREATE TABLE automation_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  booking_id uuid REFERENCES bookings(id),
  job_type   text NOT NULL,
  run_at     timestamptz NOT NULL,
  status     text NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','running','done','failed')),
  attempts   smallint NOT NULL DEFAULT 0,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_automation_jobs_run_at ON automation_jobs(run_at) WHERE status = 'pending';
ALTER TABLE automation_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE notification_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  profile_id   uuid REFERENCES profiles(id),
  channel      text NOT NULL CHECK (channel IN ('sms','whatsapp','push','email')),
  to_phone     text,
  template     text,
  status       text NOT NULL DEFAULT 'sent',
  provider_ref text,
  payload      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  actor_id   uuid REFERENCES profiles(id),
  action     text NOT NULL,
  table_name text NOT NULL,
  record_id  uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE idempotency_keys (
  key        text PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  response   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE MATERIALIZED VIEW branch_kpis AS
SELECT
  b.id                                                                           AS branch_id,
  b.business_id,
  b.tenant_id,
  count(bk.id) FILTER (WHERE bk.status = 'confirmed')                           AS confirmed_bookings_30d,
  count(bk.id) FILTER (WHERE bk.status = 'completed')                           AS completed_bookings_30d,
  count(bk.id) FILTER (WHERE bk.status IN ('cancelled','no_show'))               AS cancelled_bookings_30d,
  coalesce(sum(bk.total_amount_kobo) FILTER (WHERE bk.status = 'completed'), 0)  AS revenue_30d_kobo,
  coalesce(avg(r.rating), 0)                                                     AS avg_rating_30d,
  now()                                                                          AS refreshed_at
FROM branches b
LEFT JOIN bookings bk ON bk.branch_id = b.id
  AND bk.created_at >= now() - interval '30 days'
LEFT JOIN reviews r ON r.business_id = b.business_id
  AND r.created_at >= now() - interval '30 days'
GROUP BY b.id, b.business_id, b.tenant_id
WITH DATA;

CREATE UNIQUE INDEX ON branch_kpis(branch_id);
```

### 3.12 pg_cron Jobs

```sql
-- Release held slots every minute
SELECT cron.schedule('release-held-slots', '* * * * *', $$
  UPDATE bookings SET status = 'cancelled', cancellation_reason = 'hold_expired'
  WHERE status = 'held' AND held_until < now();
$$);

-- Refresh branch KPIs every 15 minutes
SELECT cron.schedule('refresh-branch-kpis', '*/15 * * * *', $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY branch_kpis;
$$);

-- Balance payment reminder — 7 days before event
SELECT cron.schedule('balance-reminder-7d', '0 9 * * *', $$
  INSERT INTO automation_jobs (tenant_id, booking_id, job_type, run_at, payload)
  SELECT b.tenant_id, b.id, 'reminder.balance_due',
         (e.event_date::timestamptz - interval '7 days'),
         jsonb_build_object('booking_id', b.id)
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE b.status = 'confirmed'
    AND b.balance_paid_at IS NULL
    AND e.event_date = current_date + 7
  ON CONFLICT DO NOTHING;
$$);

-- Final balance reminder — 3 days before event
SELECT cron.schedule('balance-reminder-3d', '0 10 * * *', $$
  INSERT INTO automation_jobs (tenant_id, booking_id, job_type, run_at, payload)
  SELECT b.tenant_id, b.id, 'reminder.balance_final',
         (e.event_date::timestamptz - interval '3 days'),
         jsonb_build_object('booking_id', b.id)
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE b.status = 'confirmed'
    AND b.balance_paid_at IS NULL
    AND e.event_date = current_date + 3
  ON CONFLICT DO NOTHING;
$$);

-- Day-of vendor check-in prompt
SELECT cron.schedule('event-day-checkin', '0 6 * * *', $$
  INSERT INTO automation_jobs (tenant_id, booking_id, job_type, run_at, payload)
  SELECT b.tenant_id, b.id, 'event.checkin_prompt',
         (e.event_date::timestamptz + interval '6 hours'),
         jsonb_build_object('booking_id', b.id)
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE b.status = 'confirmed'
    AND e.event_date = current_date;
$$);

-- Post-event review prompt — 3 days after
SELECT cron.schedule('review-prompt', '0 11 * * *', $$
  INSERT INTO automation_jobs (tenant_id, booking_id, job_type, run_at, payload)
  SELECT b.tenant_id, b.id, 'review.prompt',
         (e.event_date::timestamptz + interval '3 days'),
         jsonb_build_object('booking_id', b.id)
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE b.status = 'completed'
    AND e.event_date = current_date - 3
    AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)
  ON CONFLICT DO NOTHING;
$$);

-- Expire stale quotes after 48h
SELECT cron.schedule('expire-quotes', '0 * * * *', $$
  UPDATE quotes SET status = 'expired'
  WHERE status = 'sent' AND valid_until < now();
$$);
```

---

## Section 4: API Definitions

### 4.1 Authentication
Phone OTP flow: `POST /auth/v1/otp` (Termii sends code) → `POST /auth/v1/verify` (JWT returned). All endpoints require `Authorization: Bearer <jwt>`.

### 4.2 Core Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/events` | Couple | Create wedding event |
| GET | `/api/events/{id}` | Couple | Get event with all bookings |
| GET | `/api/vendors` | Public | Discover vendors (category, city, date, price range) |
| GET | `/api/vendors/{slug}` | Public | Vendor profile + portfolio |
| GET | `/api/vendors/{slug}/availability` | Public | Get booked dates for vendor |
| POST | `/api/vendors/{slug}/enquire` | Couple | Submit booking request |
| POST | `/api/quotes/{booking_id}` | Vendor | Submit quote for a booking request |
| POST | `/functions/v1/book-slot` | Couple | Optimistic slot hold (15 min) — Edge Fn |
| POST | `/functions/v1/confirm-payment` | Paystack | Webhook: deposit or balance confirmed |
| GET | `/api/bookings/{id}` | Couple/Vendor | Get booking detail |
| POST | `/api/bookings/{id}/cancel` | Couple | Cancel with cancellation_reason |
| POST | `/api/bookings/{id}/check-in` | Vendor | Mark vendor checked in on event day |
| POST | `/api/bookings/{id}/complete` | Vendor | Mark event complete |
| POST | `/api/reviews` | Couple | Submit post-event review |
| POST | `/api/portfolio` | Vendor | Upload portfolio photo (Supabase Storage) |

### 4.3 Vendor Discovery

```typescript
// GET /api/vendors?category=photographer&city=Lagos&date=2027-03-15
const { data } = await supabase
  .from('provider_profiles')
  .select(`
    slug, tagline, category, min_price_kobo, max_price_kobo,
    avg_rating, review_count, portfolio_count, is_featured,
    businesses!inner(name, slug, is_verified)
  `)
  .eq('category', params.category)
  .contains('service_cities', [params.city])
  .textSearch('search_vector', params.q ?? '')
  .order('is_featured', { ascending: false })
  .order('avg_rating', { ascending: false });
```

---

## Section 5: Row-Level Security Policies

```sql
CREATE OR REPLACE FUNCTION current_user_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$;

-- profiles: tenant isolation
CREATE POLICY "profiles_tenant_isolation" ON profiles
  USING (tenant_id = current_user_tenant_id());

-- businesses: tenant isolation
CREATE POLICY "businesses_tenant_isolation" ON businesses
  USING (tenant_id = current_user_tenant_id());

-- events: couple sees their own
CREATE POLICY "events_couple_isolation" ON events
  USING (couple_id = auth.uid());

-- bookings: couple sees their own; vendor sees bookings for their business
CREATE POLICY "bookings_couple_read" ON bookings
  FOR SELECT USING (couple_id = auth.uid());

CREATE POLICY "bookings_vendor_read" ON bookings
  FOR SELECT USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

-- provider_profiles: public read
CREATE POLICY "provider_profiles_public_read" ON provider_profiles
  FOR SELECT USING (true);

CREATE POLICY "provider_profiles_vendor_write" ON provider_profiles
  FOR ALL USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

-- portfolio_photos: public read
CREATE POLICY "portfolio_photos_public_read" ON portfolio_photos
  FOR SELECT USING (true);

-- quotes: vendor writes; couple reads
CREATE POLICY "quotes_vendor_write" ON quotes
  FOR INSERT WITH CHECK (
    vendor_id IN (SELECT id FROM staff WHERE profile_id = auth.uid())
  );

CREATE POLICY "quotes_read" ON quotes
  FOR SELECT USING (
    booking_id IN (
      SELECT id FROM bookings
      WHERE couple_id = auth.uid()
        OR business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
    )
  );

-- audit_logs: insert-only for service role
CREATE POLICY "audit_logs_service_only" ON audit_logs
  USING (false) WITH CHECK (false);
```

---

## Section 6: Screen & Component Layout

### 6.1 Couple App (Expo)

```
Onboarding
├── Phone OTP (Termii)
├── Profile setup: name, phone
└── Create first event: wedding date, city, guest count

Discover
├── Category tabs: Photographer · Caterer · DJ · Florist · Venue · More
├── Map / list toggle (PostGIS radius search)
├── Filters: city, date filter (checks booked dates), price range, rating
└── Featured vendors carousel (is_featured = true)

Vendor Profile
├── Cover photo + portfolio gallery carousel
├── Tagline, bio, pricing band, avg_rating (review_count)
├── Availability calendar: greyed-out dates already booked
├── "Send Enquiry" CTA → select event → special requests → submit

Booking Flow
├── Enquiry submitted → waiting for vendor quote (24h window)
├── Quote received → review inclusions + timeline → Accept or Decline
├── Accept → Paystack checkout (50% deposit)
└── Booking confirmed screen + WhatsApp notification

My Events / Bookings
├── Event dashboard: all vendor categories (confirmed / pending / empty slot)
├── Booking detail: vendor info, event date, deposit paid, balance due date
└── Past bookings: completed → leave review CTA
```

### 6.2 Vendor Dashboard (Next.js)

```
Overview
├── Today: upcoming events, pending quote requests
├── Calendar: booked dates (red), available (green), hold (amber)
├── Earnings summary: this month, pending payout, platform fee deducted

Booking Requests
├── New enquiries → submit quote (amount, inclusions, timeline, valid_until)
└── Pending quotes: accepted / rejected / expired

Active Bookings
├── Confirmed → check in on event day → mark complete
└── Download contract, view couple contact

Portfolio
├── Upload photos (Supabase Storage vendor-portfolio bucket)
├── Set featured photos, drag to reorder
└── Portfolio count synced automatically

Settings
├── Availability: weekly windows + date overrides
├── Pricing: min_price_kobo / max_price_kobo, deposit_policy
└── Business profile: bio, tagline, service_cities
```

---

## Section 7: Automation Engine

### 7.1 Job Types

| job_type | Trigger | Action |
|---|---|---|
| `reminder.2h` | 2h before event starts_at | WhatsApp + SMS to couple |
| `reminder.balance_due` | 7 days before event | Balance payment reminder to couple |
| `reminder.balance_final` | 3 days before event | Final balance reminder |
| `event.checkin_prompt` | 6AM on event day | Vendor check-in SMS |
| `review.prompt` | 3 days after event | Review request to couple |
| `quote.expiry_warning` | 24h before valid_until | Remind couple to accept quote |

### 7.2 Paystack Webhook Handler (Edge Function: `confirm-payment`)

```typescript
import { createHmac } from "node:crypto";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const sig = req.headers.get("x-paystack-signature") ?? "";
  const expected = createHmac("sha512", Deno.env.get("PAYSTACK_SECRET_KEY")!)
    .update(rawBody).digest("hex");
  if (sig !== expected) return new Response("Unauthorized", { status: 401 });

  const event = JSON.parse(rawBody);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  if (event.event === "charge.success") {
    const { metadata } = event.data;
    const { booking_id, payment_type } = metadata;

    // Idempotency guard
    const idem = `booking-${booking_id}-${payment_type}`;
    const { data: existing } = await supabase
      .from("idempotency_keys").select("key").eq("key", idem).maybeSingle();
    if (existing) return new Response("ok");

    if (payment_type === "deposit") {
      await supabase.from("bookings").update({
        status: "confirmed",
        deposit_paid_at: new Date().toISOString(),
      }).eq("id", booking_id);

      await supabase.from("automation_jobs").insert([
        { booking_id, job_type: "reminder.balance_due", run_at: new Date().toISOString(), payload: { booking_id } },
        { booking_id, job_type: "reminder.2h", run_at: new Date().toISOString(), payload: { booking_id } },
      ]);

      // Credit loyalty points (100 per booking)
      await supabase.rpc("credit_loyalty_points", { p_booking_id: booking_id, p_points: 100 });
    } else if (payment_type === "balance") {
      await supabase.from("bookings").update({
        status: "completed",
        balance_paid_at: new Date().toISOString(),
      }).eq("id", booking_id);

      await supabase.from("automation_jobs").insert([
        { booking_id, job_type: "review.prompt", run_at: new Date().toISOString(), payload: { booking_id } },
      ]);
    }

    await supabase.from("idempotency_keys").insert({ key: idem });
  }

  if (event.event === "charge.failed") {
    const { metadata } = event.data;
    await supabase.from("bookings")
      .update({ status: "cancelled", cancellation_reason: "payment_failed" })
      .eq("id", metadata.booking_id)
      .eq("status", "held");
  }

  return new Response("ok");
});
```

### 7.3 Book Slot Edge Function

```typescript
// POST /functions/v1/book-slot
// Body: { staff_id, branch_id, business_id, event_id, vendor_category,
//         starts_at, ends_at, total_amount_kobo, idempotency_key }
Deno.serve(async (req) => {
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const body = await req.json();
  const { idempotency_key } = body;

  const { data: idem } = await supabase
    .from("idempotency_keys").select("key").eq("key", idempotency_key).maybeSingle();
  if (idem) return new Response(JSON.stringify({ success: true, cached: true }));

  // Compute deposit from businesses.deposit_policy
  const { data: biz } = await supabase
    .from("businesses").select("deposit_policy").eq("id", body.business_id).single();
  const pct = biz?.deposit_policy?.deposit_percentage ?? 50;
  const deposit_amount_kobo = Math.round(body.total_amount_kobo * pct / 100);

  const { data: booking, error } = await supabase.from("bookings").insert({
    ...body,
    status: "held",
    held_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    deposit_amount_kobo,
    balance_amount_kobo: body.total_amount_kobo - deposit_amount_kobo,
  }).select().single();

  if (error?.code === "23P01") {
    return new Response(
      JSON.stringify({ success: false, error: "vendor_unavailable" }),
      { status: 409 }
    );
  }
  if (error) return new Response(
    JSON.stringify({ success: false, error: error.message }),
    { status: 500 }
  );

  await supabase.from("idempotency_keys").insert({ key: idempotency_key });
  return new Response(JSON.stringify({ success: true, booking }));
});
```

---

## Section 8: Deployment Plan

### 8.1 Supabase Project Setup

1. Create project (region: `eu-west-2` — lowest latency for West Africa)
2. Enable extensions: `postgis`, `pg_cron`, `pgcrypto`, `uuid-ossp`
3. Run migrations: `01_enums` → `02_core` → `03_events` → `04_bookings` → `05_vendors` → `06_automation` → `07_rls` → `08_cron`
4. Deploy Edge Functions: `book-slot`, `confirm-payment`, `submit-quote`
5. Configure Paystack webhook URL: `https://<project>.supabase.co/functions/v1/confirm-payment`
6. Create Storage buckets: `vendor-portfolio` (public), `booking-contracts` (private)
7. Configure WhatsApp webhook: `https://<project>.supabase.co/functions/v1/whatsapp-webhook`

### 8.2 Environment Variables

```env
# Supabase
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

# Paystack
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_PUBLIC_KEY=pk_live_...

# Termii
TERMII_API_KEY=...
TERMII_SENDER_ID=WEDPLAN

# WhatsApp Business API
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...

# App
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_live_...
```

### 8.3 CI/CD

- GitHub Actions: type-check → migration apply → Edge Function deploy → Vercel deploy
- Branch protection: `main` requires PR review + passing CI
- Staging: separate Supabase project + `.env.staging`

---

## Section 9: Monetization Strategy

### 9.1 Revenue Streams

| Stream | Model | Rate |
|---|---|---|
| Platform commission | 10% of each confirmed booking GMV | Deducted from vendor payout |
| Featured vendor listing | Monthly subscription | ₦15,000/month per vendor |
| Wedding planner license | Agency tier subscription | ₦50,000/month per planner |
| Photo storage upsell | Extra portfolio storage beyond 5GB | ₦3,000/month per 10GB |

### 9.2 Vendor Pricing Reference (Lagos, 2026)

| Category | Starter | Mid | Premium |
|---|---|---|---|
| Photographer | ₦200,000 | ₦450,000 | ₦900,000 |
| Caterer (200 guests) | ₦400,000 | ₦900,000 | ₦2,000,000 |
| DJ | ₦80,000 | ₦200,000 | ₦500,000 |
| Florist | ₦150,000 | ₦350,000 | ₦800,000 |
| Venue | ₦300,000 | ₦700,000 | ₦2,500,000 |
| Videographer | ₦150,000 | ₦400,000 | ₦1,000,000 |
| Makeup Artist | ₦60,000 | ₦150,000 | ₦400,000 |

### 9.3 Revenue Projections

| Milestone | Weddings/Month | Avg GMV/Wedding | Platform Take | MRR |
|---|---|---|---|---|
| Month 6 | 50 | ₦2,500,000 | ₦250,000 | ₦12,500,000 |
| Month 12 | 200 | ₦3,000,000 | ₦300,000 | ₦60,000,000 |
| Month 24 | 600 | ₦3,500,000 | ₦350,000 | ₦210,000,000 |

At 200 weddings/month with an average of 5 vendor categories per wedding booked through the platform, GMV = ₦600M/month. Platform take at 10% = ₦60M MRR by Month 12.

---

## Section 10: Growth Strategy

### 10.1 Acquisition

- **Wedding expos**: Bridal Industry Awards Nigeria, The Wedding Expo — direct couple and vendor sign-ups at booth
- **Instagram/TikTok**: Before/after wedding content; featured vendor showcases; couple testimonials
- **Vendor referral programme**: Verified vendor shares referral link; ₦5,000 Paystack credit per couple who pays first deposit
- **BellaNaija Weddings partnership**: Featured vendor placement in sponsored editorial content

### 10.2 Retention

- **Couple loyalty points**: 100 points per vendor booking; redeem at ₦1 per point on future bookings
- **Vendor badge system**: Silver (5 weddings completed), Gold (20), Platinum (50) — improves discovery ranking
- **Pre-wedding content delivery**: Automated contract + shot-list PDF delivery via Supabase Storage signed URL keeps couples engaged post-booking

### 10.3 Expansion

- Phase 1: Lagos, Abuja, Port Harcourt
- Phase 2: Ibadan, Enugu, Kano; add Owambe (party) vendor category
- Phase 3: Ghana (GHS + MTN MoMo), Kenya (KES + M-Pesa) via multi-currency tenant config

---

## Section 11: Roadmap

| Quarter | Deliverable |
|---|---|
| Q1 2027 | MVP: Lagos launch — photographer, caterer, venue categories; Paystack deposits; Couple app + Vendor dashboard |
| Q2 2027 | DJ, florist, videographer, makeup_artist categories; WhatsApp booking confirmation flow; Portfolio gallery v2 |
| Q3 2027 | Balance settlement + vendor payout ledger; Wedding planner license tier; Abuja + Port Harcourt expansion |
| Q4 2027 | Owambe (party) category; Couple-to-couple referral programme; Multi-city radius search |
| Q1 2028 | Ghana launch (MTN MoMo + GHS); Flutterwave fallback for cross-border |
| Q2 2028 | AI vendor matching (style preference questionnaire → ranked suggestions); Video portfolio support |

---

## Assumptions Made

- **Nigeria-only Phase 1**: All prices in NGN (kobo); Paystack as sole payment provider
- **Mandatory 50% deposit**: All vendor categories require `deposit_percentage: 50`; no free quote-hold
- **Single date per event**: `events` has a single `event_date`; traditional + white wedding → two separate events
- **One vendor per category per event**: Couples can book one photographer AND one caterer (different `staff_id`); EXCLUDE USING gist prevents double-booking the same vendor
- **24h quote response window**: Vendors must respond to enquiries within 24h; quotes expire 48h after submission
- **Vendor = staff model**: Individual photographers/caterers modelled as `staff` under their business; solo vendors have one staff record
- **10% platform commission**: Computed server-side on `total_amount_kobo`; deducted from vendor payout, not added to couple's bill
- **WhatsApp primary, Termii fallback**: Booking confirmations via WhatsApp if `whatsapp_opted_in = true`; Termii SMS otherwise
- **Nigerian phone numbers**: All OTP sent via Termii to +234 numbers; no email auth in MVP
