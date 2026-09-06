# Launch validation

Kajola is currently approved for local controlled validation, not production launch.

Required release gates:

- [x] Unit coverage for orchestration primitives and domain calculations
- [x] Local booking golden flow reaches audited Definition of Done
- [x] Production web build succeeds
- [x] Full Playwright suite passes from a clean production-build server (38/38)
- [ ] Flow migration applies and passes linked Supabase lint
- [ ] Supabase repository and durable worker execute the golden flow
- [ ] Timer and worker restart recovery is demonstrated
- [ ] Duplicate and out-of-order live webhooks are safely absorbed
- [ ] Payment and notification provider sandboxes are configured
- [ ] Cross-tenant production RLS checks pass
- [ ] Planned framework upgrades clear the remaining 16 high and 17 moderate production dependency advisories

See `architecture/OS_CERTIFICATION.md` for the current decision and evidence.
