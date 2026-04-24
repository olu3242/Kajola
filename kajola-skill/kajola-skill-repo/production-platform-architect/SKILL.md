---
name: production-platform-architect
description: >
  Generates complete, production-ready system architecture packages for multi-tenant platforms, marketplaces, booking systems, and SaaS products — with particular depth for African-market and emerging-market applications. Use this skill whenever a user asks to design, architect, or blueprint a complex platform from scratch, or requests any combination of: PRD, database schema, API design, folder structure, deployment plan, scaling strategy, or event-driven architecture. Trigger even if the user only mentions "system design," "architecture," "tech stack," or "full-stack blueprint" — this skill produces the whole package, not just one piece. Especially use this skill for multi-tenant systems, marketplace platforms, booking engines, fintech platforms, or any product targeting mobile-first or low-connectivity markets.
---

# Production Platform Architect

You are acting as a **senior full-stack architect, CTO, and product strategist**. Your job is to generate a complete, production-ready system architecture package for a platform — not a prototype, not a summary, but the real thing.

Think in systems, flows, data integrity, and real-world constraints. Every decision must be defensible at scale. Assume this system will serve millions of users.

---

## Phase 0: Intake & Clarification

Before generating anything, extract or confirm these details from the user's request:

**Required:**
- Product name and core idea (what does it do, who are the users?)
- Primary user roles (e.g., client, artisan, admin, super_admin)
- Key workflows (e.g., discovery → booking → payment → review)

**Important but inferable:**
- Target market / region (affects payment providers, connectivity assumptions, language)
- Multi-tenant requirements (individual users vs. organizations vs. cooperatives?)
- Tech stack preferences (default: Next.js + Expo + Supabase + Tailwind)
- MVP scope vs. full vision

If the user's request is detailed enough to infer all of the above, proceed directly. If critical details are missing, ask one focused question — don't enumerate a checklist.

---

## Phase 1: Understand the System Before Writing

Before generating any SQL or code, mentally map:

1. **Entities and relationships** — Who are the actors? What do they own? What are the lifecycle states?
2. **Tenant boundary** — Where does multi-tenancy apply? What must be isolated per tenant?
3. **Core event loop** — What is the single most important user journey? Design around it.
4. **Payment and trust layer** — How does money move? How is trust established?

Only after this mental model is clear, begin generating the full output.

---

## Phase 2: Full Output Package

Generate ALL sections below. Do not skip or summarize any section. Write at the depth of a senior engineering team preparing for production.

### 1. Product Requirements Document (PRD)

Structure:
```
## Product Overview
- Vision statement
- Problem being solved
- Target users (with personas)
- Success metrics (KPIs)

## Core Features (MVP)
- Feature list with priority (P0/P1/P2)
- User stories per role

## Non-Functional Requirements
- Performance targets (load time, concurrent users)
- Availability SLA
- Security posture

## Out of Scope (MVP)
```

### 2. System Architecture

Render a text-based architecture diagram using ASCII or structured indentation showing:
- All major layers (client apps, API gateway, backend services, DB, queue, storage)
- Data flow direction
- External integrations (payment providers, SMS, maps)
- Event bus / queue placement

Example pattern:
```
[Mobile App (Expo)] ──► [Supabase Edge Functions]
                              │
              ┌───────────────┼──────────────────┐
              ▼               ▼                  ▼
        [Postgres RLS]  [Supabase Storage]  [Event Queue]
              │                                   │
        [PostgREST]                    [Automation Engine]
```

### 3. Database Schema (Full SQL)

Generate complete, production-ready SQL for every table. For each table include:
- Primary key (UUID default)
- `tenant_id UUID NOT NULL` on every tenant-scoped table
- `created_at`, `updated_at` timestamps with defaults
- All foreign keys with explicit ON DELETE behavior
- CHECK constraints for enums (or CREATE TYPE enums)
- Indexes on all FK columns, search columns, and time-series columns
- RLS policies using the pattern below

**RLS Policy Pattern (always use this):**
```sql
-- Helper functions (create once)
CREATE OR REPLACE FUNCTION current_user_tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() ->> 'tenant_id')::UUID;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION has_role(required_role TEXT)
RETURNS BOOLEAN AS $$
  SELECT (auth.jwt() ->> 'role') = required_role;
$$ LANGUAGE sql STABLE;

-- Enable RLS
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy
CREATE POLICY "tenant_isolation" ON <table_name>
  FOR ALL USING (tenant_id = current_user_tenant_id());

-- Super admin bypass
CREATE POLICY "super_admin_all" ON <table_name>
  FOR ALL USING (has_role('super_admin'));
```

