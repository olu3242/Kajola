import { randomUUID } from 'crypto';
import {
  store,
  generateSlots,
  assertTenant,
  StoreBooking,
  StoreGratuity,
  StoreProvider,
  StoreReview,
  StoreService,
  StoreUser,
  BookingStatus,
} from './store';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function handleLogin(body: {
  phone: string;
  otp: string;
}): Promise<{ ok: boolean; user?: StoreUser; error?: string }> {
  if (body.otp !== '123456') {
    return { ok: false, error: 'Invalid OTP' };
  }
  const user = store.users.find((u) => u.phone === body.phone);
  if (!user) {
    return { ok: false, error: 'Phone number not found' };
  }
  return { ok: true, user };
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export function listProviders(params: {
  city?: string;
  category?: string;
  limit?: number;
}): StoreProvider[] {
  let result = [...store.providers];
  if (params.city) {
    const city = params.city.toLowerCase();
    result = result.filter((p) => p.city.toLowerCase() === city);
  }
  if (params.category) {
    const cat = params.category.toLowerCase();
    result = result.filter((p) => p.category.toLowerCase() === cat);
  }
  if (params.limit && params.limit > 0) {
    result = result.slice(0, params.limit);
  }
  return result;
}

export function getProvider(id: string): StoreProvider | null {
  return store.providers.find((p) => p.id === id) ?? null;
}

export function getProviderServices(providerId: string): StoreService[] {
  return store.services.filter((s) => s.provider_id === providerId && s.is_active);
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export function getAvailableSlots(
  providerId: string,
  serviceId: string,
): Array<{ id: string; starts_at: string; ends_at: string; available: boolean }> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const raw = generateSlots(providerId, serviceId, tomorrow);
  return raw.map((s, idx) => ({ id: `slot-${idx}`, ...s }));
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: BookingStatus[] = [
  'held',
  'awaiting_payment',
  'confirmed',
  'checked_in',
  'in_progress',
];

export async function holdSlot(
  user: StoreUser,
  body: {
    provider_id: string;
    service_id: string;
    starts_at: string;
    ends_at: string;
  },
): Promise<{ booking?: StoreBooking; error?: string }> {
  const service = store.services.find(
    (s) => s.id === body.service_id && s.provider_id === body.provider_id,
  );
  if (!service) {
    return { error: 'Service not found for this provider' };
  }

  const provider = store.providers.find((p) => p.id === body.provider_id);
  if (!provider) {
    return { error: 'Provider not found' };
  }

  const slotStart = new Date(body.starts_at).getTime();
  const slotEnd = new Date(body.ends_at).getTime();

  // Conflict check
  const conflict = store.bookings.find((b) => {
    if (b.provider_id !== body.provider_id) return false;
    if (!ACTIVE_STATUSES.includes(b.status)) return false;
    const bStart = new Date(b.starts_at).getTime();
    const bEnd = new Date(b.ends_at).getTime();
    return slotStart < bEnd && slotEnd > bStart;
  });

  if (conflict) {
    return { error: 'Slot already taken' };
  }

  const now = new Date();
  const heldUntil = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes

  const booking: StoreBooking = {
    id: randomUUID(),
    tenant_id: provider.tenant_id,
    provider_id: body.provider_id,
    client_id: user.id,
    service_id: body.service_id,
    staff_id: body.provider_id, // provider IS the staff in this MVP
    status: 'held',
    starts_at: body.starts_at,
    ends_at: body.ends_at,
    held_until: heldUntil.toISOString(),
    total_amount_kobo: service.price_kobo,
    deposit_amount_kobo: Math.round(service.price_kobo * 0.3),
    deposit_paid_at: null,
    idempotency_key: randomUUID(),
    created_at: now.toISOString(),
    payment_ref: null,
  };

  store.bookings.push(booking);
  return { booking };
}

export async function initPayment(
  user: StoreUser,
  bookingId: string,
): Promise<{ reference: string; authorization_url: string; error?: string }> {
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return { reference: '', authorization_url: '', error: 'Booking not found' };
  }
  if (booking.client_id !== user.id && user.role !== 'owner') {
    return { reference: '', authorization_url: '', error: 'Forbidden' };
  }

  const reference = `PAY-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

  const payment = {
    id: randomUUID(),
    booking_id: bookingId,
    reference,
    amount_kobo: booking.deposit_amount_kobo,
    status: 'pending' as const,
    created_at: new Date().toISOString(),
  };
  store.payments.push(payment);

  // Update booking status
  booking.status = 'awaiting_payment';
  booking.payment_ref = reference;

  return {
    reference,
    authorization_url: `/payment/callback?reference=${reference}&bookingId=${bookingId}`,
  };
}

export async function verifyPayment(
  user: StoreUser,
  reference: string,
  bookingId: string,
): Promise<{ success: boolean; booking?: StoreBooking; error?: string }> {
  const payment = store.payments.find((p) => p.reference === reference);
  if (!payment) {
    return { success: false, error: 'Payment reference not found' };
  }

  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return { success: false, error: 'Booking not found' };
  }

  if (booking.client_id !== user.id && user.role !== 'owner') {
    return { success: false, error: 'Forbidden' };
  }

  payment.status = 'success';
  booking.deposit_paid_at = new Date().toISOString();
  booking.status = 'confirmed';

  return { success: true, booking };
}

export function listBookings(user: StoreUser): StoreBooking[] {
  if (user.role === 'client') {
    return store.bookings.filter((b) => b.client_id === user.id);
  }
  if (user.role === 'artisan') {
    return store.bookings.filter((b) => b.provider_id === user.id);
  }
  // owner: bookings in their tenant
  return store.bookings.filter((b) => b.tenant_id === user.tenant_id);
}

// Artisan allowed transitions
const ARTISAN_TRANSITIONS: Record<string, BookingStatus> = {
  confirmed: 'checked_in',
  checked_in: 'in_progress',
  in_progress: 'completed',
};

// Client allowed source statuses for cancellation
const CLIENT_CANCELLABLE: BookingStatus[] = ['held', 'awaiting_payment', 'confirmed'];

export async function updateBookingStatus(
  user: StoreUser,
  bookingId: string,
  newStatus: string,
): Promise<{ booking?: StoreBooking; error?: string }> {
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return { error: 'Booking not found' };
  }

  // Tenant isolation check (clients exempt)
  if (user.role !== 'client' && !assertTenant(user, booking.tenant_id)) {
    return { error: 'Forbidden: tenant mismatch' };
  }

  const current = booking.status;

  if (user.role === 'artisan') {
    if (newStatus === 'no_show') {
      if (current !== 'in_progress' && current !== 'confirmed') {
        return { error: `Cannot transition from ${current} to no_show` };
      }
    } else {
      const allowed = ARTISAN_TRANSITIONS[current];
      if (!allowed || allowed !== (newStatus as BookingStatus)) {
        return { error: `Artisan cannot transition from ${current} to ${newStatus}` };
      }
    }
    // Verify artisan owns this booking
    if (booking.provider_id !== user.id) {
      return { error: 'Forbidden: not your booking' };
    }
  } else if (user.role === 'client') {
    if (newStatus !== 'cancelled') {
      return { error: 'Clients may only cancel bookings' };
    }
    if (!CLIENT_CANCELLABLE.includes(current)) {
      return { error: `Cannot cancel a booking with status ${current}` };
    }
    if (booking.client_id !== user.id) {
      return { error: 'Forbidden: not your booking' };
    }
  } else if (user.role === 'owner') {
    // Owner can do any transition within their tenant — no additional restriction
    if (booking.tenant_id !== user.tenant_id) {
      return { error: 'Forbidden: tenant mismatch' };
    }
  }

  booking.status = newStatus as BookingStatus;
  return { booking };
}

// ---------------------------------------------------------------------------
// Reviews & Gratuities
// ---------------------------------------------------------------------------

export async function submitReview(
  user: StoreUser,
  body: { booking_id: string; rating: number; comment: string },
): Promise<{ review?: StoreReview; error?: string }> {
  const booking = store.bookings.find((b) => b.id === body.booking_id);
  if (!booking) return { error: 'Booking not found' };
  if (booking.client_id !== user.id) return { error: 'Forbidden: not your booking' };
  if (booking.status !== 'completed') return { error: 'Can only review completed bookings' };

  const existing = store.reviews.find((r) => r.booking_id === body.booking_id);
  if (existing) return { error: 'Review already submitted for this booking' };

  if (body.rating < 1 || body.rating > 5) return { error: 'Rating must be between 1 and 5' };

  const review: StoreReview = {
    id: randomUUID(),
    booking_id: body.booking_id,
    provider_id: booking.provider_id,
    client_id: user.id,
    rating: body.rating,
    comment: body.comment,
    created_at: new Date().toISOString(),
  };
  store.reviews.push(review);

  // Update provider aggregate
  const provider = store.providers.find((p) => p.id === booking.provider_id);
  if (provider) {
    const total = provider.total_reviews + 1;
    provider.avg_rating =
      Math.round(((provider.avg_rating * provider.total_reviews + body.rating) / total) * 10) / 10;
    provider.total_reviews = total;
  }

  return { review };
}

export async function submitGratuity(
  user: StoreUser,
  body: { booking_id: string; amount_kobo: number; message?: string },
): Promise<{ gratuity?: StoreGratuity; error?: string }> {
  const booking = store.bookings.find((b) => b.id === body.booking_id);
  if (!booking) return { error: 'Booking not found' };
  if (booking.client_id !== user.id) return { error: 'Forbidden: not your booking' };
  if (booking.status !== 'completed') return { error: 'Can only tip for completed bookings' };
  if (body.amount_kobo <= 0) return { error: 'Tip amount must be positive' };

  const gratuity: StoreGratuity = {
    id: randomUUID(),
    booking_id: body.booking_id,
    provider_id: booking.provider_id,
    client_id: user.id,
    amount_kobo: body.amount_kobo,
    message: body.message ?? '',
    created_at: new Date().toISOString(),
  };
  store.gratuities.push(gratuity);
  return { gratuity };
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export function artisanDashboard(user: StoreUser): object {
  const myBookings = store.bookings.filter((b) => b.provider_id === user.id);
  const completed = myBookings.filter((b) => b.status === 'completed');
  const revenueKobo = completed.reduce((sum, b) => sum + b.total_amount_kobo, 0);

  const myReviews = store.reviews.filter((r) => r.provider_id === user.id);
  const avgRating =
    myReviews.length > 0
      ? Math.round((myReviews.reduce((s, r) => s + r.rating, 0) / myReviews.length) * 10) / 10
      : 0;

  const todayStr = new Date().toISOString().slice(0, 10);
  const bookingsToday = myBookings.filter((b) => b.starts_at.startsWith(todayStr));

  const upcoming = myBookings.filter((b) =>
    ['confirmed', 'held', 'awaiting_payment'].includes(b.status),
  );

  return {
    total_completed: completed.length,
    revenue_kobo: revenueKobo,
    avg_rating: avgRating,
    bookings_today: bookingsToday.length,
    bookings_upcoming: upcoming.length,
  };
}

export function ownerDashboard(user: StoreUser): object {
  if (!user.tenant_id) {
    return { error: 'Owner has no tenant' };
  }
  const tenantBookings = store.bookings.filter((b) => b.tenant_id === user.tenant_id);
  const completed = tenantBookings.filter((b) => b.status === 'completed');
  const cancelled = tenantBookings.filter((b) => b.status === 'cancelled');
  const noShows = tenantBookings.filter((b) => b.status === 'no_show');

  const revenueKobo = completed.reduce((sum, b) => sum + b.total_amount_kobo, 0);
  const total = tenantBookings.length;
  const cancellationRate = total > 0 ? Math.round((cancelled.length / total) * 100) / 100 : 0;
  const noShowRate = total > 0 ? Math.round((noShows.length / total) * 100) / 100 : 0;

  const providerIds = store.providers
    .filter((p) => p.tenant_id === user.tenant_id)
    .map((p) => p.id);
  const tenantReviews = store.reviews.filter((r) => providerIds.includes(r.provider_id));
  const avgRating =
    tenantReviews.length > 0
      ? Math.round(
          (tenantReviews.reduce((s, r) => s + r.rating, 0) / tenantReviews.length) * 10,
        ) / 10
      : 0;

  // Bookings by day (last 7 days)
  const bookingsByDay: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    bookingsByDay[key] = 0;
  }
  for (const b of tenantBookings) {
    const day = b.created_at.slice(0, 10);
    if (day in bookingsByDay) {
      bookingsByDay[day]++;
    }
  }

  const bookingsByDayArray = Object.entries(bookingsByDay).map(([date, count]) => ({
    date,
    count,
    revenue_kobo: completed
      .filter((b) => b.created_at.slice(0, 10) === date)
      .reduce((s, b) => s + b.total_amount_kobo, 0),
  }));

  return {
    kpis: {
      completed_count: completed.length,
      revenue_kobo: revenueKobo,
      cancellation_rate: cancellationRate,
      no_show_rate: noShowRate,
      avg_rating: avgRating,
      bookings_by_day: bookingsByDayArray,
    },
  };
}

