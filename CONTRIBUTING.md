# Contributing to Kajola

Kajola is Africa's Service Commerce & Appointment Operating System. All contributions should reinforce the Service Operations Reliability Framework (SORF) and the Africa-first defaults that make generated platforms production-ready on day one.

## Ways to Contribute

- Add a generated example under `examples/`
- Extend `references/sql-patterns.md` or `references/api-patterns.md` with new patterns
- Add eval cases to `evals/evals.json`
- Improve `SKILL.md` instructions
- Fix bugs in the validator (`scripts/validate-skill.sh`)

## Adding an Example

1. Run a prompt through the Kajola skill in a Claude Code project that has this skill installed
2. Save output as `examples/<platform-name>.md`
3. Add an entry to `examples/README.md` — include the exact prompt used, market, currency, payment provider, and a summary of what's inside (see existing entries as a template)
4. Open a PR

Community examples must pass the same quality bar as the built-in examples — no placeholders, real numbers in Section 9, SORF booking states in the schema.

## Adding a SQL or API Pattern

1. Add the pattern block under the appropriate heading in the relevant `references/` file
2. If it should apply by default to every generated platform, reference it in `SKILL.md`
3. Add at least one assertion in `evals/evals.json` that verifies it appears in relevant generated outputs
4. Run `scripts/validate-skill.sh` to confirm it passes

## Adding an Eval Case

Eval cases are the quality gate for the skill. Follow this schema:

```json
{
  "id": "eval-011",
  "name": "Short descriptive name (market + domain)",
  "prompt": "Full prompt text exactly as you would give it to Kajola",
  "expected_sections": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "assertions": [
    {
      "id": "a011-01",
      "description": "What this assertion verifies",
      "check": "exact substring or grep pattern that must appear in the output"
    },
    {
      "id": "a011-02",
      "description": "What must NOT be present",
      "must_not_contain": ["TBD", "TODO", "X%"]
    }
  ]
}
```

Rules for eval cases:
- Each case needs ≥ 8 assertions (recommend 10–12)
- Pass threshold: ≥ 85% of assertions pass
- The skill passes overall if all cases pass
- Always include a `must_not_contain` assertion for placeholder text
- Always include an assertion that the Assumptions block is present
- Include at least one assertion for the primary payment provider appearing in Section 3 or 4
- For booking platforms: include assertions for SORF states, `availability_windows`, and `EXCLUDE USING gist`

After adding a case, validate the JSON:
```bash
python3 -c "import json; d=json.load(open('evals/evals.json')); print(f'Valid — {len(d[\"cases\"])} cases, {sum(len(c[\"assertions\"]) for c in d[\"cases\"])} assertions')"
```

## Quality Invariants (never break these)

These invariants are enforced by `scripts/validate-skill.sh` and must hold in every generated output. Any change to `SKILL.md` that would violate them is a breaking change.

### Core invariants
- **Phone OTP is primary auth** — not email; email is optional profile field
- **Every SQL table has RLS enabled** — with at least one policy per table
- **Every SQL table has at least one non-PK index**
- **No placeholder text** in any output section (TBD, TODO, X%, YOUR_VALUE_HERE, etc.)
- **Assumptions block always generated** at the end of every output

### SORF booking invariants
- **9 SORF booking states** in every booking schema: `pending`, `confirmed`, `held`, `checked_in`, `in_progress`, `completed`, `cancelled`, `no_show`, `disputed`
- **Slot conflict prevention at DB level** via `EXCLUDE USING gist` on `(staff_id, branch_id)` — never in application code
- **Staff availability via `availability_windows`** (recurring weekly) + `availability_overrides` (one-off overrides) — never hardcoded hours
- **Deposit policy in `businesses.deposit_policy` jsonb** — enforced server-side
- **Waitlist trigger** fires on every booking cancellation or no-show
- **No-show tracking** on customer profile (`no_show_count`); flagged customers require prepayment

### Payment invariants
- **HMAC signature verification** on every payment webhook
- **Idempotency key** on every payment initiation
- **M-Pesa STK Push for C2B** (customer pays inbound); **M-Pesa B2C for payouts** (platform pays out) — never invert these

## PR Checklist

- [ ] `scripts/validate-skill.sh` passes (run from repo root)
- [ ] `python3 -c "import json; json.load(open('evals/evals.json'))"` exits 0
- [ ] No application code at repo root (TypeScript/Python belongs in `examples/`, not root)
- [ ] Commit messages describe the *why*, not the *what*
- [ ] If adding a new Africa-first default: update `SKILL.md`, `references/output-template.md`, and `evals/evals.json` (see `CLAUDE.md` → "Updating the Skill")
