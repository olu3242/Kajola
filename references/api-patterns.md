# API Patterns Reference

## Standard Edge Function Shell

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { data: { user }, error } = await supabase.auth.getUser(
      req.headers.get("Authorization")?.replace("Bearer ", "") ?? ""
    );
    if (error || !user) return err(401, "Unauthorized");

    const body = await req.json();
    // handler logic
    return ok({ result: "..." });
  } catch (e) {
    return err(500, "Internal error");
  }
});
```

## Response Envelope

```typescript
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), { status, headers: cors });

const err = (status: number, message: string, code?: string) =>
  new Response(JSON.stringify({ success: false, error: { message, code } }), { status, headers: cors });
```

## Paystack HMAC Webhook Verification

```typescript
import { crypto } from "https://deno.land/std/crypto/mod.ts";

async function verifyPaystack(req: Request): Promise<boolean> {
  const sig = req.headers.get("x-paystack-signature") ?? "";
  const body = await req.text();
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")!;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === sig;
}
```

## Idempotency Guard

```typescript
async function ensureIdempotent(key: string): Promise<boolean> {
  const { error } = await supabase
    .from("automation_jobs")
    .insert({ idempotency_key: key, status: "processing" });
  return !error; // false = duplicate, skip processing
}
```

## Tenant-Scoped Query Pattern

```typescript
// Always filter by tenant — never trust client-supplied tenant_id
const { data } = await supabase
  .from("bookings")
  .select("*")
  .eq("tenant_id", user.app_metadata.tenant_id);
```

## Standard Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `AUTH_REQUIRED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Valid token, wrong tenant/role |
| `NOT_FOUND` | 404 | Resource doesn't exist or not visible to tenant |
| `CONFLICT` | 409 | Booking overlap, duplicate, optimistic lock |
| `UNPROCESSABLE` | 422 | Validation failure (missing fields, bad format) |
| `PAYMENT_FAILED` | 402 | Paystack charge returned non-success |
| `WEBHOOK_INVALID` | 400 | HMAC signature mismatch |

## Pagination Pattern

```typescript
const page = Number(url.searchParams.get("page") ?? 1);
const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
const from = (page - 1) * limit;

const { data, count } = await supabase
  .from("listings")
  .select("*", { count: "exact" })
  .range(from, from + limit - 1);

return ok({ data, meta: { page, limit, total: count } });
```

---

## M-Pesa Daraja — STK Push (C2B)

Initiates a payment prompt on the customer's phone. Use for Kenya / East Africa markets.

```typescript
async function mpesaStkPush(opts: {
  phone: string;       // E.164 without +: "254712345678"
  amount: number;      // KES whole shillings
  reference: string;   // booking or order ID (max 12 chars for Daraja)
  description: string; // shown on customer's STK screen
}): Promise<{ CheckoutRequestID: string }> {
  const shortcode   = Deno.env.get("MPESA_SHORTCODE")!;
  const passkey     = Deno.env.get("MPESA_PASSKEY")!;
  const callbackUrl = Deno.env.get("MPESA_CALLBACK_URL")!;

  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  const password  = btoa(`${shortcode}${passkey}${timestamp}`);

  const token = await getDarajaToken();

  const resp = await fetch(
    "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: opts.amount,
        PartyA: opts.phone,
        PartyB: shortcode,
        PhoneNumber: opts.phone,
        CallBackURL: callbackUrl,
        AccountReference: opts.reference.slice(0, 12),
        TransactionDesc: opts.description.slice(0, 20),
      }),
    }
  );

  const data = await resp.json();
  if (data.ResponseCode !== "0") throw new Error(`STK Push failed: ${data.ResponseDescription}`);
  return { CheckoutRequestID: data.CheckoutRequestID };
}

async function getDarajaToken(): Promise<string> {
  const creds = btoa(
    `${Deno.env.get("MPESA_CONSUMER_KEY")}:${Deno.env.get("MPESA_CONSUMER_SECRET")}`
  );
  const resp = await fetch(
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    { headers: { Authorization: `Basic ${creds}` } }
  );
  const { access_token } = await resp.json();
  return access_token;
}
```

## M-Pesa Daraja — B2C Payout (Business to Customer)

Pays out funds directly to a customer or rider's M-Pesa number.

```typescript
async function mpesaB2cPayout(opts: {
  phone: string;       // E.164 without +
  amount: number;      // KES whole shillings
  remarks: string;
  occasion?: string;
}): Promise<void> {
  const token = await getDarajaToken();
  const resp = await fetch(
    "https://api.safaricom.co.ke/mpesa/b2c/v3/paymentrequest",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        InitiatorName:       Deno.env.get("MPESA_B2C_INITIATOR")!,
        SecurityCredential:  Deno.env.get("MPESA_B2C_SECURITY_CRED")!,
        CommandID:           "BusinessPayment",
        Amount:              opts.amount,
        PartyA:              Deno.env.get("MPESA_SHORTCODE")!,
        PartyB:              opts.phone,
        Remarks:             opts.remarks,
        QueueTimeOutURL:     Deno.env.get("MPESA_B2C_TIMEOUT_URL")!,
        ResultURL:           Deno.env.get("MPESA_B2C_RESULT_URL")!,
        Occasion:            opts.occasion ?? "",
      }),
    }
  );
  const data = await resp.json();
  if (data.ResponseCode !== "0") throw new Error(`B2C failed: ${data.ResponseDescription}`);
}
```

## M-Pesa Daraja — Callback Verification (SHA-256 HMAC)

```typescript
async function verifyDarajaCallback(req: Request): Promise<boolean> {
  const sig    = req.headers.get("x-daraja-signature") ?? "";
  const body   = await req.text();
  const secret = Deno.env.get("MPESA_CALLBACK_SECRET")!;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === sig;
}
```

## Africa's Talking — SMS (Termii Alternative for East/West Africa)

Use for Kenya, Uganda, Tanzania, Rwanda, Ethiopia. Drop-in alternative to Termii for those markets.

```typescript
async function sendAtSms(to: string, message: string): Promise<void> {
  const form = new URLSearchParams({
    username: Deno.env.get("AT_USERNAME")!,
    to,
    message,
    from: Deno.env.get("AT_SENDER_ID") ?? "",
  });

  const resp = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      apiKey: Deno.env.get("AT_API_KEY")!,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await resp.json();
  const recipient = data?.SMSMessageData?.Recipients?.[0];
  if (!recipient || recipient.statusCode !== 101) {
    throw new Error(`AT SMS failed: ${recipient?.status ?? "unknown"}`);
  }
}
```

