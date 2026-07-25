# Examples

Full generated architecture packages produced by the Kajola skill. Each file shows exactly what you get when you run a prompt through the skill.

## Files

### `kajola-artisan-platform.md`
**Prompt**: "Design a multi-tenant artisan booking platform for Nigeria called Kajola. Artisans (barbers, tailors, mechanics) create profiles and get booked. Clients discover and pay via Paystack. Need full system architecture."

**Market**: Nigeria · **Currency**: NGN · **Payments**: Paystack · **Auth**: Phone OTP (Termii)

What's inside:
- PRD with 3 personas and 18 features (P0/P1/P2)
- ASCII architecture diagram and 4 detailed data flows
- Full Postgres schema — 14 tables, RLS on all, indexes, booking conflict exclusion constraint
- 22 API endpoints with full request/response schemas and error cases
- Next.js 14 + Expo 51 directory trees with component-level descriptions
- Turborepo monorepo layout with 11 named Edge Functions
- Automation engine — 11 events, 6 cron jobs, Paystack HMAC webhook handler
- Step-by-step deployment guide, 20 env vars, GitHub Actions CI/CD
- Monetization — 10% transaction fee, Pro subscription at ₦3,500/month, featured listings
- Scaling plan at 10k / 100k / 1M users with concrete infrastructure actions
- Quarterly roadmap with weekly Q1 milestones and business impact targets

---

### `toolhire-pro-nigeria.md`
**Prompt**: "Build the complete system design for ToolHire Pro — an equipment rental marketplace for Nigerian construction companies. Multi-tenant. Paystack payments. Full package."

**Market**: Nigeria · **Currency**: NGN · **Payments**: Paystack · **Auth**: Phone OTP (Termii)

What's inside:
- PRD with 4 personas (owner, renter, fleet manager, admin) and 19 features
- Architecture with deposit hold/release flows and condition photo data flows
- Full Postgres schema — 16 tables including `condition_records`, `availability_blocks` with `daterange` conflict prevention, dual deposit/rental transaction tracking
- 22 API endpoints covering equipment search with date-range availability, condition photo upload, deposit deduction workflow
- Next.js 14 + Expo 51 trees with fleet dashboard, condition photo comparison grid, date range picker
- 12-event automation engine including deposit release, partial release, return reminders, auto-cancel
- Deployment, monetization (₦8k/week featured, ₦5k/month Pro), scaling to 500k users, roadmap

---

### `boda-connect-kenya.md`
**Prompt**: "Design a boda-boda (motorcycle taxi) dispatch platform for Nairobi, Kenya. Riders join Saccos, passengers book and pay via M-Pesa STK Push, fares are settled via M-Pesa B2C payout. Feature-phone riders need a USSD fallback for earnings checks. Full system architecture."

