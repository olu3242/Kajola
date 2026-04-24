# Kajola — Production Platform Architect Skill

> One prompt. Full system architecture. Zero placeholders.

**Kajola** is a Claude skill that generates complete, production-ready system architecture packages for multi-tenant platforms — with African market patterns baked in by default.

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

### Claude Code (Recommended)

```bash
# 1. Create your skills directory
mkdir -p .claude/skills

# 2. Clone this repo into it
git clone https://github.com/femi-adeyemo/kajola-skill.git .claude/skills/kajola

# 3. Or as a submodule for easy updates
git submodule add https://github.com/femi-adeyemo/kajola-skill.git .claude/skills/kajola
```

### Manual .skill File

Download `production-platform-architect.skill` from [Releases](../../releases) and install via Claude Code → Settings → Skills → Install from file.

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
marketplace for East African construction companies. Multi-tenant.
M-Pesa payments. Full package.
```

---

## Skill Structure

```
production-platform-architect/
├── SKILL.md                        # Main skill instructions (~300 lines)
├── references/
│   ├── sql-patterns.md             # Reusable SQL: triggers, RLS, PostGIS, slot gen
│   └── output-template.md          # Structured output template for all 11 sections
└── evals/
    └── evals.json                  # Test cases for skill validation
```

---

## Tech Stack Defaults

| Layer | Default |
|-------|---------|
| Web Dashboard | Next.js 14 (App Router) |
| Mobile App | Expo SDK 51 (React Native) |
| Backend | Supabase (Postgres + Auth + Storage + RLS) |
| API Logic | Supabase Edge Functions (Deno) |
| Styling | Tailwind CSS |
| Monorepo | Turborepo |
| Payments | Paystack (MVP) + Flutterwave + M-Pesa |
| SMS | Termii (primary) / Twilio (fallback) |

Override any of these by specifying your preferred stack in the prompt.

---

## Quality Standards

Kajola enforces a zero-placeholder quality bar:

- ✅ Every SQL table has named indexes, explicit FK constraints, and RLS policies
- ✅ Every API endpoint has auth requirement, request schema, response schema, and error cases  
- ✅ Every env var is listed with its description
- ✅ Booking conflict prevention is enforced at trigger level (not application level)
- ✅ Automation runs are idempotent — no duplicate processing

---

## License

MIT — use freely in personal and commercial projects.

---

## Author

Built by **Femi Adeyemo** ([@femi-adeyemo](https://github.com/femi-adeyemo)) · [EduRadius LLC](https://eduradius.com) · AI Product Architect
