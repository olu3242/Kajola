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
