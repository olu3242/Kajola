// In-memory singleton store for LOCAL mode (no Supabase required)
import type { CommercePolicy, PaymentMethod, PaymentPurpose, PaymentStatus, SettlementStatus } from './commerce';

export type BookingStatus =
  | 'pending'
  | 'held'
  | 'awaiting_payment'
  | 'confirmed'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'requires_recovery'
  | 'expired'
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
  held_at: string | null;
  booking_state: 'DRAFT' | 'HELD' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'REQUIRES_RECOVERY' | 'CANCELLED' | 'EXPIRED' | 'COMPLETED' | 'CLOSED';
  payment_state: 'NOT_REQUIRED' | 'INTENT_REQUIRED' | 'INTENT_CREATED' | 'PENDING' | 'PARTIALLY_PAID' | 'CONFIRMED' | 'FAILED' | 'EXPIRED' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'DISPUTED';
  hold_state: 'ACTIVE' | 'CONVERTED' | 'EXPIRED' | 'RELEASED';
  fulfillment_state: 'NOT_SCHEDULED' | 'SCHEDULED' | 'PROVIDER_ACKNOWLEDGED' | 'CUSTOMER_CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'DISPUTED';
  settlement_state: 'NOT_ELIGIBLE' | 'PENDING_ELIGIBILITY' | 'ELIGIBLE' | 'QUEUED' | 'PROCESSING' | 'SETTLED' | 'FAILED' | 'RETRY_REQUIRED' | 'HELD' | 'REVERSED';
  recovery_state: 'NONE' | 'REQUIRED' | 'ALTERNATIVES_AVAILABLE' | 'AWAITING_CUSTOMER' | 'ACCEPTED' | 'REFUND_REQUIRED' | 'RESOLVED';
  total_amount_kobo: number;
  deposit_amount_kobo: number;
  deposit_paid_at: string | null;
  idempotency_key: string;
  created_at: string;
  payment_ref: string | null;
  payment_status: PaymentStatus;
  settlement_status: SettlementStatus;
  amount_paid_kobo: number;
  balance_due_kobo: number;
  commerce_policy_version: string;
  flow_instance_id?: string;
}

export interface StoreService {
  id: string;
  provider_id: string;
  tenant_id: string;
  name: string;
  duration_minutes: number;
  price_kobo: number;
  is_active: boolean;
  category_id?: string;
  service_type?: string;
  aliases?: string[];
}

export interface StoreProvider {
  id: string;
  tenant_id: string;
  full_name: string;
  business_name: string;
  category: string;
  city: string;
  state: string;
  phone: string;
  avg_rating: number;
  total_reviews: number;
  completed_jobs: number;
  is_verified: boolean;
  image_url: string;
  about?: string;
  address?: string;
  specialties?: string[];
  gallery_urls?: string[];
  business_category?: string;
  business_type?: string;
  custom_business_type?: string;
  payment_policy?: CommercePolicy;
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
  role: 'client' | 'artisan' | 'owner' | 'admin';
  tenant_id: string | null;
}

export interface StorePayment {
  id: string;
  booking_id: string;
  reference: string;
  amount_kobo: number;
  status: 'pending' | 'success' | 'failed';
  created_at: string;
  method: PaymentMethod;
  purpose: PaymentPurpose;
  subtotal_kobo: number;
  gateway_fee_kobo: number;
  platform_fee_kobo: number;
  provider_net_kobo: number;
  policy_version: string;
}

export interface StoreLedgerEntry {
  id: string;
  booking_id: string;
  payment_id: string;
  account: 'customer' | 'provider' | 'platform' | 'gateway';
  direction: 'debit' | 'credit';
  amount_kobo: number;
  event: 'payment_succeeded' | 'tip_succeeded' | 'refund';
  created_at: string;
  idempotency_key?: string;
}

export interface StoreRecoveryRecommendation {
  id: string;
  recovery_case_id: string;
  provider_id: string;
  starts_at: string;
  ends_at: string;
  rank: number;
  status: 'OFFERED' | 'ACCEPTED' | 'REJECTED';
}

