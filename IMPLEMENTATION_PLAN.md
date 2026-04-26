# Kajola Full Implementation Plan

## 1. Objective
Build a production-ready multi-tenant service marketplace platform based on Kajola’s architecture defaults: artisan discovery, booking, payments, reviews, and tenant administration for African markets.

This plan assumes the core product is a mobile-first marketplace with a web dashboard and mobile app, supporting artisans, clients, tenant admins, and super admins.

---

## 2. Product Scope

### Core MVP workflows
- Client discovers artisans by category, location, rating, and availability
- Client books a service, selects an available slot, and pays securely
- Artisan receives booking notifications, confirms service, and marks completion
- Client leaves a review after service completion
- Tenant admin and super admin manage users, artisans, services, bookings, and payouts

### Primary user roles
- `client` — service seeker
- `artisan` — service provider
- `tenant_admin` — business owner / marketplace operator
- `super_admin` — platform operator

### Key MVP features
- Registration and OTP login (phone-first)
- Artisan profile creation and service catalog
- Availability windows and slot generation
- Booking creation, confirmation, cancellation, status updates
- Payment initiation and verification
- Review submission after completed booking
- Notifications (SMS/in-app)
- Basic analytics dashboard for tenant admins
- RLS-based multi-tenancy and secure data isolation

---

## 3. Recommended Tech Stack

- Web dashboard: `Next.js 14` (App Router)
- Mobile app: `Expo SDK 51` / `React Native`
- Backend: `Supabase` (Postgres + Auth + Storage + Edge Functions)
- Styling: `Tailwind CSS`
- Monorepo: `Turborepo`
- Payments: `Paystack` (MVP), `Flutterwave`, `M-Pesa`
- SMS: `Termii` primary, `Twilio` fallback

---

## 4. Architecture Overview

### High-level architecture
- `apps/web` — Next.js dashboard for artisans, tenant admins, super admins
- `apps/mobile` — Expo app for clients and artisans
- `packages/api` — shared request/response types and fetch helpers
- `packages/db` — schema definition, migrations, seed scripts
- `packages/ui` — shared UI primitives and components
- `packages/automation` — event engine and rule processor
- `supabase/` — Postgres migrations, Edge Functions, seed data

### Core backend services
- Supabase Auth with JWT and RLS
- Supabase Postgres database with tenant-aware tables
- Edge Functions for secured business endpoints
- Server-side events / automation rules for notifications and payment processing

---

## 5. Data Model & Schema Plan

### Essential tables
- `tenants`
- `users`
- `artisans`
- `services`
- `availability_windows`
- `booking_slots`
- `bookings`
- `payments`
- `reviews`
- `notifications`
- `system_events`
- `automation_rules`
- `automation_runs`

### Required enums
- `user_role`
- `tenant_type`
- `booking_status`
- `payment_status`
- `notification_channel`

### Must-have constraints
- UUID primary keys with defaults
- `tenant_id UUID NOT NULL` on tenant-scoped tables
- explicit foreign keys with `ON DELETE` behavior
- indexes on FK columns, searchable fields, and timestamp columns
- `created_at` / `updated_at` with trigger updates
- RLS policies using `current_user_tenant_id()` and `has_role()` helper functions

---

## 6. API Surface

