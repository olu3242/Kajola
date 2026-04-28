#!/usr/bin/env bash
# Prints each eval prompt for manual testing. Run each prompt through
# the Kajola skill and check output against assertions in evals/evals.json.

set -euo pipefail

EVALS_FILE="evals/evals.json"
PASS_THRESHOLD=85

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Kajola Eval Runner"
echo "  Pass threshold: ${PASS_THRESHOLD}% per case"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CASE_COUNT=$(python3 -c "import json; d=json.load(open('$EVALS_FILE')); print(len(d['cases']))")
TOTAL_ASSERTIONS=$(python3 -c "import json; d=json.load(open('$EVALS_FILE')); print(sum(len(c['assertions']) for c in d['cases']))")

echo "Cases:      $CASE_COUNT"
echo "Assertions: $TOTAL_ASSERTIONS total"
echo ""

python3 - <<'PYEOF'
import json, textwrap

with open("evals/evals.json") as f:
    data = json.load(f)

for i, case in enumerate(data["cases"], 1):
    print(f"{'─'*40}")
    print(f"Case {i}/{len(data['cases'])}: {case['name']}")
    print(f"ID: {case['id']}")
    print(f"{'─'*40}")
    print("PROMPT:")
    print(textwrap.indent(case["prompt"], "  "))
    print()
    print(f"ASSERTIONS ({len(case['assertions'])}):")
    for a in case["assertions"]:
        check = a.get("check") or f"must NOT contain: {a.get('must_not_contain','')}"
        print(f"  [{a['id']}] {a['description']}")
        print(f"         → {check}")
    print()

print("━"*40)
print("Run each prompt through the skill, then manually verify assertions.")
print("Case passes if ≥85% of its assertions pass.")
print("Skill passes overall if all cases pass.")
PYEOF