## Africa's Talking — USSD Handler

Handles stateless USSD sessions for feature-phone users. Register this Edge Function URL as the USSD callback in the Africa's Talking dashboard.

```typescript
// USSD sessions arrive as form-encoded POST bodies
Deno.serve(async (req) => {
  const text = await req.formData();
  const sessionId   = text.get("sessionId")   as string;
  const phoneNumber = text.get("phoneNumber") as string;
  const input       = (text.get("text") as string) ?? "";   // full input history, e.g. "1*2"
  const parts       = input.split("*").filter(Boolean);     // navigate with parts.length

  // All USSD responses are plain text:
  // "CON ..." → session continues (show menu)
  // "END ..." → session ends (show final message)
  const respond = (msg: string) =>
    new Response(msg, { headers: { "Content-Type": "text/plain" } });

  if (parts.length === 0) {
    return respond("CON Welcome to Kajola\n1. My Bookings\n2. Pay Balance\n3. Contact Support");
  }
  if (parts[0] === "1") {
    const bookings = await getRecentBookings(phoneNumber);
    return respond(`END Your last booking: ${bookings[0]?.summary ?? "No bookings found."}`);
  }
  if (parts[0] === "2") {
    return respond("CON Enter amount to pay (KES):");
  }
  return respond("END Invalid option. Please try again.");
});

async function getRecentBookings(phone: string) {
  const { data } = await supabase
    .from("bookings")
    .select("id, status, created_at")
    .eq("client_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1);
  return data ?? [];
}
```

## SORF Booking State Machine (Edge Function)

Validates and applies SORF lifecycle transitions. Import into any booking state-change endpoint.

```typescript
// SORF 9-state lifecycle — allowed transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending:    ["confirmed", "held", "cancelled"],
  held:       ["confirmed", "cancelled"],           // held → confirmed when deposit paid
  confirmed:  ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_progress", "no_show"],
  in_progress:["completed", "disputed"],
  completed:  [],                                   // terminal state
  cancelled:  [],                                   // terminal state
  no_show:    [],                                   // terminal state
  disputed:   ["completed", "cancelled"],           // manager resolves
};

type BookingStatus = keyof typeof ALLOWED_TRANSITIONS;

async function transitionBookingState(
  bookingId: string,
  toStatus: BookingStatus,
  meta: { userId: string; reason?: string }
): Promise<{ ok: boolean; error?: string }> {
  // 1. Fetch current status (RLS ensures caller can see this booking)
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, status, tenant_id, staff_id, customer_id, starts_at")
    .eq("id", bookingId)
    .single();

  if (error || !booking) return { ok: false, error: "Booking not found" };

  const from = booking.status as BookingStatus;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];

  if (!allowed.includes(toStatus)) {
    return { ok: false, error: `Cannot transition '${from}' → '${toStatus}'` };
  }

  // 2. Build update patch — record timestamps for key transitions
  const patch: Record<string, unknown> = { status: toStatus };
  if (toStatus === "checked_in")  patch.checked_in_at = new Date().toISOString();
  if (toStatus === "in_progress") patch.started_at    = new Date().toISOString();
  if (toStatus === "completed")   patch.completed_at  = new Date().toISOString();
  if (toStatus === "cancelled")   { patch.cancelled_at = new Date().toISOString(); patch.cancellation_reason = meta.reason ?? ""; }
  if (toStatus === "confirmed")   patch.held_until    = null;  // clear hold timer

  // 3. Apply
  const { error: updateErr } = await supabase
    .from("bookings")
    .update(patch)
    .eq("id", bookingId);

  if (updateErr) return { ok: false, error: updateErr.message };

  // 4. Enqueue automation event (fire-and-forget via automation_jobs)
  await supabase.from("automation_jobs").insert({
    job_type:        `booking.${toStatus}`,
    payload:         { booking_id: bookingId, from_status: from, actor_id: meta.userId },
    idempotency_key: `booking-${bookingId}-${toStatus}`,
  });

  return { ok: true };
}
```

## SORF Booking Hold + STK Push Orchestration

Full flow for the Slot Hold → Deposit → Confirmed path. Use as the canonical template for any booking platform that uses M-Pesa deposits.

```typescript
// POST /bookings/hold
async function holdBooking(req: Request): Promise<Response> {
  const { branch_id, staff_id, service_id, starts_at } = await req.json();
  const user = await getUser(req);
  if (!user) return err(401, "Unauthorized");

  // 1. Compute ends_at from service duration
  const { data: service } = await supabase.from("services").select("duration_minutes, price_kes, deposit_override").eq("id", service_id).single();
  const { data: business } = await supabase.from("businesses").select("deposit_policy").eq("id", /* branch.business_id */ "...").single();

  const startsAt = new Date(starts_at);
  const endsAt   = new Date(startsAt.getTime() + service.duration_minutes * 60_000);
  const heldUntil = new Date(Date.now() + 15 * 60_000);  // 15-min hold

  // 2. Compute deposit
  const depositPolicy = service.deposit_override ?? business.deposit_policy;
  const depositKes = depositPolicy.type === "percentage"
    ? Math.round(service.price_kes * depositPolicy.value / 100)
    : depositPolicy.value;

  // 3. Insert booking (EXCLUDE USING gist will reject overlaps automatically)
  const { data: booking, error } = await supabase.from("bookings").insert({
    tenant_id: user.app_metadata.tenant_id,
    branch_id, staff_id, service_id,
    customer_id: user.id,
    status:      "held",
    starts_at:   startsAt.toISOString(),
    ends_at:     endsAt.toISOString(),
    held_until:  heldUntil.toISOString(),
    price_kes:   service.price_kes,
    deposit_kes: depositKes,
  }).select().single();

  if (error) {
    // Postgres EXCLUDE constraint violation = slot conflict
    if (error.code === "23P01") return err(409, "Slot no longer available", "CONFLICT");
    return err(500, error.message);
  }

  return ok({ booking: { id: booking.id, status: "held", held_until: heldUntil, deposit_kes: depositKes } }, 201);
}

// POST /payments/initiate — triggers STK Push for the held booking's deposit
async function initiateDeposit(req: Request): Promise<Response> {
  const { booking_id, phone } = await req.json();
  const user = await getUser(req);
  if (!user) return err(401, "Unauthorized");

  const { data: booking } = await supabase.from("bookings").select("*").eq("id", booking_id).eq("customer_id", user.id).single();
  if (!booking || booking.status !== "held") return err(404, "Booking not found or not in held state");
  if (new Date(booking.held_until) < new Date()) return err(409, "Hold expired — please rebook", "HOLD_EXPIRED");

  const idempotencyKey = `booking-${booking_id}-deposit`;

  // Upsert mobile_money_transactions — idempotent: if already initiated, return existing reference
  const { data: existing } = await supabase.from("mobile_money_transactions").select("provider_ref").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing?.provider_ref) {
    return ok({ checkout_request_id: existing.provider_ref, message: "STK Push already sent — check your phone" });
  }

  // Initiate STK Push
  const { CheckoutRequestID } = await mpesaStkPush({
    phone: phone.replace("+", ""),
    amount: booking.deposit_kes,
    reference: booking_id.slice(0, 12),
    description: `Deposit`,
  });

  await supabase.from("mobile_money_transactions").insert({
    tenant_id:    booking.tenant_id,
    booking_id:   booking_id,
    customer_id:  user.id,
    provider:     "mpesa_ke",
    direction:    "c2b",
    amount:       booking.deposit_kes,
    phone,
    provider_ref: CheckoutRequestID,
    idempotency_key: idempotencyKey,
  });

  return ok({ checkout_request_id: CheckoutRequestID, message: "STK Push sent — check your phone" });
}
```

