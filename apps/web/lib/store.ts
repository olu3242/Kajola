// In-memory singleton store for LOCAL mode (no Supabase required)

export type BookingStatus =
  | 'pending'
  | 'held'
  | 'awaiting_payment'
  | 'confirmed'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'disputed';

export interface StoreBooking {
  id: string;
  tenant_id: string;
  provider_id: string;
  client_id: string;
  service_id: string;
  staff_id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  held_until: string | null;
  total_amount_kobo: number;
  deposit_amount_kobo: number;
  deposit_paid_at: string | null;
  idempotency_key: string;
  created_at: string;
  payment_ref: string | null;
}

export interface StoreService {
  id: string;
  provider_id: string;
  tenant_id: string;
  name: string;
  duration_minutes: number;
  price_kobo: number;
  is_active: boolean;
}

export interface StoreProvider {
  id: string;
  tenant_id: string;
  full_name: string;
  business_name: string;
  category: string;
  city: string;
  phone: string;
  avg_rating: number;
  total_reviews: number;
  completed_jobs: number;
  is_verified: boolean;
}

export interface StoreAvailWindow {
  provider_id: string;
  day_of_week: number; // 0=Sunday, 1=Monday, ... 6=Saturday
  starts_at: string;   // "HH:MM"
  ends_at: string;     // "HH:MM"
}

export interface StoreReview {
  id: string;
  booking_id: string;
  provider_id: string;
  client_id: string;
  rating: number;
  comment: string;
  created_at: string;
}

export interface StoreGratuity {
  id: string;
  booking_id: string;
  provider_id: string;
  client_id: string;
  amount_kobo: number;
  message: string;
  created_at: string;
}

export interface StoreUser {
  id: string;
  phone: string;
  full_name: string;
  role: 'client' | 'artisan' | 'owner';
  tenant_id: string | null;
}

export interface StorePayment {
  id: string;
  booking_id: string;
  reference: string;
  amount_kobo: number;
  status: 'pending' | 'success' | 'failed';
  created_at: string;
}

