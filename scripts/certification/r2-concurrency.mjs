const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_SLOT_ID', 'R2_SERVICE_ID', 'R2_CUSTOMER_ID', 'R2_TENANT_ID', 'R2_QUOTE_IDS'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`BLOCKED_EXTERNAL: missing ${missing.join(', ')}`);
  process.exitCode = 2;
} else {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const quoteIds = process.env.R2_QUOTE_IDS.split(',');
  const percentile = (values, p) => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
  for (const count of [2, 20, 50]) {
    if (quoteIds.length < count) throw new Error(`R2_QUOTE_IDS needs at least ${count} disposable quote IDs`);
    const attempts = await Promise.all(Array.from({ length: count }, async (_, index) => {
      const started = performance.now();
      const response = await fetch(`${base}/rest/v1/rpc/create_slot_hold`, { method: 'POST', headers, body: JSON.stringify({
        target_slot_id: process.env.R2_SLOT_ID, target_service_id: process.env.R2_SERVICE_ID,
        target_customer_id: process.env.R2_CUSTOMER_ID, target_tenant_id: process.env.R2_TENANT_ID,
        target_quote_snapshot_id: quoteIds[index], request_key: crypto.randomUUID(), hold_minutes: 5, target_staff_id: null,
      }) });
      return { ok: response.ok, status: response.status, latency: performance.now() - started, body: await response.text() };
    }));
    const latencies = attempts.map((item) => item.latency);
    const winners = attempts.filter((item) => item.ok).length;
    console.log(JSON.stringify({ claims: count, winners, rejections: count - winners,
      p50_ms: percentile([...latencies], .50), p95_ms: percentile([...latencies], .95), p99_ms: percentile([...latencies], .99),
      timeout_rate: attempts.filter((item) => item.status === 408 || item.status === 504).length / count }));
    if (winners !== 1) process.exitCode = 1;
  }
}