## Loyalty Credit on Booking Completion

Called after booking transitions to `completed`. Idempotent — safe to retry.

```typescript
async function creditLoyaltyPoints(bookingId: string): Promise<void> {
  const { data: booking } = await supabase.from("bookings").select("tenant_id, customer_id, price_kes").eq("id", bookingId).single();
  if (!booking) return;

  const idempotencyKey = `loyalty-${bookingId}-earn`;
  const { data: existing } = await supabase.from("loyalty_transactions").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) return;  // already credited — idempotent

  // 1 point per currency unit spent (integer, no sub-point)
  const pointsDelta = booking.total_amount ?? booking.price_kes ?? 0;

  // Upsert loyalty account (create if first booking)
  const { data: account } = await supabase.from("loyalty_accounts")
    .upsert({ tenant_id: booking.tenant_id, customer_id: booking.customer_id }, { onConflict: "customer_id" })
    .select("id, points_balance, lifetime_points").single();

  const newBalance  = account.points_balance  + pointsDelta;
  const newLifetime = account.lifetime_points + pointsDelta;

  // Determine tier upgrade
  const newTier = newLifetime >= 50000 ? "platinum" : newLifetime >= 20000 ? "gold" : newLifetime >= 5000 ? "silver" : "bronze";

  await Promise.all([
    supabase.from("loyalty_accounts").update({ points_balance: newBalance, lifetime_points: newLifetime, tier: newTier }).eq("id", account.id),
    supabase.from("loyalty_transactions").insert({
      tenant_id:      booking.tenant_id,
      account_id:     account.id,
      booking_id:     bookingId,
      event_type:     "points_earned",
      points_delta:   pointsDelta,
      balance_after:  newBalance,
      description:    `Earned ${pointsDelta} points for booking ${bookingId}`,
      idempotency_key: idempotencyKey,
    }),
  ]);
}
```

## Offline Queue Pattern (Mobile — React Native / Expo)

Cache actions locally when offline; flush in FIFO order on reconnect. Works with any Supabase Edge Function endpoint.

```typescript
// lib/offlineQueue.ts  (expo-sqlite backed)
import * as SQLite from "expo-sqlite";

const db = SQLite.openDatabaseSync("offline_queue.db");

db.execSync(`
  CREATE TABLE IF NOT EXISTS queue (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    url     TEXT NOT NULL,
    method  TEXT NOT NULL DEFAULT 'POST',
    body    TEXT NOT NULL,
    queued_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

export async function enqueue(url: string, body: unknown, method = "POST") {
  db.runSync(
    "INSERT INTO queue (url, method, body) VALUES (?, ?, ?)",
    [url, method, JSON.stringify(body)]
  );
}

export async function flushQueue(authToken: string) {
  const rows = db.getAllSync<{ id: number; url: string; method: string; body: string }>(
    "SELECT * FROM queue ORDER BY id ASC"
  );
  for (const row of rows) {
    try {
      await fetch(row.url, {
        method: row.method,
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: row.body,
      });
      db.runSync("DELETE FROM queue WHERE id = ?", [row.id]);
    } catch {
      break; // still offline — stop and retry later
    }
  }
}

// In your app's network listener:
// NetInfo.addEventListener(state => { if (state.isConnected) flushQueue(token); });
```

---

## MTN Mobile Money (MoMo) — GHS Payment

Initiate a GHS payment via MTN MoMo Collections API and handle the callback.

```typescript
// POST https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay
async function initiateMomoPayment(params: {
  amount: string;          // e.g. "50.00"
  currency: string;        // "GHS"
  externalId: string;      // your order/booking reference
  payerMsisdn: string;     // customer phone, e.g. "0244123456"
  payerMessage: string;
  payeeNote: string;
}) {
  const referenceId = crypto.randomUUID();

  const res = await fetch(`${Deno.env.get("MOMO_BASE_URL")}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${await getMomoToken()}`,
      "X-Reference-Id": referenceId,
      "X-Target-Environment": Deno.env.get("MOMO_ENVIRONMENT") ?? "sandbox",
      "Ocp-Apim-Subscription-Key": Deno.env.get("MOMO_SUBSCRIPTION_KEY")!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency,
      externalId: params.externalId,
      payer: { partyIdType: "MSISDN", partyId: params.payerMsisdn },
      payerMessage: params.payerMessage,
      payeeNote: params.payeeNote,
    }),
  });

  if (res.status !== 202) throw new Error(`MoMo initiate failed: ${res.status}`);
  return referenceId; // store this to check status / correlate callback
}

// Obtain a short-lived API token (expires in 3600s — cache in KV or memory)
async function getMomoToken(): Promise<string> {
  const credentials = btoa(
    `${Deno.env.get("MOMO_API_USER")}:${Deno.env.get("MOMO_API_KEY")}`
  );
  const res = await fetch(`${Deno.env.get("MOMO_BASE_URL")}/collection/token/`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Ocp-Apim-Subscription-Key": Deno.env.get("MOMO_SUBSCRIPTION_KEY")!,
    },
  });
  const data = await res.json();
  return data.access_token;
}

