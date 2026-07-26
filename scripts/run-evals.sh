#!/usr/bin/env bash
# Kajola Eval Runner
# Prints each eval case with its prompt and assertions for manual testing.
# Run each prompt through the Kajola skill, then mark assertions as pass/fail.
#
# Usage:
#   bash scripts/run-evals.sh              # Print all cases (default)
#   bash scripts/run-evals.sh --checklist  # Print markdown checklist per case
#   bash scripts/run-evals.sh --case 7     # Print a specific case by number
#   bash scripts/run-evals.sh --summary    # Print case IDs and names only

set -euo pipefail

EVALS_FILE="evals/evals.json"
PASS_THRESHOLD=85
MODE="full"
FILTER_CASE=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --checklist) MODE="checklist"; shift ;;
    --summary)   MODE="summary";   shift ;;
    --case)      FILTER_CASE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

CASE_COUNT=$(python3 -c "import json; d=json.load(open('$EVALS_FILE')); print(len(d['cases']))")
TOTAL_ASSERTIONS=$(python3 -c "import json; d=json.load(open('$EVALS_FILE')); print(sum(len(c['assertions']) for c in d['cases']))")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Kajola Eval Runner"
echo "  Pass threshold: ${PASS_THRESHOLD}% per case"
echo "  Cases: ${CASE_COUNT}   Assertions: ${TOTAL_ASSERTIONS}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ "$MODE" == "summary" ]]; then
  python3 - <<'PYEOF'
import json
with open("evals/evals.json") as f:
    data = json.load(f)
for i, case in enumerate(data["cases"], 1):
    n_assertions = len(case["assertions"])
    print(f"  {i:2d}. [{case['id']}]  {case['name']}  ({n_assertions} assertions)")
print()
PYEOF
  exit 0
fi

python3 - "$MODE" "$FILTER_CASE" <<'PYEOF'
import json, sys, textwrap

mode        = sys.argv[1]
filter_case = sys.argv[2]  # "" = all, "N" = case number N (1-indexed)

with open("evals/evals.json") as f:
    data = json.load(f)

cases = data["cases"]
if filter_case:
    idx = int(filter_case) - 1
    if idx < 0 or idx >= len(cases):
        print(f"Error: case {filter_case} does not exist (1–{len(cases)})")
        sys.exit(1)
    cases = [cases[idx]]

for i, case in enumerate(cases):
    actual_index = data["cases"].index(case) + 1
    sep = "═" * 60

    if mode == "checklist":
        # ── Markdown checklist output ─────────────────────────────
        print(f"## Case {actual_index}: {case['name']}")
        print(f"**ID**: `{case['id']}`  |  **Assertions**: {len(case['assertions'])}")
        print()
        print("### Prompt")
        print("```")
        print(textwrap.fill(case["prompt"], width=72))
        print("```")
        print()
        print("### Assertions")
        print()
        for a in case["assertions"]:
            if a.get("check"):
                check_str = f"Must contain: `{a['check']}`"
            else:
                mnc = a.get("must_not_contain", [])
                check_str = f"Must NOT contain: `{mnc}`"
            print(f"- [ ] **[{a['id']}]** {a['description']}")
            print(f"  - {check_str}")
        print()
        min_pass = max(1, int(len(case["assertions"]) * 0.85))
        print(f"> **Pass threshold**: {min_pass}/{len(case['assertions'])} assertions must pass")
        print()
        print("---")
        print()
    else:
        # ── Full text output ──────────────────────────────────────
        print(sep)
        print(f"Case {actual_index}/{len(data['cases'])}: {case['name']}")
        print(f"ID: {case['id']}  |  Assertions: {len(case['assertions'])}")
        print(sep)
        print("PROMPT:")
        for line in textwrap.wrap(case["prompt"], width=72):
            print(f"  {line}")
        print()
        print(f"ASSERTIONS ({len(case['assertions'])}):")
        for a in case["assertions"]:
            if a.get("check"):
                check_line = f"→ MUST CONTAIN:     {a['check']}"
            else:
                mnc = a.get("must_not_contain", [])
                check_line = f"→ MUST NOT CONTAIN: {mnc}"
            print(f"  [{a['id']}] {a['description']}")
            print(f"         {check_line}")
        min_pass = max(1, int(len(case["assertions"]) * 0.85))
        print()
        print(f"  Pass when: ≥{min_pass}/{len(case['assertions'])} assertions hold")
        print()

if mode == "full":
    print("━" * 60)
    print("Run each prompt through the skill, then manually verify assertions.")
    print("Case passes if ≥85% of its assertions pass.")
    print("Skill passes overall if all cases pass.")
    print()
PYEOF
