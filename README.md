# Kajola — Production Platform Architect Skill

> One prompt. Full system architecture. Zero placeholders.

**Kajola** is a Claude skill that generates complete, production-ready system architecture packages for multi-tenant platforms — with African market patterns baked in by default. It also ships as a monorepo scaffold you can build on directly.

---

## What It Generates

When you describe your platform, Kajola outputs all 11 sections:

| # | Section | What's Included |
|---|---------|----------------|
| 1 | **PRD** | Vision, personas, P0/P1/P2 features, NFRs |
| 2 | **System Architecture** | ASCII layer diagram, all services and integrations |
| 3 | **Full SQL Schema** | Every table: enums, constraints, indexes, RLS policies, triggers |
| 4 | **API Definitions** | Method, path, auth, request/response, error cases |
| 5 | **Frontend Structure** | Next.js + Expo directory trees with component notes |
| 6 | **Monorepo Layout** | Turborepo structure: apps, packages, supabase/ |
| 7 | **Automation Engine** | Event system, idempotency, retry logic, cron jobs |
| 8 | **Deployment Plan** | Step-by-step setup, all env vars, CI/CD spec |
| 9 | **Monetization Strategy** | Transaction fees, tiers, featured listings with actual rates |
| 10 | **Scaling Plan** | Concrete actions at 10k / 100k / 1M users |
| 11 | **Roadmap** | Quarterly plan with business impact |

---

## Africa-First Defaults

Kajola automatically applies these patterns for any platform:

- **Payments**: Paystack (Nigeria) + Flutterwave (Pan-African) + M-Pesa (East Africa) + Cash tracking
- **Auth**: Phone OTP primary, WhatsApp OTP fallback — no email dependency
- **Notifications**: SMS-primary via Termii/Twilio
- **Mobile**: Android-first, large touch targets, skeleton screens
- **Connectivity**: Offline action queue + sync, lazy loading, low-data mode option
- **Multi-tenant**: RLS on every table, `current_user_tenant_id()` helper, super admin bypass

---

## Installation

### Claude Code Skill (Recommended)

```bash
# 1. Create your skills directory
mkdir -p .claude/skills

# 2. Clone this repo into it
git clone https://github.com/olu3242/Kajola.git .claude/skills/kajola

# 3. Or as a submodule for easy updates
git submodule add https://github.com/olu3242/Kajola.git .claude/skills/kajola
```

Once installed, Claude Code will automatically load the skill when you start a session in any project that has `.claude/skills/kajola` present.

---

## Usage

Simply describe your platform and Claude will generate the full package:

```
Design the full system architecture for [your product name].
It's a [description]. Users are [roles]. We need [key features].
Target market: [region]. Stack: [preferences or use defaults].
```

### Example Prompts

```
Design a multi-tenant artisan booking platform for Nigeria called Kajola.
Artisans (barbers, tailors, mechanics) create profiles and get booked.
Clients discover and pay via Paystack. Need full system architecture.
```

```
Build the complete system design for ToolHire Pro — an equipment rental
marketplace for Nigerian construction companies. Multi-tenant.
Paystack payments. Full package.
```

---

## Skill Structure

```
kajola/
├── SKILL.md                        # Main skill instructions (549 lines)
├── references/
│   ├── sql-patterns.md             # Reusable SQL: triggers, RLS, PostGIS, slot gen
│   └── output-template.md          # Structured output template for all 11 sections
├── evals/
│   └── evals.json                  # 6 test cases, 45 assertions
└── examples/
    ├── README.md                   # Examples index
    ├── kajola-artisan-platform.md  # Full output: artisan booking marketplace (Nigeria)
    └── toolhire-pro-nigeria.md     # Full output: equipment rental marketplace (Nigeria)
```

---

## Monorepo Scaffold

This repo also ships as a Turborepo monorepo scaffold for teams building a Kajola-style platform directly:

### Workspaces

| Workspace | Purpose |
|---|---|
| `apps/web` | Next.js 14 dashboard (App Router) |
| `apps/mobile` | Expo 51 mobile app (React Native) |
| `packages/ui` | Shared UI primitives |
| `packages/api` | Shared API types and clients |
| `packages/db` | Schema helpers and migration tooling |
| `packages/automation` | Event automation engine |
| `supabase/` | Postgres migrations and Edge Functions |

### Getting Started

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in your Supabase, Paystack, and Termii credentials

# Start development
npm run dev
```

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start all apps in development mode |
| `npm run build` | Build all packages and apps |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | Type-check all workspaces |

> The scaffold is intentionally minimal. Use the Kajola skill to generate the full migrations, Edge Functions, and API implementations for your specific platform.

---

## Tech Stack Defaults

| Layer | Default |
|-------|---------|
| Web Dashboard | Next.js 14 (App Router) |
| Mobile App | Expo SDK 51 (React Native) |
| Backend | Supabase (Postgres + Auth + Storage + RLS) |
| API Logic | Supabase Edge Functions (Deno) |
| Styling | Tailwind CSS + shadcn/ui |
| Monorepo | Turborepo |
| Payments | Paystack (MVP) + Flutterwave + M-Pesa |
| SMS | Termii (primary) / Twilio (fallback) |

Override any of these by specifying your preferred stack in the prompt.

---

## Quality Standards

Kajola enforces a zero-placeholder quality bar:

- ✅ Every SQL table has named indexes, explicit FK constraints, and RLS policies
- ✅ Every API endpoint has auth requirement, request schema, response schema, and error cases
- ✅ Every env var is listed with its description and source
- ✅ Booking conflict prevention is enforced at DB level (`EXCLUDE USING gist`), not application level
- ✅ Automation runs are idempotent — no duplicate processing
- ✅ Section 9 monetization contains real numbers, not `X%` or `TBD`

---

## License

MIT — use freely in personal and commercial projects.

---

## Author

Built by **Femi Adeyemo** ([@femi-adeyemo](https://github.com/femi-adeyemo)) · [EduRadius LLC](https://eduradius.com) · AI Product Architect