export interface StoreRecoveryCase {
  id: string;
  booking_id: string;
  payment_id: string;
  state: 'REQUIRED' | 'AWAITING_CUSTOMER' | 'ACCEPTED' | 'REFUND_REQUIRED' | 'RESOLVED';
  failure_reason: 'LATE_PAYMENT_AFTER_HOLD_EXPIRY';
  policy_version: string;
  recommendations: StoreRecoveryRecommendation[];
  created_at: string;
}

export interface StoreNotification {
  id: string;
  user_id: string;
  type: string;
  payload: object;
  sent_at: string | null;
}

export interface StoreDomainEvent {
  event_id: string;
  event_type: string;
  version: 1;
  tenant_id: string | null;
  branch_id: string | null;
  actor_id: string;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface StoreAuditRecord {
  id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  tenant_id: string | null;
  old_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  created_at: string;
}

export interface StoreWorkflowJob {
  id: string;
  event_id: string;
  type: string;
  run_at: string;
  status: 'scheduled' | 'completed' | 'failed';
  attempts: number;
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
    state: 'Lagos',
    phone: '+2348011111001',
    avg_rating: 4.8,
    total_reviews: 124,
    completed_jobs: 310,
    is_verified: true,
    image_url: '/landing/hair-braider.jpg',
    about: 'Protective styling, healthy-hair care, and polished beauty services in Lekki.',
    address: 'Admiralty Way, Lekki Phase 1',
    specialties: ['Box Braids', 'Knotless Braids', 'Natural Hair'],
    gallery_urls: ['/landing/hair-braider.jpg', '/landing/salon-owner.jpg'],
  },
  {
    id: 'kofi-1',
    tenant_id: 'kofi-1-tenant',
    full_name: 'Kofi Mensah',
    business_name: 'Kofi Cuts Barbershop',
    category: 'Barbershop',
    city: 'victoria-island',
    state: 'Lagos',
    phone: '+2348011111002',
    avg_rating: 4.7,
    total_reviews: 98,
    completed_jobs: 245,
    is_verified: true,
    image_url: '/landing/barber-bookings.png',
    about: 'Precision cuts, beard care, and dependable grooming appointments.',
    address: 'Akin Adesola Street, Victoria Island',
    specialties: ['Male Haircut', 'Haircut & Beard', 'Beard Trim'],
    gallery_urls: ['/landing/barber-bookings.png'],
  },
  {
    id: 'ngozi-1',
    tenant_id: 'ngozi-1-tenant',
    full_name: 'Ngozi Eze',
    business_name: 'Ngozi Nail Palace',
    category: 'Nails',
    city: 'surulere',
    state: 'Lagos',
    phone: '+2348011111003',
    avg_rating: 4.9,
    total_reviews: 201,
    completed_jobs: 480,
    is_verified: true,
    image_url: '/landing/salon-owner.jpg',
    about: 'Detailed nail care with transparent pricing and bookable appointment times.',
    address: 'Bode Thomas Street, Surulere',
    specialties: ['Pedicure', 'Gel Nails', 'Manicure'],
    gallery_urls: ['/landing/salon-owner.jpg'],
  },
  {
    id: 'tunde-1',
    tenant_id: 'tunde-1-tenant',
    full_name: 'Tunde Adeyemi',
    business_name: "Tunde's Fade Room",
    category: 'Barbershop',
    city: 'ikeja',
    state: 'Lagos',
    phone: '+2348011111004',
    avg_rating: 4.6,
    total_reviews: 77,
    completed_jobs: 189,
    is_verified: true,
    image_url: '/landing/barber-bookings.png',
    about: 'Contemporary barbering and loc maintenance in central Ikeja.',
    address: 'Allen Avenue, Ikeja',
    specialties: ['Fade', 'Haircut & Beard', 'Loc Retwist'],
    gallery_urls: ['/landing/barber-bookings.png'],
  },
  {
    id: 'amaka-1',
    tenant_id: 'amaka-1-tenant',
    full_name: 'Amaka Obi',
    business_name: 'Amaka Brow & Lash',
    category: 'Beauty',
    city: 'yaba',
    state: 'Lagos',
    phone: '+2348011111005',
    avg_rating: 4.9,
    total_reviews: 156,
    completed_jobs: 390,
    is_verified: true,
    image_url: '/landing/hair-braider.jpg',
    about: 'Brows, lashes, and occasion makeup from an experienced beauty professional.',
    address: 'Herbert Macaulay Way, Yaba',
    specialties: ['Eyelash Extensions', 'Eyebrow Tinting', 'Makeup'],
    gallery_urls: ['/landing/hair-braider.jpg', '/landing/salon-owner.jpg'],
  },
  {
    id: 'chinedu-1',
    tenant_id: 'chinedu-1-tenant',
    full_name: 'Chinedu Okafor',
    business_name: 'FixRight Home Services',
    category: 'Home services',
    city: 'abuja',
    state: 'Federal Capital Territory',
    phone: '+2348011111006',
    avg_rating: 4.7,
    total_reviews: 64,
    completed_jobs: 143,
    is_verified: true,
    image_url: '/landing/neighborhood-services.jpg',
    about: 'Verified plumbing, electrical, and household repair help across Abuja.',
    address: 'Gimbiya Street, Garki, Abuja',
    specialties: ['Plumbing', 'Electrical Repair', 'Handyman'],
    gallery_urls: ['/landing/neighborhood-services.jpg'],
  },
  {
    id: 'zainab-1',
    tenant_id: 'zainab-1-tenant',
    full_name: 'Zainab Musa',
    business_name: 'Zainab Wellness Studio',
    category: 'Massage',
    city: 'wuse',
    state: 'Federal Capital Territory',
    phone: '+2348011111007',
    avg_rating: 4.9,
    total_reviews: 88,
    completed_jobs: 176,
    is_verified: true,
    image_url: '/landing/salon-owner.jpg',
    about: 'Restorative massage and wellness appointments in Wuse.',
    address: 'Aminu Kano Crescent, Wuse 2',
    specialties: ['Deep Tissue Massage', 'Swedish Massage', 'Wellness'],
    gallery_urls: ['/landing/salon-owner.jpg'],
  },
];