**Market**: Kenya (East Africa) · **Currency**: KES · **Payments**: M-Pesa Daraja (C2B STK Push + B2C payout) · **Auth**: Phone OTP (Africa's Talking) · **Feature-phone**: USSD via Africa's Talking

What's inside:
- PRD with 3 personas (rider, Sacco operations manager, passenger) and detailed journeys
- PostGIS nearest-rider dispatch with `ST_DWithin` spatial query
- Full Postgres schema — 9 tables including `trip_gps_pings` (append-only), `mpesa_transactions` with `momo_direction` enum, `phone_otps` with bcrypt hash
- 8 API contracts covering STK Push initiation, Daraja callback, dispatch, GPS ping, and USSD handler
- USSD menu tree in Swahili (`*384*BodaConnect#`) — earnings in KES, account status
- Daraja HMAC callback verification (SHA-256), M-Pesa idempotency guard
- Offline GPS queue pattern — SQLite-backed, FIFO flush on reconnect
- Midnight EAT levy settlement cron, rider inactivity nudge, rating rollup
- All env vars for Daraja (consumer key/secret, passkey, shortcode, B2C initiator) + Africa's Talking

---

### `parcelrun-ghana-ci.md`
**Prompt**: "Design a micro-logistics platform for Accra, Ghana and Abidjan, Côte d'Ivoire. Small parcels booked by phone, delivered by independent couriers. Bilingual UI (English + French). Orange Money payments for Côte d'Ivoire, MTN Mobile Money for Ghana. Couriers often lose connectivity during deliveries."

**Markets**: Ghana (GHS) + Côte d'Ivoire (XOF/CFA) · **Payments**: MTN Mobile Money + Orange Money · **Auth**: Phone OTP (Termii) · **Languages**: English (en-GH) + French (fr-CI)

What's inside:
- PRD with 4 personas in both English and French (Abena the sender, Kouassi le expéditeur, Mensah the courier, Aya the ops manager)
- Multi-currency schema — amounts stored as integers (pesewas for GHS; whole francs for XOF)
- Full Postgres schema — 7 tables including `parcel_scans` (append-only event log with `synced_at`), `momo_transactions` with provider enum, `idempotency_key` column
- HMAC callback verification for both MTN (`x-callback-signature`) and Orange Money (`x-orange-signature`)
- Offline QR scan queue — courier scans parcel label offline; `POST /offline-flush` processes batch idempotently on reconnect
- Bilingual SMS templates — i18n JSON keyed by locale (`en-GH`, `fr-CI`); locale selected from sender profile at send time
- Stale job re-dispatch cron (5-min), nightly reconciliation, payout retry with exponential backoff
- Dispute hold flow — freezes payout, manager reviews GPS track + parcel photos, releases via Mobile Money reversal

---

### `glamplus-beauty-kenya.md`
**Prompt**: "Design a multi-tenant beauty salon booking platform for Nairobi, Kenya called GlamPlus. Customers book appointments with specific stylists, pay a 30% M-Pesa deposit to confirm, earn loyalty points, and join a waitlist if their preferred stylist is fully booked. Salon owners manage multiple branches and see real-time KPI dashboards. Full system architecture."

**Market**: Kenya (Nairobi) · **Currency**: KES · **Payments**: M-Pesa Daraja C2B+B2C · **Auth**: Phone OTP (Africa's Talking) · **SORF**: All 18 stages

What's inside:
- PRD with 3 personas (customer Wanjiru, salon owner Amina, franchise owner David) and 15 features (P0/P1/P2)
- SORF-annotated architecture: full 18-stage lifecycle documented in all 4 data flows
- Full Postgres schema — 18 tables: SORF 9-state `booking_status` enum, `availability_windows` (recurring) + `availability_overrides` (one-off), `EXCLUDE USING gist` constraint on `(staff_id, branch_id)`, `waitlist_entries` with cancellation trigger, `loyalty_accounts` + `loyalty_transactions`, `memberships`, `branch_kpis` materialised view
- `businesses.deposit_policy` + `cancellation_policy` + `no_show_policy` as jsonb with branch-level overrides
- 14 API endpoints: hold slot, M-Pesa STK Push initiate, Daraja C2B webhook, check-in, start, complete, cancel, waitlist join, loyalty balance, branch KPIs
- Next.js dashboard: SORF state machine UI, availability grid editor, cross-branch franchise KPI table
- Expo app: slot picker, M-Pesa STK Push flow, loyalty tier progress bar, en-KE / sw-KE i18n
- 9 pg_cron jobs including hold expiry (5 min), no-show check (5 min), 24h/2h reminders, AI scoring (22:00 EAT), nightly reconciliation
- 16 automation events spanning full SORF lifecycle: `booking.held` → `booking.confirmed` → … → `ai.rebook_nudge`
- Monetization: 5% platform fee, KES 4,500/month Pro, KES 6,000/month featured, franchise 3% GMV fee; projections to KES 15.8M/month at 1,200 branches
- Scaling plan at 10k / 100k / 1M MAU with cost estimates in KES
- Quarterly roadmap: Q1 SORF core, Q2 loyalty + franchise, Q3 AI operations, Q4 East Africa expansion

---

### `medconnect-telemedicine-nigeria.md`
**Prompt**: "Design a telemedicine and in-clinic appointment booking platform for Nigeria called MedConnect. Patients book video consultations or in-person visits with licensed GPs, dermatologists, cardiologists, and pediatricians. Doctors set their own weekly availability windows. Patients pay a consultation deposit via Paystack before the slot is confirmed. VIP wellness members earn wellness points per consultation. No-show policy applies after 3 missed appointments. Multi-specialty clinic groups manage multiple branches and doctors under one account. Full system architecture."

**Market**: Nigeria · **Currency**: NGN · **Payments**: Paystack · **Auth**: Phone OTP (Termii) · **Video**: Whereby Embedded · **SORF**: Full lifecycle including telemedicine

What's inside:
- PRD with 3 personas (patient Chidi, doctor Dr. Ngozi, clinic admin Emeka) and 15 features including USSD appointment status (P2)
- Architecture: Expo + Next.js + Supabase + Whereby + Paystack + Termii — 12-service inventory
- Full Postgres schema — 20+ tables including `doctor_profiles` with `mdcn_number` verification, `medical_specialty` enum, `appointment_type` enum (video/in_person), SORF 9-state `booking_status`, `EXCLUDE USING gist` on `(staff_id, branch_id)`, `availability_windows` + `availability_overrides`, `waitlist_entries` with cancellation trigger, `loyalty_accounts` + `loyalty_transactions`, `branch_kpis` materialised view
- `businesses.deposit_policy` (50% default), `cancellation_policy` (free >24h), `no_show_policy` (3 strikes → prepayment) as jsonb
- 10 API endpoints: send-otp, verify-otp, search-doctors (PostGIS), book-slot (SORF held), Paystack HMAC webhook, PATCH booking status (doctor-driven), credit-loyalty (idempotent), join-video (Whereby room), branch-kpis
- SORF state machine: `pending → held → confirmed → checked_in → in_progress → completed | cancelled | no_show | disputed`
- 16 automation events including `video.room_created`, `ai.rebook_nudge` (WhatsApp 90-day follow-up), `ai.noshow_risk` daily scoring
- 8 pg_cron jobs: hold expiry (5 min), no-show check (15 min), 24h/2h reminders, KPI refresh, batch payouts, AI scoring (22:00), rebook nudges (09:00)
- Monetization in NGN: 10% commission, Solo Pro ₦5,000/mo, Clinic ₦15,000/mo, Enterprise ₦50,000/mo; projections to ₦18.7M MRR at 10k consultations/month
- Scaling: Supabase Pro → Team → Enterprise; Kenya expansion with M-Pesa + Africa's Talking at 1M consultations
- Quarterly roadmap: Q1 2027 Lagos launch → Q2 loyalty + Clinic subscriptions → Q3 AI operations → Q1 2028 Kenya

---

### `fitbook-gym-nigeria.md`
**Prompt**: "Design a multi-tenant gym and fitness class booking platform for Nigeria called FitBook. Members book group fitness classes (yoga, HIIT, spin) or one-on-one personal training sessions. Monthly membership subscriptions via Paystack Recurring. Drop-in class packs sold separately. QR code check-ins at the gym door. Trainers set their own weekly schedules. Loyalty points per class attended. No-show policy after 3 missed classes. Full system architecture."

**Market**: Nigeria · **Currency**: NGN · **Payments**: Paystack (one-time + Recurring subscriptions) · **Auth**: Phone OTP (Termii) · **SORF**: Full lifecycle including class + PT models

What's inside:
- PRD with 3 personas (member Tunde, trainer Coach Adaeze, gym owner Bisi) and 16 features (P0/P1/P2)
- Dual booking model: group class capacity (`class_enrollments` with atomic `FOR UPDATE` count check) + 1:1 PT sessions (`bookings` with EXCLUDE USING gist)
- Full Postgres schema — 22 tables: `class_types`, `class_sessions` (EXCLUDE gist on trainer schedule), `class_enrollments` (capacity enforcement), `memberships` with `paystack_sub_code`, `check_ins`, `member_profiles.check_in_code` UUID for QR
- SORF 9-state `booking_status` enum on PT `bookings`; `enrolled_count + max_capacity` pattern on `class_sessions`
- `availability_windows` + `availability_overrides` for trainer schedules; `waitlist_entries` with cancellation trigger
- `loyalty_accounts` + `loyalty_transactions` (idempotent per enrollment); `branch_kpis` materialised view
- 13 API endpoints: phone OTP, search-classes (PostGIS, filters), book-class (atomic capacity), book-pt-slot (SORF held), Paystack webhook (HMAC), QR check-in, subscription webhook, loyalty balance, cancel-enrollment
- Paystack Recurring (plan + subscription code): monthly membership auto-charge with `paystack_sub_code` stored on `memberships`
- `check_class_capacity()` trigger with `FOR UPDATE` row lock prevents concurrent over-enrollment
- 9 pg_cron jobs including PT hold expiry, no-show check, class reminders, membership renewal reminders, branch KPI refresh, AI churn scoring
- Monetization in NGN: Drop-in ₦3,500, 10-class pack ₦22,000, unlimited monthly ₦15,000, PT ₦10,000–₦25,000; 8% platform fee; projections to ₦12.4M MRR
- Quarterly roadmap: Q1 2027 Lagos launch → Q2 loyalty + class packs → Q3 AI scheduling → Q4 Abuja/PH expansion

---

### `homepro-nigeria.md`
**Prompt**: "Design a multi-tenant on-demand home services platform for Nigeria called HomePro. Customers book verified providers for home cleaning, plumbing, electrical repairs, AC servicing, and painting. Providers complete a background check before listing. Customers pay a 30% deposit via Paystack to hold the slot. Provider GPS location is shared in real-time from dispatch to arrival. Before and after photo evidence uploaded to Supabase Storage. Multi-city: Lagos, Abuja, Port Harcourt."

**Market**: Nigeria · **Currency**: NGN · **Payments**: Paystack · **Auth**: Phone OTP (Termii) · **Vertical**: Home services dispatch

What's inside:
- Background check gate: `provider_profiles.background_check_status` enum — providers cannot be booked unless 'passed'
- GPS tracking: `gps_pings` append-only table with future-timestamp guard; Supabase Realtime channel per booking
- Job evidence: `job_photos` table with `photo_type` enum (before/after/damage), private `job-evidence` Storage bucket
- Service quotes: `service_quotes` table — provider submits estimate before customer confirms
- 22-table schema covering all SORF invariants: `bookings` (EXCLUDE USING gist), `availability_windows` + `availability_overrides`, `waitlist_entries` (with `notify_waitlist` trigger), `loyalty_accounts` + `loyalty_transactions`, `branch_kpis` matview
- `deposit_policy` + `no_show_policy` jsonb on `businesses` (30% deposit default; second no-show → prepayment required)
- Cash payment tracking alongside Paystack card + USSD (mixed payment methods by provider)
- 10 API endpoints including send-otp, book-slot (SORF held + 30% deposit), paystack-webhook (HMAC), GPS-ping, upload-job-photo, complete-booking
- Monetization in NGN: 15% platform fee, Pro Provider ₦8,000/month, Property Manager ₦25,000/month; ₦5.9M MRR at 500 jobs/day
- Quarterly roadmap: Q3 2026 Lagos launch → Q4 quotes + Abuja/PH → Q1 2027 AI dispatch → Q2 franchising

---

### `sparkwash-nigeria-ghana.md`
**Prompt**: "Design a multi-location car wash and auto-detailing chain for Nigeria and Ghana called SparkWash. Customers book express or premium detailing slots. Monthly membership passes via Paystack Recurring (Nigeria) and MTN MoMo (Ghana). Walk-in queue management runs alongside pre-booked appointments. Loyalty stamp card: 10 washes earn 1 free wash. Branch managers see a live queue dashboard."

**Markets**: Nigeria (NGN) + Ghana (GHS) · **Payments**: Paystack (NGN) + MTN Mobile Money (GHS) · **Auth**: Phone OTP (Termii) · **Vertical**: Car wash chain

What's inside:
- Dual booking modes: pre-booked appointments (staff assignment + EXCLUDE USING gist) and walk-in queue (`walkin_queue` table with Supabase Realtime live position)
- Multi-currency schema: `payment_transactions.currency` enum (NGN/GHS); branch-level `currency` field routes payments to Paystack or MTN MoMo
- Paystack Recurring: `memberships.paystack_sub_code`, handles `subscription.create`, `invoice.payment_failed`, `subscription.disable` webhooks
- MTN MoMo Collections API for GHS: `initiateMomoPayment` + HMAC-SHA-256 callback verification
- 10-wash stamp card: `loyalty_accounts.stamp_count`; every 10th stamp auto-credits `free_washes_available` via `loyalty_transactions`
- 20-table schema: all SORF invariants including `availability_windows`, `availability_overrides`, `waitlist_entries`, `notify_waitlist` trigger, `branch_kpis` matview refreshed every 15 min
- `walkin_queue` broadcasts to Supabase Realtime channel `walkin_queue:{branch_id}` for live queue position display
- Monetization in NGN + GHS: Express Wash ₦3,500 / GHS 35; Unlimited Wash ₦15,000/month; Premium Club ₦45,000/month; ₦87M MRR at 10 Nigeria branches
- Quarterly roadmap: Q3 2026 launch → Q4 memberships + fleet → Q1 2027 dynamic pricing + Ghana recurring → Q2 Rwanda/Uganda

---

### [`cutculture-barbershop-nigeria.md`](./cutculture-barbershop-nigeria.md)

**Markets**: Nigeria (NGN) · **Payments**: Paystack (card + USSD) + Termii SMS · **Auth**: Phone OTP (Termii) · **Vertical**: Barbershop franchise chain

What's inside:
- 5-stamp loyalty card: every 5th haircut free; `awardStamp()` Edge Function is fully idempotent via `idempotency_key`
- Franchise royalty model: 5% of GMV per branch; `franchise_royalty_accounts` table tracks per-branch balances; monthly settlement automation
- Slot conflict prevention: `EXCLUDE USING gist` on `(barber_id, branch_id, tstzrange(starts_at, ends_at, '[)'))` — prevents double-booking at DB level
- No-show policy: 2-strike system stored as `no_show_policy` jsonb on `businesses`; 3rd offence triggers `require_prepayment` flag on customer profile
- Portfolio photos: `job_photos` table with `photo_type IN ('before','after','portfolio')` for stylist galleries stored in private Supabase Storage bucket
- `notify_waitlist()` trigger fires on `status IN ('cancelled','no_show')` — promotes next waitlisted customer and dispatches Termii SMS
- `pg_cron` `mark_noshows` job: fires 30 min after appointment end, transitions `in_progress → no_show` for absent customers
- `branch_kpis` materialised view refreshed every 15 min: daily revenue, appointment count, no-show rate, top barber
- 18 tables covering all SORF invariants: `availability_windows`, `availability_overrides`, `waitlist_entries`, `loyalty_accounts`, `loyalty_transactions`, `automation_jobs`
- Monetization: ₦35,000/month/branch SaaS + 5% royalty + ₦150,000 onboarding fee; ₦4,850,000/month MRR at 20 branches
- Quarterly roadmap: Q3 2026 Lagos pilot → Q4 5-branch franchise → Q1 2027 AI style matching → Q2 West Africa expansion

---

### [`cleanrun-laundry-nigeria.md`](./cleanrun-laundry-nigeria.md)

**Markets**: Nigeria (NGN) · **Payments**: Paystack (card + bank transfer + USSD) · **Auth**: Phone OTP (Termii) · **Vertical**: Laundry pickup & delivery SaaS

What's inside:
- GPS rider tracking: `gps_pings` append-only table; `guard_gps_ping_timestamp` trigger rejects future timestamps > 30s; `deny_gps_ping_mutation` triggers block UPDATE/DELETE; `latest_gps_pings` view for dispatch map; Supabase Realtime broadcasts on `gps:booking:{id}` channel
- Before/after condition photos: `job_photos` table with `photo_type` enum (before/after/damage); private Storage bucket `job-photos`; signed URLs with 15-minute TTL served via Edge Function
- Weight-based pricing: `pricing_rules` table with `price_per_kg` and `price_per_item`; deposit collected at booking (50% via `deposit_policy` jsonb); balance payment link sent via Termii SMS after rider weigh-in
- Dual-rider model: `bookings.rider_id` (pickup) and `bookings.delivery_rider_id` (delivery); `EXCLUDE USING gist` conditional on `rider_id IS NOT NULL` to support unassigned bookings
- `pg_cron` job archives GPS pings older than 30 days to prevent table bloat
- `notify_waitlist()` trigger + `track_customer_no_show()` trigger for 2-strike no-show policy
- Full `automation_jobs` suite: pickup reminders (24h + 2h), rider ETA SMS, ready-for-delivery, delivery confirmation, balance payment link
- 17 tables: all SORF invariants including `availability_windows`, `availability_overrides`, `waitlist_entries`, `loyalty_accounts`, `branch_kpis` matview
- Monetization: ₦1,500/kg standard · ₦2,000/kg express · 10% platform commission · ₦25,000/month/branch SaaS; ₦4,150,000/month MRR at 10 branches

---

## How to Read These Files

Each section is self-contained — you can jump directly to what you need:
- **Building the DB?** → Section 3 (SQL Schema)
- **Building the API?** → Section 4 (API Definitions)
- **Setting up CI/CD?** → Section 8 (Deployment Plan)
- **Pitching to investors?** → Section 1 (PRD) + Section 9 (Monetization) + Section 11 (Roadmap)

## Adding Your Own

If you generate a package with the Kajola skill, add it here:
1. Save the output as `examples/<platform-name>.md`
2. Add an entry to this README with the prompt used, market, and a brief summary
3. Open a PR — community examples are welcome
