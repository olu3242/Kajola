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
