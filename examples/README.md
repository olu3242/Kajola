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