// MoMo callback verification — validate X-Callback-Signature (HMAC-SHA-256)
async function verifyMomoCallback(req: Request): Promise<boolean> {
  const signature = req.headers.get("X-Callback-Signature");
  if (!signature) return false;
  const rawBody = await req.text();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("MOMO_CALLBACK_SECRET")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  return signature === expected;
}

// Callback payload shape (status: SUCCESSFUL | FAILED | PENDING)
interface MomoCallbackPayload {
  financialTransactionId: string;
  externalId: string;            // matches your booking/order reference
  amount: string;
  currency: string;
  payer: { partyIdType: "MSISDN"; partyId: string };
  payerMessage: string;
  payeeNote: string;
  status: "SUCCESSFUL" | "FAILED" | "PENDING";
  reason?: { code: string; message: string };
}
```

Required env vars: `MOMO_BASE_URL`, `MOMO_ENVIRONMENT`, `MOMO_SUBSCRIPTION_KEY`, `MOMO_API_USER`, `MOMO_API_KEY`, `MOMO_CALLBACK_SECRET`

---

## Termii OTP — Send & Verify (West Africa Primary Auth)

Send and verify phone-based OTP via Termii API. Phone OTP is the primary auth method — no email dependency.

```typescript
const TERMII_BASE = "https://api.ng.termii.com/api";
const OTP_TTL_MINUTES = 10;
const OTP_DIGITS = 6;