const services: StoreService[] = [
  // Ada's Glow Studio — Beauty (lekki)
  { id: 'ada-svc-1', provider_id: 'ada-1', tenant_id: 'ada-1-tenant', name: 'Haircut & Style', duration_minutes: 60, price_kobo: 350000, is_active: true },
  { id: 'ada-svc-2', provider_id: 'ada-1', tenant_id: 'ada-1-tenant', name: 'Lash Extensions', duration_minutes: 90, price_kobo: 450000, is_active: true },
  { id: 'ada-svc-3', provider_id: 'ada-1', tenant_id: 'ada-1-tenant', name: 'Facial Treatment', duration_minutes: 60, price_kobo: 400000, is_active: true },
  { id: 'ada-svc-4', provider_id: 'ada-1', tenant_id: 'ada-1-tenant', name: 'Waist-Length Medium Knotless', duration_minutes: 240, price_kobo: 2800000, is_active: true, category_id: 'braids-locs', service_type: 'Knotless Braids', aliases: ['box braids', 'hair braids'] },

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
  { id: 'tunde-svc-4', provider_id: 'tunde-1', tenant_id: 'tunde-1-tenant', name: 'Classic Haircut & Beard', duration_minutes: 60, price_kobo: 550000, is_active: true, category_id: 'barber', service_type: 'Haircut & Beard', aliases: ['male haircut', 'beard trim'] },

  // Amaka Brow & Lash — Beauty (yaba)
  { id: 'amaka-svc-1', provider_id: 'amaka-1', tenant_id: 'amaka-1-tenant', name: 'Brow Threading', duration_minutes: 20, price_kobo: 120000, is_active: true },
  { id: 'amaka-svc-2', provider_id: 'amaka-1', tenant_id: 'amaka-1-tenant', name: 'Lash Lift', duration_minutes: 60, price_kobo: 350000, is_active: true },
  { id: 'amaka-svc-3', provider_id: 'amaka-1', tenant_id: 'amaka-1-tenant', name: 'Full Glam Makeup', duration_minutes: 90, price_kobo: 800000, is_active: true },

  { id: 'chinedu-svc-1', provider_id: 'chinedu-1', tenant_id: 'chinedu-1-tenant', name: 'Emergency Plumbing Repair', duration_minutes: 90, price_kobo: 1500000, is_active: true, category_id: 'home-services', service_type: 'Plumbing', aliases: ['plumber', 'leak repair'] },
  { id: 'chinedu-svc-2', provider_id: 'chinedu-1', tenant_id: 'chinedu-1-tenant', name: 'Electrical Fault Diagnosis', duration_minutes: 60, price_kobo: 1200000, is_active: true, category_id: 'repairs', service_type: 'Electrical Repair', aliases: ['electrician', 'home repair'] },
  { id: 'zainab-svc-1', provider_id: 'zainab-1', tenant_id: 'zainab-1-tenant', name: 'Deep Tissue Massage', duration_minutes: 60, price_kobo: 1800000, is_active: true, category_id: 'massage', service_type: 'Massage', aliases: ['body massage', 'therapy'] },
  { id: 'zainab-svc-2', provider_id: 'zainab-1', tenant_id: 'zainab-1-tenant', name: 'Swedish Massage', duration_minutes: 60, price_kobo: 1600000, is_active: true, category_id: 'massage', service_type: 'Massage', aliases: ['relaxation massage', 'spa'] },
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
  { id: 'admin-1', phone: '+2348000000001', full_name: 'Kajola Operator', role: 'admin', tenant_id: null },
  // Artisan profiles for each provider
  { id: 'ada-1', phone: '+2348011111001', full_name: 'Ada Okonkwo', role: 'artisan', tenant_id: 'ada-1-tenant' },
  { id: 'kofi-1', phone: '+2348011111002', full_name: 'Kofi Mensah', role: 'artisan', tenant_id: 'kofi-1-tenant' },
  { id: 'ngozi-1', phone: '+2348011111003', full_name: 'Ngozi Eze', role: 'artisan', tenant_id: 'ngozi-1-tenant' },
  { id: 'tunde-1', phone: '+2348011111004', full_name: 'Tunde Adeyemi', role: 'artisan', tenant_id: 'tunde-1-tenant' },
  { id: 'amaka-1', phone: '+2348011111005', full_name: 'Amaka Obi', role: 'artisan', tenant_id: 'amaka-1-tenant' },
  { id: 'chinedu-1', phone: '+2348011111006', full_name: 'Chinedu Okafor', role: 'artisan', tenant_id: 'chinedu-1-tenant' },
  { id: 'zainab-1', phone: '+2348011111007', full_name: 'Zainab Musa', role: 'artisan', tenant_id: 'zainab-1-tenant' },
];

// Mutable arrays for runtime data
const bookings: StoreBooking[] = [];
const payments: StorePayment[] = [];
const reviews: StoreReview[] = [];
const gratuities: StoreGratuity[] = [];
const notifications: StoreNotification[] = [];
const ledger: StoreLedgerEntry[] = [];
const events: StoreDomainEvent[] = [];
const audits: StoreAuditRecord[] = [];
const workflows: StoreWorkflowJob[] = [];
const recoveryCases: StoreRecoveryCase[] = [];

const initialStore = {
  providers,
  services,
  availWindows,
  bookings,
  payments,
  reviews,
  gratuities,
  users,
  notifications,
  ledger,
  events,
  audits,
  workflows,
  recoveryCases,
};

const globalForKajola = globalThis as typeof globalThis & {
  __kajolaLocalStore?: typeof initialStore;
};

// Next.js compiles route handlers independently in development. Keeping the
// local adapter on the process global prevents one route from seeing a fresh
// seed after another route has created or updated a booking.
export const store = globalForKajola.__kajolaLocalStore ?? initialStore;
globalForKajola.__kajolaLocalStore = store;

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
