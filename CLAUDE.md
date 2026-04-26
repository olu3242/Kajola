# Kajola — Codebase Guide

This repo is a Claude Code skill. It contains no application code — only instruction files that Claude reads to generate system architecture packages.

## How the Skill Works

When Claude Code loads this skill, it reads `SKILL.md` as its instruction set. When a user describes a platform, Claude follows those instructions to generate a complete 11-section architecture document. The `references/` files are cited inline in `SKILL.md` — Claude draws on them for SQL patterns and output formatting.

## File Map

```
SKILL.md                        Core instruction set. Start here.
references/sql-patterns.md      Reusable Postgres patterns (copy-paste ready)
references/output-template.md   Exact formatting guide for all 11 output sections
evals/evals.json                Test cases — 6 scenarios, 46 assertions
examples/                       Full generated outputs (reference / demo)
```

## Updating the Skill

**To add a new Africa-first default** (e.g. a new payment provider):
1. Add the provider to the "Default Tech Stack" table in `SKILL.md`
2. Add it to the "Africa-First Defaults → Payments" section in `SKILL.md`
3. Add it to the service inventory template in `references/output-template.md`
4. Add an assertion to a relevant eval case in `evals/evals.json`

**To add a new output section** (beyond the current 11):
1. Add the section to the numbered list in `SKILL.md` under "Output Format"
2. Add a section template to `references/output-template.md`
3. Add assertions covering the new section to at least two eval cases in `evals/evals.json`
4. Update the section count in `README.md`

**To add a new SQL pattern:**
1. Add the pattern block to `references/sql-patterns.md` under the appropriate heading
2. Reference it in `SKILL.md` if it should be applied by default (e.g. "use audit log pattern from references/sql-patterns.md")

**To add a new eval case:**
1. Add a new object to the `cases` array in `evals/evals.json`
2. Follow the existing schema: `id`, `name`, `prompt`, `expected_sections`, `assertions`
3. Each assertion needs `id`, `description`, and either `check` (what must be present) or `must_not_contain` (what must be absent)

## Running Evals

Evals are not automated yet. To manually evaluate the skill:

1. Install the skill in a Claude Code project
2. Run each prompt from `evals/evals.json` → `cases[*].prompt`
3. Check the output against the assertions in `cases[*].assertions`
4. A case passes if ≥ 85% of its assertions pass
5. The skill passes overall if all 6 cases pass

## Skill Quality Bar

Every update to `SKILL.md` must preserve these invariants:
- Phone OTP remains the primary auth method (not email)
- Every generated SQL table has RLS enabled
- Booking conflict prevention is at DB level (trigger or exclusion constraint), not application level
- No output section can produce placeholder text (TBD, TODO, X%, etc.)
- The Assumptions block is always generated at the end of every output

## Repo Conventions

- Branch: `claude/project-setup-bJgK8` is the active development branch
- Commit messages describe the *why*, not just the *what*
- No application code belongs in this repo — if you find yourself writing TypeScript or Python, it belongs in a generated example under `examples/`, not at root