// Send OTP via Termii token endpoint
async function sendTermiiOtp(params: {
  phone: string;      // E.164, e.g. "+2348012345678"
  tenantId: string;
}): Promise<{ pinId: string }> {
  const res = await fetch(`${TERMII_BASE}/sms/otp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: Deno.env.get("TERMII_API_KEY"),
      message_type: "NUMERIC",
      to: params.phone,
      from: Deno.env.get("TERMII_SENDER_ID") ?? "N-Alert",
      channel: "dnd",        // "dnd" for Nigeria DND numbers; fallback to "generic"
      pin_attempts: 3,
      pin_time_to_live: OTP_TTL_MINUTES,
      pin_length: OTP_DIGITS,
      pin_placeholder: "< 1234 >",
      message_text: "Your verification code is < 1234 >. Valid for 10 minutes.",
      pin_type: "NUMERIC",
    }),
  });

  const data = await res.json();
  if (!data.pinId) throw new Error(`Termii OTP send failed: ${JSON.stringify(data)}`);

  // Persist pinId for verification (store in phone_otps table)
  await supabase.from("phone_otps").insert({
    phone: params.phone,
    tenant_id: params.tenantId,
    pin_id: data.pinId,       // Termii reference
    expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString(),
  });

  return { pinId: data.pinId };
}

// Verify OTP via Termii — also checks local phone_otps table for expiry/max attempts
async function verifyTermiiOtp(params: {
  pinId: string;
  otp: string;
  tenantId: string;
}): Promise<{ verified: boolean }> {
  // Local guard — check not expired and not already used
  const { data: record } = await supabase
    .from("phone_otps")
    .select("expires_at, verified_at, attempts")
    .eq("pin_id", params.pinId)
    .eq("tenant_id", params.tenantId)
    .single();

  if (!record) return { verified: false };
  if (record.verified_at) return { verified: false }; // already used
  if (new Date(record.expires_at) < new Date()) return { verified: false }; // expired

  const res = await fetch(`${TERMII_BASE}/sms/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: Deno.env.get("TERMII_API_KEY"),
      pin_id: params.pinId,
      pin: params.otp,
    }),
  });

  const data = await res.json();
  const verified = data.verified === "True";

  if (verified) {
    await supabase.from("phone_otps").update({ verified_at: new Date().toISOString() })
      .eq("pin_id", params.pinId);
  } else {
    await supabase.from("phone_otps")
      .update({ attempts: (record.attempts ?? 0) + 1 })
      .eq("pin_id", params.pinId);
  }

  return { verified };
}
```

Required env vars: `TERMII_API_KEY`, `TERMII_SENDER_ID`

---

## Paystack Recurring Subscriptions

Create a subscription plan, subscribe a customer, handle the `subscription.create` webhook, and cancel.

```typescript
const PAYSTACK_BASE = "https://api.paystack.co";
const paystackHeaders = () => ({
  "Authorization": `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
  "Content-Type": "application/json",
});

// 1. Create a plan (once at onboarding — store plan_code in DB)
async function createPaystackPlan(params: {
  name: string;             // e.g. "GlamPlus Pro Monthly"
  amount: number;           // in kobo, e.g. 800000 for ₦8,000
  interval: "monthly" | "quarterly" | "annually" | "weekly" | "daily";
}): Promise<{ planCode: string }> {
  const res = await fetch(`${PAYSTACK_BASE}/plan`, {
    method: "POST",
    headers: paystackHeaders(),
    body: JSON.stringify({ name: params.name, amount: params.amount, interval: params.interval }),
  });
  const data = await res.json();
  if (!data.status) throw new Error(`Create plan failed: ${data.message}`);
  return { planCode: data.data.plan_code };
}

// 2. Subscribe a customer to a plan (after initial charge.success sets authorization_code)
async function subscribeCustomer(params: {
  customerId: string;           // Paystack customer_code
  planCode: string;             // from createPaystackPlan
  authorizationCode: string;    // from initial charge's authorization.authorization_code
  startDate?: string;           // ISO — defaults to next billing cycle
}): Promise<{ subscriptionCode: string; emailToken: string }> {
  const res = await fetch(`${PAYSTACK_BASE}/subscription`, {
    method: "POST",
    headers: paystackHeaders(),
    body: JSON.stringify({
      customer: params.customerId,
      plan: params.planCode,
      authorization: params.authorizationCode,
      start_date: params.startDate,
    }),
  });
  const data = await res.json();
  if (!data.status) throw new Error(`Subscribe failed: ${data.message}`);
  return {
    subscriptionCode: data.data.subscription_code,
    emailToken: data.data.email_token, // needed to manage subscription via email link
  };
}

// 3. Handle subscription.create and invoice.payment_failed webhooks
// (Verify HMAC first using verifyPaystack pattern above, then:)
async function handleSubscriptionWebhook(event: { event: string; data: Record<string, unknown> }) {
  if (event.event === "subscription.create") {
    const sub = event.data;
    // Activate membership in your DB
    await supabase.from("memberships")
      .update({
        status: "active",
        paystack_sub_code: sub.subscription_code,
        next_payment_date: sub.next_payment_date,
      })
      .eq("paystack_customer_code", sub.customer.customer_code);
  }

  if (event.event === "invoice.payment_failed") {
    const sub = event.data;
    // Grace period: mark payment_failed, notify user, do NOT immediately deactivate
    await supabase.from("memberships")
      .update({ status: "payment_failed", payment_failed_at: new Date().toISOString() })
      .eq("paystack_sub_code", sub.subscription_code);
    // Schedule a reminder automation_job for 24h and 48h grace reminders
  }

  if (event.event === "subscription.disable") {
    const sub = event.data;
    await supabase.from("memberships")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("paystack_sub_code", sub.subscription_code);
  }
}

// 4. Cancel a subscription (customer-initiated)
async function cancelPaystackSubscription(params: {
  subscriptionCode: string;
  emailToken: string;           // must match the email_token stored at subscribe time
}): Promise<void> {
  const res = await fetch(`${PAYSTACK_BASE}/subscription/disable`, {
    method: "POST",
    headers: paystackHeaders(),
    body: JSON.stringify({ code: params.subscriptionCode, token: params.emailToken }),
  });
  const data = await res.json();
  if (!data.status) throw new Error(`Cancel subscription failed: ${data.message}`);
}
```

Required env vars: `PAYSTACK_SECRET_KEY`

---

## Flutterwave Payments (Pan-Africa)

Use Flutterwave for multi-currency collections across Ghana (GHS), Kenya (KES), Rwanda (RWF), Uganda (UGX), Tanzania (TZS), and South Africa (ZAR). Flutterwave is the default payment provider for non-Nigeria markets where Paystack is unavailable.

### Initiate Flutterwave Payment

```typescript
interface FlutterwaveChargeParams {
  txRef: string;           // unique idempotency key
  amount: number;          // in the base currency unit (not kobo)
  currency: string;        // 'GHS' | 'KES' | 'RWF' | 'UGX' | 'NGN' | etc.
  customerEmail: string;
  customerPhone: string;
  customerName: string;
  redirectUrl: string;     // where to send customer after payment
  platformName?: string;   // displayed on the Flutterwave payment page
  logoUrl?: string;        // platform logo URL for the payment page
  meta?: Record<string, unknown>;
}

async function initiateFlutterwavePayment(
  params: FlutterwaveChargeParams
): Promise<{ paymentLink: string; txRef: string }> {
  const res = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("FLW_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: params.txRef,
      amount: params.amount,
      currency: params.currency,
      redirect_url: params.redirectUrl,
      customer: {
        email: params.customerEmail,
        phone_number: params.customerPhone,
        name: params.customerName,
      },
      meta: params.meta ?? {},
      customizations: {
        title: params.platformName ?? "Payment",
        ...(params.logoUrl ? { logo: params.logoUrl } : {}),
      },
    }),
  });
  const data = await res.json();
  if (data.status !== "success") {
    throw new Error(`Flutterwave init failed: ${data.message}`);
  }
  return { paymentLink: data.data.link, txRef: params.txRef };
}
```

### Verify Flutterwave Payment (webhook)

```typescript
interface FlutterwaveWebhookPayload {
  event: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    status: "successful" | "failed" | "pending";
    payment_type: string;
    customer: { email: string; phone_number: string; name: string };
    meta: Record<string, unknown>;
  };
}

async function verifyFlutterwaveWebhook(req: Request): Promise<boolean> {
  const secretHash = Deno.env.get("FLW_WEBHOOK_HASH")!;
  const signature = req.headers.get("verif-hash") ?? "";
  return signature === secretHash;
}

// Verify actual transaction status via API (don't trust webhook amount alone)
async function verifyFlutterwaveTransaction(
  transactionId: number
): Promise<{ status: string; amount: number; currency: string }> {
  const res = await fetch(
    `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
    {
      headers: { Authorization: `Bearer ${Deno.env.get("FLW_SECRET_KEY")}` },
    }
  );
  const data = await res.json();
  return {
    status: data.data.status,
    amount: data.data.amount,
    currency: data.data.currency,
  };
}
```

### Flutterwave Transfer (provider payout)

```typescript
async function initiateFlutterwaveTransfer(params: {
  accountNumber: string;
  accountBank: string;    // bank code, e.g. '044' for Access Bank Nigeria
  amount: number;
  currency: string;
  narration: string;
  reference: string;      // unique idempotency key
}): Promise<{ transferId: number; status: string }> {
  const res = await fetch("https://api.flutterwave.com/v3/transfers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("FLW_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account_bank: params.accountBank,
      account_number: params.accountNumber,
      amount: params.amount,
      currency: params.currency,
      narration: params.narration,
      reference: params.reference,
    }),
  });
  const data = await res.json();
  if (data.status !== "success") {
    throw new Error(`Transfer failed: ${data.message}`);
  }
  return { transferId: data.data.id, status: data.data.status };
}
```

Required env vars: `FLW_SECRET_KEY`, `FLW_WEBHOOK_HASH`

---

## Whereby Embedded (Telemedicine Video Rooms)

Use Whereby Embedded for in-platform video consultations on telemedicine platforms. Create a room per booking on `booking.confirmed`; embed in Expo WebView (patient) and Next.js iframe (doctor).

### Create Whereby Room

```typescript
interface WherebyRoomParams {
  meetingName: string;          // human-readable: "Dr Adeyemi × Emeka Okonkwo"
  bookingId: string;            // used as endSessionCallback reference
  startTime: string;            // ISO 8601 — room unlocks 10 min before
  endTime: string;              // ISO 8601 — room locks 10 min after
  roomMode?: "normal" | "group" // default 'normal' for 1:1 consultations
}

interface WherebyRoom {
  meetingId: string;
  roomUrl: string;         // share with patient (host=false URL)
  hostRoomUrl: string;     // share with doctor (host=true URL includes host token)
  startDate: string;
  endDate: string;
}

