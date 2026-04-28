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
