#!/usr/bin/env bash
# Validates a single Kajola example file against SORF quality invariants.
# Usage: bash scripts/check-example.sh examples/glamplus-beauty-kenya.md
#
# Exit code 0 = all checks passed. Non-zero = at least one check failed.

set -euo pipefail

PASS=0
FAIL=0
ERRORS=()

check() {
  local description="$1"
  local result="$2"
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
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    check "$description" "pass"
  else
    check "$description" "fail" "pattern not found: '$pattern'"
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local description="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    check "$description" "fail" "forbidden pattern found: '$pattern'"
  else
    check "$description" "pass"
  fi
}

# ── Argument check ────────────────────────────────────────────────────────────

if [[ $# -eq 0 ]]; then
  echo ""
  echo "Usage: bash scripts/check-example.sh <example-file.md>"
  echo "       bash scripts/check-example.sh examples/glamplus-beauty-kenya.md"
  echo ""
  exit 1
fi

FILE="$1"

if [[ ! -f "$FILE" ]]; then
  echo "Error: file not found: $FILE"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Kajola Example Validator"
echo "  File: $FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. All 11 sections present ────────────────────────────────────────────────
echo ""
echo "[ Section headers ]"
for i in 1 2 3 4 5 6 7 8 9 10 11; do
  assert_contains "$FILE" "SECTION $i|Section $i" "Section $i present"
done

# ── 2. SORF booking states ────────────────────────────────────────────────────
echo ""
echo "[ SORF booking states ]"
for state in pending confirmed held checked_in in_progress completed cancelled no_show disputed; do
  assert_contains "$FILE" "'$state'|\"$state\"" "booking_status '$state' in schema"
done

# ── 3. Schema structure ───────────────────────────────────────────────────────
echo ""
echo "[ SQL Schema — SORF invariants ]"
assert_contains "$FILE" "EXCLUDE USING gist"                          "Booking conflict prevention via EXCLUDE USING gist"
assert_contains "$FILE" "availability_windows"                         "availability_windows table present"
assert_contains "$FILE" "availability_overrides"                       "availability_overrides table present"
assert_contains "$FILE" "waitlist_entries"                             "waitlist_entries table present"
assert_contains "$FILE" "notify_waitlist|waitlist.*trigger|trigger.*waitlist" "Waitlist notification trigger present"
assert_contains "$FILE" "deposit_policy"                               "deposit_policy jsonb on businesses"
assert_contains "$FILE" "no_show_policy"                               "no_show_policy jsonb on businesses"
assert_contains "$FILE" "loyalty_accounts"                             "loyalty_accounts table present"
assert_contains "$FILE" "loyalty_transactions"                         "loyalty_transactions table present"
assert_contains "$FILE" "branch_kpis"                                  "branch_kpis materialised view present"
assert_contains "$FILE" "ROW LEVEL SECURITY"                           "RLS enabled on tables"
assert_contains "$FILE" "current_user_tenant_id"                       "current_user_tenant_id() helper used"
assert_contains "$FILE" "held_until"                                   "held_until column for optimistic slot hold"
assert_contains "$FILE" "idempotency_key|idempotency"                  "Idempotency key pattern present"

# ── 4. Africa-first patterns ──────────────────────────────────────────────────
echo ""
echo "[ Africa-first patterns ]"
assert_contains "$FILE" "Paystack|M-Pesa|MTN|Orange Money|Flutterwave" "At least one Africa payment provider"
assert_contains "$FILE" "Termii|Africa.s Talking|AT SMS"               "At least one Africa SMS provider"
assert_contains "$FILE" "HMAC"                                          "Webhook HMAC verification present"
assert_contains "$FILE" "phone.*OTP|OTP.*phone|send.otp|sendOtp|Phone OTP" "Phone OTP auth present"

# ── 5. API / automation quality ───────────────────────────────────────────────
echo ""
echo "[ API and automation quality ]"
assert_contains "$FILE" "SECTION 7|Section 7"                          "Section 7 (Automation) present"
assert_contains "$FILE" "pg_cron|cron\.schedule"                       "pg_cron jobs defined"
assert_contains "$FILE" "automation_jobs"                              "automation_jobs table referenced"
assert_contains "$FILE" "webhook"                                       "Webhook handler present"

# ── 6. Deployment completeness ────────────────────────────────────────────────
echo ""
echo "[ Deployment completeness ]"
assert_contains "$FILE" "SUPABASE_SERVICE_ROLE_KEY"                    "SUPABASE_SERVICE_ROLE_KEY listed in env vars"
assert_contains "$FILE" "PAYSTACK_SECRET_KEY|MPESA_CONSUMER_KEY|DARAJA_CONSUMER_KEY|MTN_MNO_API_KEY|ORANGE_CLIENT_SECRET|FLUTTERWAVE_SECRET" "Payment API key listed in env vars"
assert_contains "$FILE" "TERMII_API_KEY|AT_API_KEY"                    "SMS API key listed in env vars"

# ── 7. Monetization — real numbers ────────────────────────────────────────────
echo ""
echo "[ Monetization — real numbers only ]"
assert_contains "$FILE" "SECTION 9|Section 9"                          "Section 9 (Monetization) present"
assert_contains "$FILE" "₦|KES|GHS|XOF|KES [0-9]|₦[0-9]|[0-9].*GHS"  "Real currency amounts in Section 9"
assert_not_contains "$FILE" "₦X,000|₦X|X%|TBD|TODO|YOUR_VALUE_HERE|add more columns" "No placeholder rates or TBD values"

# ── 8. Assumptions block ──────────────────────────────────────────────────────
echo ""
echo "[ Required blocks ]"
assert_contains "$FILE" "## Assumptions Made"                          "Assumptions block present"
assert_contains "$FILE" "SECTION 11|Section 11"                        "Section 11 (Roadmap) present"

# ── Summary ───────────────────────────────────────────────────────────────────
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