async function createWherebyRoom(params: WherebyRoomParams): Promise<WherebyRoom> {
  const res = await fetch("https://api.whereby.dev/v1/meetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("WHEREBY_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      endDate: params.endTime,
      fields: ["hostRoomUrl"],
      roomMode: params.roomMode ?? "normal",
      roomNamePrefix: `booking-${params.bookingId}`,
      startDate: params.startTime,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whereby create room failed: ${err}`);
  }
  const data = await res.json();
  return {
    meetingId: data.meetingId,
    roomUrl: data.roomUrl,
    hostRoomUrl: data.hostRoomUrl,
    startDate: data.startDate,
    endDate: data.endDate,
  };
}
```

### Delete Whereby Room (on booking cancellation)

```typescript
async function deleteWherebyRoom(meetingId: string): Promise<void> {
  await fetch(`https://api.whereby.dev/v1/meetings/${meetingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${Deno.env.get("WHEREBY_API_KEY")}` },
  });
}
```

### Store room URLs on booking

```sql
-- Add to bookings table for telemedicine platforms
ALTER TABLE bookings
  ADD COLUMN whereby_meeting_id text,
  ADD COLUMN whereby_room_url    text,    -- patient URL (embed in Expo WebView)
  ADD COLUMN whereby_host_url    text;    -- doctor URL (embed in Next.js iframe)
```

### Expo WebView embed (patient)

```tsx
import { WebView } from 'react-native-webview'

export function VideoConsultation({ roomUrl }: { roomUrl: string }) {
  return (
    <WebView
      source={{ uri: roomUrl }}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      javaScriptEnabled
      style={{ flex: 1 }}
    />
  )
}
```

Required env vars: `WHEREBY_API_KEY`

---

## Orange Money (Côte d'Ivoire / Senegal / Francophone West Africa)

Use Orange Money for XOF (FCFA) collections in Côte d'Ivoire, Senegal, Mali, Burkina Faso, and Guinea. Orange Money is the dominant mobile money provider for francophone West Africa — use it alongside MTN MoMo for full coverage in mixed-operator markets.

### Initiate Orange Money Payment (Web Payment Gateway)

```typescript
interface OrangeMoneyPaymentParams {
  merchantKey: string;     // from ORANGE_MERCHANT_KEY env var
  currency: 'XOF' | 'XAF' | 'GNF' | 'SLL';
  orderId: string;         // unique idempotency key
  amount: number;          // integer, e.g. 5000 for 5000 XOF
  returnUrl: string;       // redirect after payment
  cancelUrl: string;
  notifUrl: string;        // webhook for payment notification
  reference: string;       // optional merchant reference (booking_id)
}

interface OrangeMoneyPaymentResponse {
  status: number;
  message: string;
  data: {
    id: string;
    created_at: string;
    merchant_key: string;
    currency: string;
    order_id: string;
    amount: number;
    return_url: string;
    cancel_url: string;
    notif_url: string;
    lang: string;
    reference: string;
    token: string;         // use to build payment URL
    payment_url: string;   // redirect customer here
  };
}

async function initiateOrangeMoneyPayment(
  params: OrangeMoneyPaymentParams
): Promise<OrangeMoneyPaymentResponse> {
  // Step 1: get access token
  const tokenRes = await fetch(
    `${Deno.env.get('ORANGE_API_BASE_URL')}/oauth/v3/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${Deno.env.get('ORANGE_CLIENT_ID')}:${Deno.env.get('ORANGE_CLIENT_SECRET')}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    }
  );
  const { access_token } = await tokenRes.json();

  // Step 2: initiate payment session
  const res = await fetch(
    `${Deno.env.get('ORANGE_API_BASE_URL')}/webpayment/v1/cashIn`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merchant_key: params.merchantKey,
        currency: params.currency,
        order_id: params.orderId,
        amount: params.amount,
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        notif_url: params.notifUrl,
        lang: 'fr',    // default to French for francophone markets
        reference: params.reference,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Orange Money init failed: ${err}`);
  }
  return res.json();
}
```

### Verify Orange Money Callback (webhook notification)

```typescript
interface OrangeMoneyCallbackPayload {
  status: string;           // 'SUCCESS' | 'FAILED' | 'PENDING'
  txnid: string;            // Orange transaction ID
  txnmode: string;
  inittxnmessage: string;
  inittxnstatus: string;
  confirmedamount: number;
  message: string;
  partner_transaction_id: string;  // merchant's order_id
  reference: string;               // merchant's reference
  notif_token: string;             // verify against ORANGE_NOTIF_TOKEN
}

function verifyOrangeMoneyCallback(
  payload: OrangeMoneyCallbackPayload
): boolean {
  // Orange Money uses a static notif_token per merchant — compare directly
  return payload.notif_token === Deno.env.get('ORANGE_NOTIF_TOKEN');
}
```

### Check Orange Money Transaction Status

```typescript
async function getOrangeMoneyTransactionStatus(
  orderId: string,
  accessToken: string
): Promise<{ status: string; amount: number; txnid: string }> {
  const res = await fetch(
    `${Deno.env.get('ORANGE_API_BASE_URL')}/webpayment/v1/transactionStatus/${orderId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const data = await res.json();
  return {
    status: data.status,
    amount: data.amount,
    txnid: data.txnid,
  };
}
```

Required env vars: `ORANGE_CLIENT_ID`, `ORANGE_CLIENT_SECRET`, `ORANGE_MERCHANT_KEY`, `ORANGE_NOTIF_TOKEN`, `ORANGE_API_BASE_URL`

---

## Expo Push Notifications

Send push notifications to Expo-managed React Native apps (Android + iOS).

```typescript
// packages/api/src/push.ts — shared across all Edge Functions

interface PushMessage {
  to: string;          // Expo push token (ExponentPushToken[...])
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;  // Android channel (e.g. 'bookings', 'reminders')
  priority?: 'default' | 'normal' | 'high';
}

interface PushReceipt {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendExpoPushNotification(
  messages: PushMessage[]
): Promise<PushReceipt[]> {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN') ?? ''}`,
    },
    body: JSON.stringify(messages),
  });

  const { data } = await res.json();
  return data as PushReceipt[];
}

