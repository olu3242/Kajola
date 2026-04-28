# Contributing to Kajola

## Ways to Contribute

- Add a generated example under `examples/`
- Extend `references/sql-patterns.md` or `references/api-patterns.md`
- Add eval cases to `evals/evals.json`
- Improve `SKILL.md` instructions

## Adding an Example

1. Run a prompt through the Kajola skill
2. Save output as `examples/<platform-name>.md`
3. Add an entry to `examples/README.md` (prompt used, market, stack, brief summary)
4. Open a PR

## Adding a SQL or API Pattern

1. Add the pattern block under the appropriate heading in the relevant `references/` file
2. If it should apply by default, reference it in `SKILL.md`
3. Add at least one assertion in `evals/evals.json` that verifies it

## Adding an Eval Case

Follow the schema in `evals/evals.json`:

```json
{
  "id": "case-7",
  "name": "Short descriptive name",
  "prompt": "Full prompt text",
  "expected_sections": [1,2,3,4,5,6,7,8,9,10,11],
  "assertions": [
    { "id": "c7-1", "description": "...", "check": "string that must appear" }
  ]
}
```

- Each case needs ≥ 6 assertions
- Pass threshold: ≥ 85% of assertions per case

## Quality Invariants (never break these)

- Phone OTP is primary auth — not email
- Every SQL table has RLS enabled
- Booking conflict prevention at DB level only
- No placeholder text (TBD, TODO, X%, YOUR_VALUE_HERE) in any output section
- Assumptions block always generated at end of output

## PR Checklist

- [ ] `scripts/validate-skill.sh` passes locally
- [ ] No application code at repo root (TypeScript/Python belongs in `examples/`)
- [ ] Commit messages describe the *why*, not the *what*