### Auth
- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/refresh`

### Tenant management
- `GET /tenants`
- `POST /tenants`
- `GET /tenants/:id`
- `PATCH /tenants/:id`

### Artisans & services
- `GET /artisans`
- `GET /artisans/:id`
- `POST /artisans`
- `PATCH /artisans/:id`
- `GET /artisans/:id/services`
- `POST /services`
- `PATCH /services/:id`
- `DELETE /services/:id`

### Availability and slots
- `POST /availability-windows`
- `GET /availability-windows`
- `POST /booking-slots/generate`
- `GET /booking-slots`

### Bookings
- `POST /bookings`
- `GET /bookings`
- `GET /bookings/:id`
- `PATCH /bookings/:id/status`
- `DELETE /bookings/:id`

### Payments
- `POST /payments/initiate`
- `POST /payments/webhook`
- `GET /payments/history`

### Search
- `GET /search/artisans`

### Reviews
- `POST /reviews`
- `GET /reviews`

### Notifications
- `GET /notifications`
- `PATCH /notifications/:id/read`

### Automation
- `POST /events/trigger`
- `GET /automation/runs`
- `POST /automation/runs/:id/retry`

---

## 7. Frontend Implementation Plan

### Web dashboard (`apps/web`)
- App shell with App Router and protected routes
- `auth` flows: login, OTP, onboarding
- `dashboard` views for tenant admins and artisans
- `bookings` pages with timeline and status actions
- `earnings` page with payout summary
- `analytics` widgets for volume, revenue, service demand
- `settings` for tenant configuration and team management
- `admin` section for super admin tenant oversight

### Mobile app (`apps/mobile`)
- Onboarding screens for new clients and artisans
- Discovery flow with search, filters, categories, and maps
- Artisan profile page with services, reviews, and availability
- Booking flow: service selection → slot selection → confirmation → payment
- Booking history and review submission
- Account page for profile, bookings, wallet, notifications

### Shared UI
- `packages/ui` with:
  - buttons, inputs, cards
  - form controls and validation states
  - toast / modal / sheet patterns
  - responsive layout tokens

---

## 8. Automation & Notifications

### Event-driven automation
Implement event triggers for:
- `booking_created`
- `booking_confirmed`
- `payment_completed`
- `booking_completed`
- `booking_cancelled`

### Automation actions
- send SMS or WhatsApp notification
- create in-app notification record
- update booking or availability state
- emit analytics event

### Retry + idempotency
- track `automation_runs`
- use unique event IDs and idempotent actions
- retry failed jobs with backoff

---

## 9. Deployment & Infrastructure

### Local / staging setup
- `supabase` local dev with `supabase start`
- `pnpm install` or `npm install`
- `npx turbo run dev`
- use `.env.local` and `.env` for secrets

### Production deployment
- Host web and API on `Vercel` or `Netlify`
- Host Expo web/mobile builds with `EAS` / `Expo Go`
- Use Supabase managed Postgres and Auth
- Configure payment webhook URLs and SMS provider secrets

### CI/CD
- GitHub Actions pipeline for:
  - linting and type-checking
  - schema migration validation
  - test suites
  - deploy web and edge functions
- include a `predeploy` step to verify env vars and schema

### Required environment values
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `PAYSTACK_SECRET_KEY`
- `FLUTTERWAVE_SECRET_KEY`
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `TERMII_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `NOTIFICATION_SMS_FROM`
- `NEXTAUTH_URL` / `EXPO_PUBLIC_APP_URL`

---

## 10. Phased Milestones

### Phase 0: Discovery + design
- finalize product definition and market assumptions
- create PRD and core user stories
- lock down tenant model and payment strategy

### Phase 1: Platform scaffolding
- scaffold monorepo with Turborepo
- initialize `apps/web`, `apps/mobile`, `packages/*`, `supabase/`
- set up Supabase project and schema migration folder

### Phase 2: Core backend + auth
- implement Supabase Auth and RLS helpers
- build core tables and migrations
- create payment and booking edge functions

### Phase 3: Web dashboard MVP
- build tenant admin and artisan flows
- implement booking management and analytics
- add settings and tenant configuration

### Phase 4: Mobile MVP
- build discovery, booking, payment, and history flows
- integrate reviews and notifications
- refine UI for low-connectivity and mobile-first experience

### Phase 5: Launch readiness
- end-to-end QA on staging
- load test booking and search flows
- deploy production Supabase and verify web/mobile builds
- monitor first transactions and user flows

---

## 11. Next Actions
1. Confirm the exact product concept, target market, and primary user journeys.
2. Choose whether to build the default Kajola artisan-booking marketplace or a different marketplace variant.
3. Scaffold the monorepo structure and initialize Supabase migrations.
4. Implement the core schema, auth, and booking API.
5. Build the first web and mobile screens around discovery, booking, and payment.

---

## 12. Notes
- The workspace already includes the Kajola architecture skill and output template, which is an excellent blueprint for the full system package.
- If you want, I can now generate the exact project tree and create the first scaffold files for `apps/web`, `apps/mobile`, `packages/db`, `packages/api`, and `supabase`.