// Convenience: single push to one device
export async function pushOne(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!expoPushToken?.startsWith('ExponentPushToken')) return;
  const [receipt] = await sendExpoPushNotification([
    { to: expoPushToken, title, body, data, sound: 'default', priority: 'high' },
  ]);
  if (receipt?.status === 'error') {
    console.error('Expo push failed:', receipt.message, receipt.details);
  }
}
```

**Usage in Edge Functions (e.g. booking confirmation)**:
```typescript
// After booking confirmed, push to both parties
await Promise.all([
  pushOne(customer.expo_push_token, 'Booking Confirmed!', `Your appointment at ${branch.name} is set.`, { booking_id }),
  pushOne(staff.expo_push_token, 'New Booking', `${customer.full_name} booked for ${format(starts_at, 'h:mma')}.`, { booking_id }),
]);
```

**DB column**: add `expo_push_token text` to the `profiles` table (nullable; updated from mobile app on login/focus).

Required env var: `EXPO_ACCESS_TOKEN` (Expo account → Access Tokens; optional but rate-limit-safe for production).

---

## Supabase Storage — Signed URL Helper

Generate short-lived signed URLs for private bucket files (medical records, prescriptions, job photos, pet health notes).

```typescript
// supabase/functions/_shared/storage.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

/**
 * Generate a signed URL for a private Supabase Storage file.
 * @param bucket  Bucket name (e.g. 'medical-records', 'job-photos')
 * @param path    File path within the bucket
 * @param expiresIn  Seconds until expiry (default 300 = 5 min)
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 300
): Promise<string> {
  const { data, error } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Signed URL error for ${bucket}/${path}: ${error?.message}`);
  }
  return data.signedUrl;
}

/**
 * Upload a file to a private bucket and return the storage path.
 * Used for prescription PDFs, job before/after photos, vaccine certs.
 */
export async function uploadPrivateFile(
  bucket: string,
  path: string,
  body: Uint8Array | Blob,
  contentType: string
): Promise<string> {
  const { error } = await adminClient.storage
    .from(bucket)
    .upload(path, body, { contentType, upsert: false });

  if (error) throw new Error(`Upload error for ${bucket}/${path}: ${error.message}`);
  return path;
}
```

**Usage**:
```typescript
// Return signed URL for a prescription PDF (5-min expiry)
const url = await getSignedUrl('medical-records', `prescriptions/${prescriptionId}.pdf`, 300);

// Upload job completion photo
const path = await uploadPrivateFile(
  'job-photos',
  `jobs/${jobId}/after-${Date.now()}.jpg`,
  imageBytes,
  'image/jpeg'
);
```

**Bucket policies (Supabase dashboard)**:
- Set bucket to **PRIVATE** — never public
- RLS policies on `storage.objects`: tenant must own the object (match `metadata->>'tenant_id'` or use a mapping table)
- Prefer short expiry (300s) for sensitive documents; use 3600s for app-session contexts only

Required env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## WhatsApp Business API (Meta Cloud API)

Send booking confirmations, reminders, and OTP messages via WhatsApp. Use WhatsApp as the primary notification channel for customers who opt in (`profiles.whatsapp_opted_in = true`); fall back to SMS (Termii/Africa's Talking) for all others.

### Send WhatsApp Template Message

```typescript
// supabase/functions/_shared/whatsapp.ts

interface WhatsAppTemplateMessage {
  to: string;                          // E.164 phone number, e.g. "+2348012345678"
  templateName: string;                // Approved template name on Meta dashboard
  languageCode?: string;               // Default: "en"
  components?: WhatsAppTemplateComponent[];
}

interface WhatsAppTemplateComponent {
  type: "header" | "body" | "button";
  parameters: Array<
    | { type: "text"; text: string }
    | { type: "date_time"; date_time: { fallback_value: string } }
    | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
    | { type: "payload"; payload: string }
  >;
}

interface WhatsAppMessageResponse {
  messages: Array<{ id: string }>;
}

export async function sendWhatsAppTemplate(
  msg: WhatsAppTemplateMessage
): Promise<WhatsAppMessageResponse> {
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
  const accessToken   = Deno.env.get("WHATSAPP_ACCESS_TOKEN")!;

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to.replace("+", ""),
        type: "template",
        template: {
          name: msg.templateName,
          language: { code: msg.languageCode ?? "en" },
          components: msg.components ?? [],
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`WhatsApp API error: ${err.error?.message ?? res.statusText}`);
  }
  return res.json();
}
```

### Booking Confirmation Message

```typescript
// Template name: "booking_confirmed" (pre-approved on Meta Business Manager)
// Template body: "Hi {{1}}, your appointment at {{2}} is confirmed for {{3}} at {{4}}. 📍 {{5}}. Ref: {{6}}"

export async function sendBookingConfirmationWhatsApp(params: {
  phone: string;
  customerName: string;
  businessName: string;
  appointmentDate: string;   // e.g. "Monday, 28 July 2026"
  appointmentTime: string;   // e.g. "10:00 AM"
  branchAddress: string;
  bookingRef: string;
}): Promise<void> {
  await sendWhatsAppTemplate({
    to: params.phone,
    templateName: "booking_confirmed",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: params.customerName },
          { type: "text", text: params.businessName },
          { type: "text", text: params.appointmentDate },
          { type: "text", text: params.appointmentTime },
          { type: "text", text: params.branchAddress },
          { type: "text", text: params.bookingRef },
        ],
      },
    ],
  });
}
```

### Appointment Reminder Message

```typescript
// Template name: "appointment_reminder"
// Template body: "Reminder: {{1}}, you have an appointment at {{2}} tomorrow at {{3}}. Reply CANCEL to cancel."

export async function sendAppointmentReminderWhatsApp(params: {
  phone: string;
  customerName: string;
  businessName: string;
  appointmentTime: string;
}): Promise<void> {
  await sendWhatsAppTemplate({
    to: params.phone,
    templateName: "appointment_reminder",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: params.customerName },
          { type: "text", text: params.businessName },
          { type: "text", text: params.appointmentTime },
        ],
      },
    ],
  });
}
```

### WhatsApp OTP Message

```typescript
// Template name: "otp_code" (must use Meta's OTP template category)
// Template body: "{{1}} is your {{2}} verification code. Valid for {{3}} minutes."

export async function sendWhatsAppOtp(params: {
  phone: string;
  otpCode: string;
  platformName: string;
  expiryMinutes?: number;
}): Promise<void> {
  await sendWhatsAppTemplate({
    to: params.phone,
    templateName: "otp_code",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: params.otpCode },
          { type: "text", text: params.platformName },
          { type: "text", text: String(params.expiryMinutes ?? 5) },
        ],
      },
    ],
  });
}
```

### WhatsApp Webhook Handler (Delivery Status)

```typescript
// POST /functions/v1/whatsapp-webhook
// Handles delivery receipts and inbound "CANCEL" replies from customers

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN")!;