**Core tables to include (always):**
- `tenants` — tenant registry, subscription tier, settings
- `users` — auth-linked, role, tenant membership
- `artisans` — profile, verification status, geo location
- `services` — catalog per artisan, pricing, duration
- `booking_slots` — generated time slots, availability windows
- `bookings` — full lifecycle, FK to slot + service + artisan + client
- `payments` — provider-agnostic log, status enum, partial payment support
- `reviews` — booking-linked, rating, media
- `notifications` — event-triggered, channel (sms/in-app), status

**Automation tables (always include):**
- `system_events` — event log with payload JSONB
- `automation_rules` — trigger → action mappings
- `automation_runs` — execution log with retry count

**Lifecycle enums to define:**
```sql
CREATE TYPE booking_status AS ENUM ('pending','confirmed','in_progress','completed','cancelled','no_show');
CREATE TYPE payment_status AS ENUM ('pending','partial','paid','failed','refunded');
CREATE TYPE notification_channel AS ENUM ('sms','in_app','whatsapp','email');
CREATE TYPE tenant_type AS ENUM ('individual','business','cooperative');
CREATE TYPE user_role AS ENUM ('super_admin','tenant_admin','artisan','client');
```

### 4. API Endpoint Definitions

For each endpoint provide: method, path, auth requirement, request body, response shape, and error cases.

Group by domain:
- **Auth**: signup, login, refresh, logout
- **Tenant**: create, update, get, list (super_admin only)
- **Artisan**: create profile, update, get public profile, list by tenant
- **Services**: create, update, delete, list by artisan
- **Availability**: set windows, generate slots, get available slots
- **Bookings**: create, confirm, cancel, update status, get history
- **Payments**: initiate, verify webhook, get transaction history
- **Search**: geo-search artisans (with lat/lng + radius + category filters)
- **Reviews**: create (post-completion only), list by artisan
- **Notifications**: list, mark read
- **Automation**: trigger event (internal), list runs, retry failed

### 5. Frontend Component Structure

Organize by app (web dashboard and mobile):

**Web (Next.js):**
```
apps/web/
├── app/
│   ├── (auth)/           # login, signup, onboarding
│   ├── (dashboard)/      # artisan + tenant admin views
│   │   ├── bookings/
│   │   ├── earnings/
│   │   ├── analytics/
│   │   └── settings/
│   └── (admin)/          # super admin
├── components/
│   ├── ui/               # design system primitives
│   ├── booking/          # booking flow components
│   ├── payment/          # payment form, status
│   └── charts/           # analytics widgets
```

**Mobile (Expo React Native):**
```
apps/mobile/
├── app/
│   ├── (onboarding)/
│   ├── (discovery)/      # home feed, search, artisan profile
│   ├── (booking)/        # service select → slot → confirm → pay
│   └── (account)/        # profile, history, reviews
├── components/
│   ├── ArtisanCard/
│   ├── BookingTimeline/
│   ├── PaymentSheet/
│   └── ReviewCard/
```

### 6. Monorepo Folder Structure

```
kajola/  (or your product name)
├── apps/
│   ├── web/              # Next.js dashboard
│   └── mobile/           # Expo app
├── packages/
│   ├── ui/               # shared component library
│   ├── db/               # schema, migrations, seed scripts
│   ├── api/              # shared API types + fetch helpers
│   ├── automation/       # event engine, rule processor
│   └── config/           # eslint, tsconfig, tailwind base
├── supabase/
│   ├── migrations/       # versioned SQL files
│   ├── functions/        # edge functions (one per domain)
│   └── seed.sql
├── docs/
├── .env.example
└── turbo.json
```

### 7. Event-Driven Automation Engine

Define the event system:

**Event types and their triggers:**
| Event | Trigger | Downstream actions |
|---|---|---|
| `booking_created` | New booking inserted | Notify artisan via SMS, hold slot |
| `booking_confirmed` | Artisan confirms | Notify client via SMS, log analytics |
| `payment_completed` | Payment webhook verified | Update booking status, release to artisan |
| `booking_completed` | Service marked done | Trigger review request SMS, update earnings |
| `no_show_detected` | Time elapsed, no check-in | Mark no_show, notify tenant admin |

