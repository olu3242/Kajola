/**
 * confirm-payment — SORF Reference Implementation
 *
 * Handles the Paystack charge.success / charge.failed webhook to complete the
 * SORF payment loop that book-slot starts.
 *
 * charge.success:
 *   1. Verify HMAC-SHA-512 signature (x-paystack-signature header)
 *   2. Look up payment_transactions by provider_ref
 *   3. Idempotency check — return 200 if already processed
 *   4. Update payment_transactions.status → 'completed'
 *   5. Transition booking: held → confirmed (only if still held)
 *   6. Credit loyalty_transactions (idempotent via idempotency_key)
 *   7. Schedule reminder automation_jobs (24h + 2h before starts_at)
 *   8. Insert audit_logs entry
 *
 * charge.failed:
 *   1. Verify HMAC-SHA-512 signature
 *   2. Update payment_transactions.status → 'failed'
 *   3. Cancel held booking — DB trigger fires notify_waitlist automatically
 *   4. Insert audit_logs entry
 *
 * All other event types: return 200 immediately (ignored).
 *
 * IMPORTANT: Always return 200 to Paystack even on internal errors after
 * signature verification — returning 4xx causes Paystack to retry indefinitely.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET_KEY     = Deno.env.get('PAYSTACK_SECRET_KEY')!
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const LOYALTY_KOBO_PER_POINT = 100   // 1 point per ₦1 spent
const HANDLED_EVENTS         = new Set(['charge.success', 'charge.failed'])

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── 1. Read raw body (must be read before JSON.parse — needed for HMAC) ──────
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return json({ error: 'Failed to read request body' }, 400)
  }

  // ── 2. Verify HMAC-SHA-512 signature ─────────────────────────────────────────
  const signature = req.headers.get('x-paystack-signature')
  if (!signature) {
    return json({ error: 'Missing x-paystack-signature header' }, 401)
  }

  try {
    const key    = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(PAYSTACK_SECRET_KEY),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    )
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
    const hex    = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    if (hex !== signature) {
      return json({ error: 'Invalid webhook signature' }, 401)
    }
  } catch (err) {
    console.error('HMAC verification error:', err)
    return json({ error: 'Signature verification failed' }, 500)
  }

  // ── 3. Parse event ────────────────────────────────────────────────────────────
  let event: { event: string; data: Record<string, unknown> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400)
  }

  const { event: eventType, data } = event

  // Acknowledge but ignore unrelated events
  if (!HANDLED_EVENTS.has(eventType)) {
    return json({ success: true, ignored: true, event: eventType }, 200)
  }

  const reference = data.reference as string | undefined
  if (!reference) {
    console.error('confirm-payment: missing reference in payload', data)
    return json({ success: true, error: 'Missing reference' }, 200) // 200 to stop Paystack retries
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── 4. Look up payment_transaction ───────────────────────────────────────────
  const { data: payment, error: paymentErr } = await supabase
    .from('payment_transactions')
    .select('id, booking_id, tenant_id, customer_id, amount_kobo, is_deposit, status')
    .eq('provider_ref', reference)
    .single()

  if (paymentErr || !payment) {
    console.error('confirm-payment: payment_transaction not found for ref', reference)
    return json({ success: true, error: 'Transaction not found' }, 200)
  }

  // ── 5. Idempotency — already processed? ───────────────────────────────────────
  if (eventType === 'charge.success' && payment.status === 'completed') {
    return json({ success: true, already_processed: true }, 200)
  }
  if (eventType === 'charge.failed' && payment.status === 'failed') {
    return json({ success: true, already_processed: true }, 200)
  }

  // ── 6a. charge.success path ───────────────────────────────────────────────────
  if (eventType === 'charge.success') {

    // Update payment_transactions → completed
    await supabase
      .from('payment_transactions')
      .update({ status: 'completed', provider_payload: data })
      .eq('id', payment.id)

    // Transition booking: held → confirmed (only if still held — prevents double-confirm)
    const { data: booking } = await supabase
      .from('bookings')
      .update({
        status:       'confirmed',
        deposit_paid: true,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', payment.booking_id)
      .eq('status', 'held')        // guard: only transition from held
      .select('id, tenant_id, customer_id, staff_id, starts_at, total_amount_kobo')
      .single()

    if (!booking) {
      // Booking expired (held_until elapsed) or was already confirmed by a concurrent event
      console.warn('confirm-payment: booking not in held state — skipping confirm', payment.booking_id)
      return json({ success: true, booking_status: 'not_held' }, 200)
    }

    // Credit loyalty points (idempotent via idempotency_key)
    const loyaltyKey = `loyalty-booking-${booking.id}`
    const { data: existingLoyalty } = await supabase
      .from('loyalty_transactions')
      .select('id')
      .eq('idempotency_key', loyaltyKey)
      .maybeSingle()

    if (!existingLoyalty) {
      const pointsEarned = Math.floor((booking.total_amount_kobo as number) / LOYALTY_KOBO_PER_POINT)

      const { data: loyaltyAccount } = await supabase
        .from('loyalty_accounts')
        .select('id, points_balance')
        .eq('customer_id', booking.customer_id)
        .eq('tenant_id', booking.tenant_id)
        .single()

      if (loyaltyAccount && pointsEarned > 0) {
        await supabase.from('loyalty_transactions').insert({
          tenant_id:          booking.tenant_id,
          customer_id:        booking.customer_id,
          loyalty_account_id: loyaltyAccount.id,
          booking_id:         booking.id,
          points:             pointsEarned,
          transaction_type:   'earn',
          description:        'Booking deposit confirmed',
          idempotency_key:    loyaltyKey,
        })

        await supabase
          .from('loyalty_accounts')
          .update({ points_balance: (loyaltyAccount.points_balance as number) + pointsEarned })
          .eq('id', loyaltyAccount.id)
      }
    }

    // Queue reminder automation_jobs (idempotent via idempotency_key UNIQUE constraint)
    const startsAt    = new Date(booking.starts_at as string)
    const now         = new Date()
    const reminder24h = new Date(startsAt.getTime() - 24 * 60 * 60_000)
    const reminder2h  = new Date(startsAt.getTime() -  2 * 60 * 60_000)

    const reminders = [
      { key: `reminder-24h-${booking.id}`, run_at: reminder24h, hours_before: 24 },
      { key: `reminder-2h-${booking.id}`,  run_at: reminder2h,  hours_before: 2  },
    ].filter(r => r.run_at > now)

    for (const r of reminders) {
      await supabase
        .from('automation_jobs')
        .insert({
          tenant_id:       booking.tenant_id,
          job_type:        'booking_reminder',
          payload:         { booking_id: booking.id, hours_before: r.hours_before },
          run_at:          r.run_at.toISOString(),
          idempotency_key: r.key,
          status:          'pending',
        })
        .select()   // suppress "insert or ignore" — unique constraint handles duplicates
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      tenant_id:  booking.tenant_id,
      actor_id:   booking.customer_id,
      action:     'booking.confirmed',
      table_name: 'bookings',
      record_id:  booking.id,
      new_data:   { status: 'confirmed', deposit_paid: true, reference },
    })

    return json({
      success:     true,
      booking_id:  booking.id,
      status:      'confirmed',
      points_key:  loyaltyKey,
    }, 200)
  }

  // ── 6b. charge.failed path ────────────────────────────────────────────────────
  // Update payment_transactions → failed
  await supabase
    .from('payment_transactions')
    .update({ status: 'failed', provider_payload: data })
    .eq('id', payment.id)

  // Cancel the held booking — DB trigger fires notify_waitlist automatically
  await supabase
    .from('bookings')
    .update({
      status:              'cancelled',
      cancellation_reason: 'payment_failed',
      cancelled_at:        new Date().toISOString(),
    })
    .eq('id', payment.booking_id)
    .eq('status', 'held')

  // Audit log
  await supabase.from('audit_logs').insert({
    tenant_id:  payment.tenant_id,
    actor_id:   payment.customer_id,
    action:     'booking.cancelled',
    table_name: 'bookings',
    record_id:  payment.booking_id,
    new_data:   { status: 'cancelled', cancellation_reason: 'payment_failed', reference },
  })

  return json({
    success:    true,
    booking_id: payment.booking_id,
    status:     'cancelled',
    reason:     'payment_failed',
  }, 200)
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
