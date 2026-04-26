#!/usr/bin/env bash
# Validates the Kajola skill files for structural completeness.
# Exit code 0 = all checks passed. Non-zero = at least one check failed.

set -euo pipefail

PASS=0
FAIL=0
ERRORS=()

check() {
  local description="$1"
  local result="$2"   # "pass" or "fail"
  local detail="${3:-}"

  if [[ "$result" == "pass" ]]; then
    echo "  ✓ $description"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $description${detail:+ — $detail}"
    FAIL=$((FAIL + 1))
    ERRORS+=("$description")
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local description="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    check "$description" "pass"
  else
    check "$description" "fail" "pattern not found: '$pattern'"
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local description="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    check "$description" "fail" "forbidden pattern found: '$pattern'"
  else
    check "$description" "pass"
  fi
}

assert_file_exists() {
  local file="$1"
  local description="${2:-$file exists}"
  if [[ -f "$file" ]]; then
    check "$description" "pass"
  else
    check "$description" "fail" "file not found"
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Kajola Skill Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. File existence ────────────────────────────────────────────────────────
echo ""
echo "[ File existence ]"
assert_file_exists "SKILL.md"
assert_file_exists "references/sql-patterns.md"
assert_file_exists "references/output-template.md"
assert_file_exists "evals/evals.json"
assert_file_exists "CLAUDE.md"
assert_file_exists "README.md"

# ── 2. SKILL.md — all 11 section headers present ────────────────────────────
echo ""
echo "[ SKILL.md — section headers ]"
for i in 1 2 3 4 5 6 7 8 9 10 11; do
  assert_contains "SKILL.md" "SECTION $i" "Section $i header present"
done

# ── 3. SKILL.md — Africa-first defaults ─────────────────────────────────────
echo ""
echo "[ SKILL.md — Africa-first defaults ]"
assert_contains "SKILL.md" "Paystack"             "Paystack listed as default payment"
assert_contains "SKILL.md" "Termii"               "Termii listed as default SMS provider"
assert_contains "SKILL.md" "Phone OTP\|phone OTP\|Phone number.*OTP" "Phone OTP as primary auth"
assert_contains "SKILL.md" "M-Pesa"               "M-Pesa included for East Africa"
assert_contains "SKILL.md" "Flutterwave"          "Flutterwave included for pan-Africa"
assert_contains "SKILL.md" "offline\|Offline"     "Offline queue pattern mentioned"
assert_contains "SKILL.md" "ROW LEVEL SECURITY\|RLS" "RLS referenced"
assert_contains "SKILL.md" "current_user_tenant_id" "Multi-tenant helper function referenced"

# ── 4. SKILL.md — quality enforcement ───────────────────────────────────────
echo ""
echo "[ SKILL.md — quality enforcement ]"
assert_contains "SKILL.md" "Quality Enforcement\|quality enforcement" "Quality enforcement section present"
assert_contains "SKILL.md" "HMAC"                 "Webhook HMAC verification required"
assert_contains "SKILL.md" "idempotent\|idempotency" "Idempotency requirement present"
assert_contains "SKILL.md" "Assumptions Made\|Assumptions Block" "Assumptions block required"

# ── 5. SKILL.md — no placeholder text ───────────────────────────────────────
echo ""
echo "[ SKILL.md — no placeholders in instructions ]"
# Allow these words only in the Quality Enforcement checklist (as things to reject),
# not as actual values in the skill template itself.
# We check the file does not contain them as standalone tokens outside of quoted contexts.
assert_not_contains "SKILL.md" "YOUR_VALUE_HERE"              "No YOUR_VALUE_HERE placeholder"
assert_not_contains "SKILL.md" "coming soon\|fill in\|YOUR_KEY" "No fill-in placeholder text"

# ── 6. references/sql-patterns.md — key patterns present ────────────────────
echo ""
echo "[ references/sql-patterns.md — key patterns ]"
assert_contains "references/sql-patterns.md" "update_updated_at"       "updated_at trigger pattern present"
assert_contains "references/sql-patterns.md" "current_user_tenant_id"  "Tenant ID helper present"
assert_contains "references/sql-patterns.md" "ROW LEVEL SECURITY"      "RLS pattern present"
assert_contains "references/sql-patterns.md" "EXCLUDE USING gist\|prevent_booking_conflict" "Booking conflict prevention present"
assert_contains "references/sql-patterns.md" "wallet_transactions"     "Wallet/balance pattern present"
assert_contains "references/sql-patterns.md" "phone_otps"              "OTP table pattern present"
assert_contains "references/sql-patterns.md" "tsvector"                "Full-text search pattern present"
assert_contains "references/sql-patterns.md" "geography(POINT"         "PostGIS location pattern present"
assert_contains "references/sql-patterns.md" "audit_logs"              "Audit log pattern present"

# ── 7. references/output-template.md — all sections templated ───────────────
echo ""
echo "[ references/output-template.md — section templates ]"
for i in 1 2 3 4 5 6 7 8 9 10 11; do
  assert_contains "references/output-template.md" "Section $i\|SECTION $i" "Section $i template present"
done
assert_contains "references/output-template.md" "Assumptions Made"     "Assumptions block template present"

# ── 8. evals/evals.json — structure validation ──────────────────────────────
echo ""
echo "[ evals/evals.json — structure ]"

# Valid JSON
if python3 -c "import json,sys; json.load(open('evals/evals.json'))" 2>/dev/null; then
  check "evals.json is valid JSON" "pass"
else
  check "evals.json is valid JSON" "fail" "JSON parse error"
fi

# At least 6 cases
CASE_COUNT=$(python3 -c "import json; d=json.load(open('evals/evals.json')); print(len(d.get('cases',[])))" 2>/dev/null || echo "0")
if [[ "$CASE_COUNT" -ge 6 ]]; then
  check "evals.json has at least 6 cases (found $CASE_COUNT)" "pass"
else
  check "evals.json has at least 6 cases" "fail" "found $CASE_COUNT"
fi

# Every case has assertions
CASES_WITHOUT_ASSERTIONS=$(python3 -c "
import json
d = json.load(open('evals/evals.json'))
bad = [c['id'] for c in d.get('cases',[]) if not c.get('assertions')]
print(len(bad))
" 2>/dev/null || echo "99")
if [[ "$CASES_WITHOUT_ASSERTIONS" -eq 0 ]]; then
  check "Every eval case has assertions" "pass"
else
  check "Every eval case has assertions" "fail" "$CASES_WITHOUT_ASSERTIONS case(s) have no assertions"
fi

# Total assertion count >= 30
ASSERTION_COUNT=$(python3 -c "
import json
d = json.load(open('evals/evals.json'))
print(sum(len(c.get('assertions',[])) for c in d.get('cases',[])))
" 2>/dev/null || echo "0")
if [[ "$ASSERTION_COUNT" -ge 30 ]]; then
  check "evals.json has at least 30 assertions (found $ASSERTION_COUNT)" "pass"
else
  check "evals.json has at least 30 assertions" "fail" "found $ASSERTION_COUNT"
fi

# Scoring block present
if python3 -c "import json; d=json.load(open('evals/evals.json')); assert 'scoring' in d" 2>/dev/null; then
  check "evals.json has scoring block" "pass"
else
  check "evals.json has scoring block" "fail"
fi

# ── 9. README.md — installation and usage ───────────────────────────────────
echo ""
echo "[ README.md — completeness ]"
assert_contains "README.md" "git clone\|git submodule" "Installation instructions present"
assert_contains "README.md" "SKILL.md"                  "SKILL.md referenced"
assert_contains "README.md" "evals"                     "evals referenced"
assert_not_contains "README.md" "femi-adeyemo/kajola-skill" "Old author clone URL removed"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL))
echo "  Results: $PASS/$TOTAL passed"

if [[ "$FAIL" -eq 0 ]]; then
  echo "  Status:  ALL CHECKS PASSED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  exit 0
else
  echo "  Status:  $FAIL CHECK(S) FAILED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Failed checks:"
  for err in "${ERRORS[@]}"; do
    echo "    - $err"
  done
  echo ""
  exit 1
fi