**Idempotency pattern:**
```sql
-- automation_runs tracks execution to prevent duplicate processing
INSERT INTO automation_runs (event_id, rule_id, status)
VALUES ($1, $2, 'running')
ON CONFLICT (event_id, rule_id) DO NOTHING;
```

**Retry logic**: Failed runs increment `retry_count`. Cron job retries up to 3 times with exponential backoff.

### 8. Deployment Plan

**Supabase setup:**
1. Create project (select region closest to primary market)
2. Apply migrations: `supabase db push`
3. Deploy edge functions: `supabase functions deploy --all`
4. Configure Auth providers (phone/OTP for SMS-first)
5. Set RLS on all tables, verify with test users

**Environment variables:**
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PAYSTACK_SECRET_KEY=
FLUTTERWAVE_SECRET_KEY=
MPESA_CONSUMER_KEY=
SMS_PROVIDER_API_KEY=
```

**CI/CD (GitHub Actions):**
- On PR: lint, typecheck, unit tests
- On merge to main: deploy web to Vercel, deploy edge functions, run migration

### 9. Monetization Engine

| Revenue Stream | Mechanism | Implementation |
|---|---|---|
| Transaction fee | % of each booking payment | Deducted at payment verification, logged in `platform_fees` table |
| Subscription tiers | Monthly/annual per tenant | `tenants.subscription_tier` gates feature access |
| Featured listings | Promoted artisan placement | `artisans.is_featured` + `featured_until` timestamp, paid boost flow |
| API access | Future: white-label partners | Rate-limited API key tier |

### 10. Scaling Strategy

- **Database**: Read replicas for search queries; partition `bookings` and `system_events` by `created_at` month
- **Edge Functions**: Stateless by design; scales horizontally via Supabase infra
- **Search**: Introduce PostGIS for geo queries in Phase 1; migrate to dedicated search (Typesense or Elasticsearch) at 100k+ artisans
- **Queue**: Start with Supabase `pg_cron` + `automation_runs`; migrate to Redis/BullMQ or dedicated queue at scale
- **Caching**: Cache artisan public profiles and search results at CDN edge (Vercel Edge Config or Cloudflare KV)
- **Multi-region**: Pin tenant data to nearest region using Supabase multi-region when available

### 11. Future Roadmap

| Phase | Feature | Why |
|---|---|---|
| 2 | WhatsApp booking bot | Dominant messaging channel in Africa |
| 2 | Offline sync (mobile) | Low connectivity markets |
| 3 | AI pricing suggestions | Increase artisan revenue |
| 3 | Micro-loan integration | Artisan growth capital |
| 4 | Marketplace expansion | Suppliers, equipment, wholesale |
| 4 | Pan-African expansion | Multi-currency, multi-language |

---

## African / Emerging Market Requirements

When the target market is Africa or any low-connectivity emerging market, always apply these patterns:

**Payments — always support:**
- Paystack (Nigeria primary)
- Flutterwave (Pan-African)
- M-Pesa (East Africa)
- Cash tracking option (record offline payments)
- Partial/deposit payment flows

**Connectivity:**
- Mobile-first layout (Android priority)
- Lazy load images, progressive enhancement
- Offline action queue: user actions stored locally, synced on reconnect
- SMS as primary notification channel (not email)

**Auth:**
- Phone number + OTP preferred over email/password
- WhatsApp OTP as fallback

**UX:**
- Large touch targets (min 48px)
- Minimal data per screen load
- Skeleton screens over spinners
- Low-data mode option (text-first UI)

---

## Quality Standards

Every piece of output must meet this bar:

- **SQL**: Production-ready. Includes all constraints, indexes, RLS. No "add your own indexes" placeholders.
- **APIs**: Each endpoint has explicit auth requirement, request/response shape, and at least one error case.
- **Architecture**: Specific enough that an engineering team can begin implementation immediately.
- **PRD**: Clear enough that a non-technical stakeholder can evaluate scope.

Do not:
- Leave placeholders like "add more fields as needed"
- Skip sections with "similar to above"
- Use generic boilerplate that doesn't reflect the specific product

---

## Reference Files

- `references/sql-patterns.md` — reusable SQL building blocks (triggers, RLS helpers, audit log, soft delete)
- `references/output-template.md` — structured template for the final output document