export interface StoreNotification {
  id: string;
  user_id: string;
  type: string;
  payload: object;
  sent_at: string | null;
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const providers: StoreProvider[] = [
  {
    id: 'ada-1',
    tenant_id: 'ada-1-tenant',
    full_name: 'Ada Okonkwo',
    business_name: "Ada's Glow Studio",
    category: 'Beauty',
    city: 'lekki',
    phone: '+2348011111001',
    avg_rating: 4.8,
    total_reviews: 124,
    completed_jobs: 310,
    is_verified: true,
  },
  {
    id: 'kofi-1',
    tenant_id: 'kofi-1-tenant',
    full_name: 'Kofi Mensah',
    business_name: 'Kofi Cuts Barbershop',
    category: 'Barbershop',
    city: 'victoria-island',
    phone: '+2348011111002',
    avg_rating: 4.7,
    total_reviews: 98,
    completed_jobs: 245,
    is_verified: true,
  },
  {
    id: 'ngozi-1',
    tenant_id: 'ngozi-1-tenant',
    full_name: 'Ngozi Eze',
    business_name: 'Ngozi Nail Palace',
    category: 'Nails',
    city: 'surulere',
    phone: '+2348011111003',
    avg_rating: 4.9,
    total_reviews: 201,
    completed_jobs: 480,
    is_verified: true,
  },
  {
    id: 'tunde-1',
    tenant_id: 'tunde-1-tenant',
    full_name: 'Tunde Adeyemi',
    business_name: "Tunde's Fade Room",
    category: 'Barbershop',
    city: 'ikeja',
    phone: '+2348011111004',
    avg_rating: 4.6,
    total_reviews: 77,
    completed_jobs: 189,
    is_verified: true,
  },
  {
    id: 'amaka-1',
    tenant_id: 'amaka-1-tenant',
    full_name: 'Amaka Obi',
    business_name: 'Amaka Brow & Lash',
    category: 'Beauty',
    city: 'yaba',
    phone: '+2348011111005',
    avg_rating: 4.9,
    total_reviews: 156,
    completed_jobs: 390,
    is_verified: true,
  },
];

const services: StoreService[] = [
  // Ada's Glow Studio — Beauty (lekki)
  { id: 'ada-svc-1', provider_id: 'ada-1', tenant_id: 'ada-1-tenant', name: 'Haircut & Style', duration_minutes: 60, price_kobo: 350000, is_active: true },
  { id: 'ada-svc-2', provider_id: 'ada-1', tenant_id: 'ada-1-tenant', name: 'Lash Extensions', duration_minutes: 90, price_kobo: 450000, is_active: true },
  { id: 'ada-svc-3', provider_id: 'ada-1', tenant_id: 'ada-1-tenant', name: 'Facial Treatment', duration_minutes: 60, price_kobo: 400000, is_active: true },

  // Kofi Cuts — Barbershop (victoria-island)
  { id: 'kofi-svc-1', provider_id: 'kofi-1', tenant_id: 'kofi-1-tenant', name: 'Haircut', duration_minutes: 30, price_kobo: 250000, is_active: true },
  { id: 'kofi-svc-2', provider_id: 'kofi-1', tenant_id: 'kofi-1-tenant', name: 'Beard Trim & Shape', duration_minutes: 30, price_kobo: 150000, is_active: true },
  { id: 'kofi-svc-3', provider_id: 'kofi-1', tenant_id: 'kofi-1-tenant', name: 'Hair Wash', duration_minutes: 20, price_kobo: 100000, is_active: true },

  // Ngozi Nail Palace — Nails (surulere)
  { id: 'ngozi-svc-1', provider_id: 'ngozi-1', tenant_id: 'ngozi-1-tenant', name: 'Manicure', duration_minutes: 45, price_kobo: 200000, is_active: true },
  { id: 'ngozi-svc-2', provider_id: 'ngozi-1', tenant_id: 'ngozi-1-tenant', name: 'Pedicure', duration_minutes: 60, price_kobo: 250000, is_active: true },
  { id: 'ngozi-svc-3', provider_id: 'ngozi-1', tenant_id: 'ngozi-1-tenant', name: 'Gel Nails', duration_minutes: 90, price_kobo: 350000, is_active: true },

  // Tunde's Fade Room — Barbershop (ikeja)
  { id: 'tunde-svc-1', provider_id: 'tunde-1', tenant_id: 'tunde-1-tenant', name: 'Fade', duration_minutes: 45, price_kobo: 400000, is_active: true },
  { id: 'tunde-svc-2', provider_id: 'tunde-1', tenant_id: 'tunde-1-tenant', name: 'Taper Cut', duration_minutes: 45, price_kobo: 350000, is_active: true },
  { id: 'tunde-svc-3', provider_id: 'tunde-1', tenant_id: 'tunde-1-tenant', name: 'Dreadlock Retwist', duration_minutes: 120, price_kobo: 600000, is_active: true },

  // Amaka Brow & Lash — Beauty (yaba)
  { id: 'amaka-svc-1', provider_id: 'amaka-1', tenant_id: 'amaka-1-tenant', name: 'Brow Threading', duration_minutes: 20, price_kobo: 120000, is_active: true },
  { id: 'amaka-svc-2', provider_id: 'amaka-1', tenant_id: 'amaka-1-tenant', name: 'Lash Lift', duration_minutes: 60, price_kobo: 350000, is_active: true },
  { id: 'amaka-svc-3', provider_id: 'amaka-1', tenant_id: 'amaka-1-tenant', name: 'Full Glam Makeup', duration_minutes: 90, price_kobo: 800000, is_active: true },
];

// Mon–Sat (1–6) 09:00–17:00 for all providers
const availWindows: StoreAvailWindow[] = [];
for (const p of providers) {
  for (let day = 1; day <= 6; day++) {
    availWindows.push({ provider_id: p.id, day_of_week: day, starts_at: '09:00', ends_at: '17:00' });
  }
}

const users: StoreUser[] = [
  // Test client
  { id: 'client-1', phone: '+2348012345678', full_name: 'Chidi Nwosu', role: 'client', tenant_id: null },
  // Test owner (owns Ada's tenant)
  { id: 'owner-1', phone: '+2348098765432', full_name: 'Owner Ada', role: 'owner', tenant_id: 'ada-1-tenant' },
  // Artisan profiles for each provider
  { id: 'ada-1', phone: '+2348011111001', full_name: 'Ada Okonkwo', role: 'artisan', tenant_id: 'ada-1-tenant' },
  { id: 'kofi-1', phone: '+2348011111002', full_name: 'Kofi Mensah', role: 'artisan', tenant_id: 'kofi-1-tenant' },
  { id: 'ngozi-1', phone: '+2348011111003', full_name: 'Ngozi Eze', role: 'artisan', tenant_id: 'ngozi-1-tenant' },
  { id: 'tunde-1', phone: '+2348011111004', full_name: 'Tunde Adeyemi', role: 'artisan', tenant_id: 'tunde-1-tenant' },
  { id: 'amaka-1', phone: '+2348011111005', full_name: 'Amaka Obi', role: 'artisan', tenant_id: 'amaka-1-tenant' },
];

// Mutable arrays for runtime data
const bookings: StoreBooking[] = [];
const payments: StorePayment[] = [];
const reviews: StoreReview[] = [];
const gratuities: StoreGratuity[] = [];
const notifications: StoreNotification[] = [];

export const store = {
  providers,
  services,
  availWindows,
  bookings,
  payments,
  reviews,
  gratuities,
  users,
  notifications,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "local:<userId>:<role>" or "local:<userId>" from an access token */
export function getUserFromToken(token: string): StoreUser | null {
  if (!token.startsWith('local:')) return null;
  const parts = token.slice('local:'.length).split(':');
  const userId = parts[0];
  if (!userId) return null;
  return store.users.find((u) => u.id === userId) ?? null;
}

/** True if user is a client (can access any tenant) or belongs to the given tenant */
export function assertTenant(user: StoreUser, tenantId: string): boolean {
  if (user.role === 'client') return true;
  return user.tenant_id === tenantId;
}

// ---------------------------------------------------------------------------
// Slot generation
// ---------------------------------------------------------------------------

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  'held',
  'awaiting_payment',
  'confirmed',
  'checked_in',
  'in_progress',
];

function timeToParts(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { h, m };
}

/**
 * Generate 60-minute slots for the next 7 days from fromDate for the given
 * provider+service pair. A slot is unavailable if an active booking overlaps it.
 */
export function generateSlots(
  providerId: string,
  serviceId: string,
  fromDate: Date,
): Array<{ starts_at: string; ends_at: string; available: boolean }> {
  const service = store.services.find((s) => s.id === serviceId && s.provider_id === providerId);
  const slotDurationMs = service ? service.duration_minutes * 60 * 1000 : 60 * 60 * 1000;

  const windows = store.availWindows.filter((w) => w.provider_id === providerId);
  const slots: Array<{ starts_at: string; ends_at: string; available: boolean }> = [];

  // Active bookings for this provider (to check overlap)
  const activeBookings = store.bookings.filter(
    (b) => b.provider_id === providerId && ACTIVE_BOOKING_STATUSES.includes(b.status),
  );

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const day = new Date(fromDate);
    day.setDate(day.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);

    const dow = day.getDay(); // 0=Sunday
    const window = windows.find((w) => w.day_of_week === dow);
    if (!window) continue;

    const { h: startH, m: startM } = timeToParts(window.starts_at);
    const { h: endH, m: endM } = timeToParts(window.ends_at);

    let cursor = new Date(day);
    cursor.setHours(startH, startM, 0, 0);
    const windowEnd = new Date(day);
    windowEnd.setHours(endH, endM, 0, 0);

    while (cursor.getTime() + slotDurationMs <= windowEnd.getTime()) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + slotDurationMs);

      const isBooked = activeBookings.some((b) => {
        const bStart = new Date(b.starts_at).getTime();
        const bEnd = new Date(b.ends_at).getTime();
        return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
      });

      slots.push({
        starts_at: slotStart.toISOString(),
        ends_at: slotEnd.toISOString(),
        available: !isBooked,
      });

      cursor = new Date(cursor.getTime() + slotDurationMs);
    }
  }

  return slots;
}
