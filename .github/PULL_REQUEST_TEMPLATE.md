## Summary

<!-- What does this PR do? 2–4 bullet points. Be specific about which files changed and why. -->

-
-

## Type of change

- [ ] New example (`examples/`)
- [ ] New SQL / API pattern (`references/`)
- [ ] New eval case (`evals/evals.json`)
- [ ] SKILL.md improvement
- [ ] Bug fix (validator, script, or skill logic)
- [ ] Documentation update (README, CONTRIBUTING, CLAUDE.md)
- [ ] Other:

## Checklist

- [ ] `bash scripts/validate-skill.sh` passes (87/87 checks green)
- [ ] `python3 -c "import json; json.load(open('evals/evals.json'))"` exits 0
- [ ] No application code at repo root (TypeScript/Python belongs in `examples/`)
- [ ] No `.env` or credential files staged
- [ ] Commit messages describe the *why*, not the *what*

## SORF quality invariants (tick all that apply to this PR)

If this PR touches `SKILL.md` or any `references/` file, verify these hold:

- [ ] Phone OTP remains the primary auth method (not email)
- [ ] Every SQL table added/modified has RLS enabled with at least one policy
- [ ] `BookingStatus` enum contains all 9 SORF states (`pending`, `confirmed`, `held`, `checked_in`, `in_progress`, `completed`, `cancelled`, `no_show`, `disputed`)
- [ ] Booking conflict prevention uses `EXCLUDE USING gist` on `(staff_id, branch_id)` — not application code
- [ ] `availability_windows` + `availability_overrides` used for staff schedules (never hardcoded hours)
- [ ] Deposit policy stored in `businesses.deposit_policy` jsonb
- [ ] Waitlist trigger fires on cancellation and no-show
- [ ] No placeholder text (TBD, TODO, X%, YOUR_VALUE_HERE) in any generated output

## If this adds an eval case

- [ ] Prompt is a complete, realistic platform description
- [ ] At least 8 assertions included
- [ ] One `must_not_contain` assertion for placeholder text
- [ ] One assertion verifying the Assumptions block
- [ ] SORF booking states or Africa-first defaults tested if applicable
- [ ] `evals.json` validated as parseable JSON (see checklist above)

## If this adds an example

- [ ] Output uses real numbers in Section 9 (no `₦X,000` or `X%`)
- [ ] All 11 sections present
- [ ] Prompt used to generate it is noted in `examples/README.md`
- [ ] Market, currency, and payment provider are documented in `examples/README.md`
