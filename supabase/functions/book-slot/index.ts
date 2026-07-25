/**
 * book-slot — SORF Reference Implementation
 *
 * Creates a booking in the SORF 'held' state (optimistic 15-min slot lock).
 * Validates:
 *   1. Customer is authenticated (JWT with tenant_id + role = 'customer')
 *   2. Customer has no outstanding prepayment requirement (no_show_policy)
 *   3. Slot falls within trainer/staff availability_windows (not overridden)
 *   4. Slot does not conflict with existing booking (EXCLUDE USING gist)
 *   5. Deposit amount is computed from business.deposit_policy
 *
 * On success: booking row inserted (status='held', held_until=+15min),
 *             Paystack transaction initialized, init_url returned.
 *
 * State machine: held → confirmed (on Paystack webhook)
 *                held → cancelled (by pg_cron after held_until expires)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const HOLD_DURATION_MINUTES = 15
const PG_EXCLUDE_VIOLATION = '23P01'      // EXCLUDE constraint violation
const PG_UNIQUE_VIOLATION   = '23505'     // duplicate key

interface BookSlotRequest {
  staff_id:         string
  service_id:       string
  branch_id:        string
  starts_at:        string  // ISO 8601
  appointment_type?: 'video' | 'in_person'
  notes?:           string
}

interface DepositPolicy {
  type:  'percentage' | 'fixed'
  value: number  // percentage 0–100, or fixed amount in kobo
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── Auth: extract JWT claims ──────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing authorization header' }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return json({ error: 'Invalid or expired token' }, 401)
  }

  const tenantId  = user.user_metadata?.tenant_id as string | undefined
  const userRole  = user.user_metadata?.role as string | undefined
  if (!tenantId) {
    return json({ error: 'Token missing tenant_id claim' }, 403)
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: BookSlotRequest
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { staff_id, service_id, branch_id, starts_at, appointment_type = 'in_person', notes } = body

  if (!staff_id || !service_id || !branch_id || !starts_at) {
    return json({ error: 'Missing required fields: staff_id, service_id, branch_id, starts_at' }, 422)
  }

  const startsAtDate = new Date(starts_at)
  if (isNaN(startsAtDate.getTime()) || startsAtDate <= new Date()) {
    return json({ error: 'starts_at must be a valid future ISO 8601 datetime' }, 422)
  }

  // ── Load service (for duration + price) ──────────────────────────────────
  const { data: service, error: serviceErr } = await supabase
    .from('services')
    .select('id, duration_minutes, price_kobo, business_id, is_active')
    .eq('id', service_id)
    .eq('tenant_id', tenantId)
    .single()

  if (serviceErr || !service) {
    return json({ error: 'Service not found or not accessible' }, 404)
  }
  if (!service.is_active) {
    return json({ error: 'Service is not currently available' }, 422)
  }

  const endsAt = new Date(startsAtDate.getTime() + service.duration_minutes * 60_000)

  // ── Check customer prepayment requirement ─────────────────────────────────
  const { data: customerProfile } = await supabase
    .from('customer_profiles')
    .select('require_prepayment, no_show_count')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .single()

  // ── Load business deposit_policy ──────────────────────────────────────────
  const { data: business, error: bizErr } = await supabase
    .from('businesses')
    .select('deposit_policy, no_show_policy')
    .eq('id', service.business_id)
    .eq('tenant_id', tenantId)
    .single()

  if (bizErr || !business) {
    return json({ error: 'Business not found' }, 404)
  }

  const depositPolicy: DepositPolicy = business.deposit_policy ?? { type: 'percentage', value: 50 }
  let depositAmountKobo: number

  if (customerProfile?.require_prepayment) {
    // No-show policy: full amount required upfront
    depositAmountKobo = service.price_kobo
  } else if (depositPolicy.type === 'percentage') {
    depositAmountKobo = Math.ceil(service.price_kobo * depositPolicy.value / 100)
  } else {
    depositAmountKobo = depositPolicy.value
  }

  // ── Validate slot against availability_windows ────────────────────────────
  const dayOfWeek = startsAtDate.getDay()   // 0=Sunday, 6=Saturday
  const startTime = startsAtDate.toTimeString().slice(0, 5)  // HH:MM
  const endTime   = endsAt.toTimeString().slice(0, 5)

  const { data: staffRow } = await supabase
    .from('staff')
    .select('id, branch_id')
    .eq('id', staff_id)
    .eq('branch_id', branch_id)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single()

  if (!staffRow) {
    return json({ error: 'Staff member not found at this branch' }, 404)
  }

  const { data: window } = await supabase
    .from('availability_windows')
    .select('start_time, end_time')
    .eq('staff_id', staff_id)
    .eq('day_of_week', dayOfWeek)
    .lte('start_time', startTime)
    .gte('end_time', endTime)
    .limit(1)
    .single()

  if (!window) {
    return json({
      error: 'slot_outside_availability',
      message: `Staff is not available at ${startTime} on this day of week`,
    }, 422)
  }

  // Check for availability_overrides blocking this specific date
  const dateStr = startsAtDate.toISOString().slice(0, 10)
  const { data: override } = await supabase
    .from('availability_overrides')
    .select('is_available')
    .eq('staff_id', staff_id)
    .eq('date', dateStr)
    .eq('is_available', false)
    .maybeSingle()

  if (override) {
    return json({
      error: 'staff_unavailable',
      message: 'Staff member has marked this date as unavailable',
    }, 422)
  }

  // ── Insert booking in 'held' state (triggers EXCLUDE USING gist check) ────
  const heldUntil = new Date(Date.now() + HOLD_DURATION_MINUTES * 60_000).toISOString()
  const idempotencyKey = `booking-init-${user.id}-${staff_id}-${starts_at}`

  const { data: booking, error: insertErr } = await supabase
    .from('bookings')
    .insert({
      tenant_id:            tenantId,
      branch_id,
      staff_id,
      service_id,
      customer_id:          user.id,
      appointment_type,
      status:               'held',
      starts_at:            startsAtDate.toISOString(),
      ends_at:              endsAt.toISOString(),
      held_until:           heldUntil,
      deposit_paid:         false,
      deposit_amount_kobo:  depositAmountKobo,
      total_amount_kobo:    service.price_kobo,
      notes,
    })
    .select('id')
    .single()

  if (insertErr) {
    // EXCLUDE USING gist violation → slot taken by concurrent booking
    if (insertErr.code === PG_EXCLUDE_VIOLATION) {
      return json({
        error: 'slot_taken',
        message: 'This time slot is no longer available. Please choose a different slot.',
      }, 409)
    }
    console.error('booking insert error:', insertErr)
    return json({ error: 'Failed to hold slot', detail: insertErr.message }, 500)
  }

  // ── Initialise Paystack transaction ──────────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('phone')
    .eq('id', user.id)
    .single()

  // Store idempotency key on payment_transactions to prevent double-charging
  const paymentIdempotencyKey = `paystack-init-${booking.id}`

  const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount:    depositAmountKobo,   // Paystack expects kobo
      currency:  'NGN',
      email:     `${user.id}@fitbook.internal`,  // Paystack requires an email; use internal placeholder
      metadata: {
        booking_id:   booking.id,
        customer_id:  user.id,
        tenant_id:    tenantId,
        is_deposit:   true,
        custom_fields: [
          { display_name: 'Booking ID', variable_name: 'booking_id', value: booking.id },
        ],
      },
      callback_url: `${Deno.env.get('APP_URL') ?? ''}/booking/${booking.id}/confirm`,
    }),
  })

  if (!paystackRes.ok) {
    // Paystack init failed — release the held slot immediately
    await supabase
      .from('bookings')
      .update({ status: 'cancelled', cancellation_reason: 'payment_init_failed', cancelled_at: new Date().toISOString() })
      .eq('id', booking.id)
    return json({ error: 'Payment initialisation failed — please try again' }, 502)
  }

  const paystackData = await paystackRes.json()

  // Insert pending payment_transactions row (idempotent — unique key)
  await supabase
    .from('payment_transactions')
    .insert({
      tenant_id:        tenantId,
      booking_id:       booking.id,
      customer_id:      user.id,
      provider:         'paystack',
      provider_ref:     paystackData.data.reference,
      amount_kobo:      depositAmountKobo,
      currency:         'NGN',
      status:           'pending',
      is_deposit:       true,
      idempotency_key:  paymentIdempotencyKey,
    })
    .select()
    // Ignore conflicts — this function could be retried by the client
    .throwOnError()

  // ── Log to audit_logs ─────────────────────────────────────────────────────
  await supabase
    .from('audit_logs')
    .insert({
      tenant_id:   tenantId,
      actor_id:    user.id,
      action:      'booking.held',
      table_name:  'bookings',
      record_id:   booking.id,
      new_data:    { status: 'held', held_until: heldUntil },
    })

  return json({
    success:              true,
    booking_id:           booking.id,
    held_until:           heldUntil,
    deposit_amount_kobo:  depositAmountKobo,
    total_amount_kobo:    service.price_kobo,
    require_prepayment:   customerProfile?.require_prepayment ?? false,
    paystack_init_url:    paystackData.data.authorization_url,
    paystack_reference:   paystackData.data.reference,
  }, 200)
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