serve(async (req) => {
  // GET: Meta webhook verification handshake
  if (req.method === "GET") {
    const url    = new URL(req.url);
    const mode   = url.searchParams.get("hub.mode");
    const token  = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // POST: incoming event
  const body = await req.json();
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value  = change?.value;

  // Delivery/read status update
  if (value?.statuses?.length) {
    for (const status of value.statuses) {
      // status.id = WhatsApp message ID, status.status = 'sent'|'delivered'|'read'|'failed'
      await supabase.from("notification_logs").update({
        delivery_status: status.status,
        delivered_at: status.status === "delivered" ? new Date().toISOString() : undefined,
        read_at:      status.status === "read"      ? new Date().toISOString() : undefined,
      }).eq("provider_message_id", status.id);
    }
  }

  // Inbound text message (e.g. customer replies "CANCEL")
  if (value?.messages?.length) {
    for (const message of value.messages) {
      if (message.type === "text") {
        const text = message.text.body.trim().toUpperCase();
        const phone = `+${message.from}`;
        if (text === "CANCEL") {
          // Find the customer's next upcoming booking and cancel it
          const { data: customer } = await supabase
            .from("profiles")
            .select("id")
            .eq("phone", phone)
            .maybeSingle();
          if (customer) {
            await supabase
              .from("bookings")
              .update({ status: "cancelled", cancellation_reason: "customer_whatsapp_cancel" })
              .eq("customer_id", customer.id)
              .eq("status", "confirmed")
              .gte("starts_at", new Date().toISOString())
              .order("starts_at", { ascending: true })
              .limit(1);
          }
        }
      }
    }
  }

  return new Response("OK", { status: 200 });
});
```

Required env vars: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`

**Setup notes**:
- Register on Meta for Developers → create a WhatsApp Business app → get a test phone number
- All template messages must be pre-approved by Meta before sending (allow 48–72h for approval)
- Add `whatsapp_opted_in boolean NOT NULL DEFAULT false` to `profiles` table
- Send WhatsApp only when `whatsapp_opted_in = true`; fall back to SMS otherwise
- Nigeria numbers: prefix `234`, Ghana: `233`, Kenya: `254`, Côte d'Ivoire: `225`

---

## Paystack Transfer (Vendor Payout)

Use this pattern to disburse earnings to vendors after a booking completes. Paystack Transfer API sends NGN to a registered bank account. All transfers are idempotent via a stable `reference` derived from the `payouts.id`.

```typescript
interface InitiatePayoutParams {
  payoutId:            string;   // payouts.id — used as idempotency reference
  recipientCode:       string;   // vendor_bank_accounts.paystack_recipient_code
  amountKobo:          number;
  reason?:             string;
}

interface CreateRecipientParams {
  accountNumber: string;
  bankCode:      string;
  accountName:   string;
  businessId:    string;         // stored in metadata for webhook reconciliation
}

// Step 1: Register vendor's bank account as a Paystack Transfer Recipient
export async function createPaystackRecipient(
  params: CreateRecipientParams
): Promise<{ recipientCode: string }> {
  const res = await fetch("https://api.paystack.co/transferrecipient", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type:           "nuban",
      name:           params.accountName,
      account_number: params.accountNumber,
      bank_code:      params.bankCode,
      currency:       "NGN",
      metadata:       { business_id: params.businessId },
    }),
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message);
  return { recipientCode: json.data.recipient_code };
}

// Step 2: Initiate transfer to vendor
export async function initiateVendorPayout(
  params: InitiatePayoutParams
): Promise<{ transferCode: string; transferRef: string }> {
  const reference = `payout-${params.payoutId}`;  // stable, not Date.now()

  const res = await fetch("https://api.paystack.co/transfer", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source:    "balance",
      amount:    params.amountKobo,
      recipient: params.recipientCode,
      reason:    params.reason ?? "Booking payout",
      currency:  "NGN",
      reference,
    }),
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message);
  return {
    transferCode: json.data.transfer_code,
    transferRef:  json.data.reference,
  };
}

// Step 3: Webhook handler for transfer events (Edge Function: confirm-transfer)
// Paystack sends transfer.success / transfer.failed / transfer.reversed
// Verify HMAC-SHA-512 on x-paystack-signature before processing
export async function handleTransferWebhook(
  rawBody: string,
  sig: string,
  supabase: SupabaseClient
): Promise<void> {
  const expected = createHmac("sha512", Deno.env.get("PAYSTACK_SECRET_KEY")!)
    .update(rawBody).digest("hex");
  if (sig !== expected) throw new Error("Invalid signature");

  const event = JSON.parse(rawBody);
  const { reference, transfer_code } = event.data;
  const payoutId = reference.replace("payout-", "");

  if (event.event === "transfer.success") {
    await supabase.from("payouts").update({
      status:       "success",
      completed_at: new Date().toISOString(),
    }).eq("id", payoutId);

    await supabase.from("payout_ledger").update({ status: "paid" })
      .eq("payout_id", payoutId);
  }

  if (event.event === "transfer.failed") {
    await supabase.from("payouts").update({
      status:         "failed",
      failure_reason: event.data.reason ?? "unknown",
    }).eq("id", payoutId);

    await supabase.from("payout_ledger").update({ status: "failed" })
      .eq("payout_id", payoutId);
  }

  if (event.event === "transfer.reversed") {
    await supabase.from("payouts").update({ status: "reversed" })
      .eq("id", payoutId);
    // Move ledger rows back to 'pending' for retry
    await supabase.from("payout_ledger").update({ status: "pending", payout_id: null })
      .eq("payout_id", payoutId);
  }
}
```

Required env vars: `PAYSTACK_SECRET_KEY`

**Setup notes**:
- Enable Transfer on your Paystack dashboard (Transfers → Settings → Enable transfers)
- Use `Paystack.verifyAccountNumber` before creating a recipient to validate account details
- Nigeria: 9-digit NUBAN account numbers; bank codes from `GET https://api.paystack.co/bank`
- Always use a stable `reference = payout-{uuid}` — never append timestamps
- Paystack balance must be funded before transfer; monitor via `GET /balance`
