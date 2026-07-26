export type SqlMigration = {
  id: string;
  name: string;
  sql: string;
};

export const migrations: SqlMigration[] = [];

// ── Enums ─────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'customer'
  | 'staff'
  | 'branch_manager'
  | 'franchise_owner'
  | 'admin'
  | 'super_admin';

export type BusinessType =
  | 'salon'
  | 'nail_studio'
  | 'spa'
  | 'barbershop'
  | 'clinic'
  | 'home_services'
  | 'fitness'
  | 'professional_services'
  | 'other';

/** SORF 9-state booking lifecycle — all states required in every booking schema */
export type BookingStatus =
  | 'pending'       // created, awaiting deposit or confirmation
  | 'confirmed'     // deposit paid or free service confirmed
  | 'held'          // optimistic slot hold (15 min) before payment
  | 'checked_in'    // customer arrived at branch
  | 'in_progress'   // service being delivered
  | 'completed'     // service done; payout eligible
  | 'cancelled'     // cancelled before start
  | 'no_show'       // customer did not arrive within 30 min of start
  | 'disputed';     // dispute raised; payout frozen

export type PaymentStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type MomoProvider =
  | 'mpesa_ke'
  | 'mpesa_tz'
  | 'mtn_gh'
  | 'mtn_cm'
  | 'orange_ci'
  | 'orange_sn'
  | 'vodafone_gh'
  | 'airtel_ke';

export type MomoDirection = 'c2b' | 'b2c';

export type NotificationChannel = 'sms' | 'push' | 'whatsapp' | 'email' | 'ussd';

export type WaitlistStatus = 'waiting' | 'notified' | 'accepted' | 'expired';

export type LoyaltyTxType = 'earn' | 'redeem' | 'expire' | 'adjustment';

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type MembershipStatus = 'active' | 'cancelled' | 'expired' | 'paused';

export type OverrideType = 'available' | 'blocked';

// ── Policy shapes stored as jsonb on businesses ────────────────────────────────

export type DepositPolicy =
  | { type: 'percentage'; value: number }    // e.g. { type: 'percentage', value: 30 }
  | { type: 'fixed'; value: number };        // e.g. { type: 'fixed', value: 500 }

export type CancellationPolicy = {
  hours_notice: number;   // minimum hours before start for free cancellation
  fee_pct: number;        // 0–100: % of booking price charged if cancelled late
};

export type NoShowPolicy = {
  max_no_shows: number;         // no-shows before prepayment is required
  require_prepayment: boolean;  // true = 100% prepayment required after max_no_shows
};

// ── Core entities ──────────────────────────────────────────────────────────────

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  business_type: BusinessType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type User = {
  id: string;
  tenant_id: string;
  role: UserRole;
  phone: string;
  full_name: string;
  locale: string;
  created_at: string;
  updated_at: string;
};

export type PhoneOtp = {
  id: string;
  phone: string;
  code_hash: string;
  attempts: number;
  verified_at: string | null;
  expires_at: string;
  created_at: string;
};

// ── Franchise & Branch entities ────────────────────────────────────────────────

export type Business = {
  id: string;
  tenant_id: string;
  name: string;
  logo_url: string | null;
  deposit_policy: DepositPolicy;
  cancellation_policy: CancellationPolicy;
  no_show_policy: NoShowPolicy;
  created_at: string;
  updated_at: string;
};

export type Branch = {
  id: string;
  tenant_id: string;
  business_id: string;
  name: string;
  address: string;
  phone: string | null;
  is_active: boolean;
  deposit_policy_override: DepositPolicy | null;
  cancellation_policy_override: CancellationPolicy | null;
  no_show_policy_override: NoShowPolicy | null;
  created_at: string;
  updated_at: string;
};

export type FranchiseOwner = {
  id: string;
  tenant_id: string;
  user_id: string;
  business_id: string;
  fee_pct: number;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
};

export type Staff = {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string | null;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// ── Availability entities ──────────────────────────────────────────────────────

export type AvailabilityWindow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  staff_id: string;
  /** 0 = Sunday, 1 = Monday … 6 = Saturday */
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start_time: string;   // HH:MM:SS
  end_time: string;     // HH:MM:SS
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AvailabilityOverride = {
  id: string;
  tenant_id: string;
  staff_id: string;
  override_type: OverrideType;
  starts_at: string;
  ends_at: string;
  note: string | null;
  created_at: string;
};

// ── Service catalogue ──────────────────────────────────────────────────────────

export type ServiceCategory = {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type Service = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  category_id: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_kes: number;
  deposit_override: DepositPolicy | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// ── SORF Booking ───────────────────────────────────────────────────────────────

export type Booking = {
  id: string;
  tenant_id: string;
  branch_id: string;
  customer_id: string;
  staff_id: string;
  service_id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  held_until: string | null;       // optimistic hold expiry; null after confirmed
  price_kes: number;               // snapshot of price at booking time
  deposit_kes: number;             // required deposit amount
  deposit_paid_kes: number;        // amount actually paid
  notes: string | null;
  recurrence_rule: string | null;  // RRULE string for recurring bookings
  parent_booking_id: string | null;
  no_show_count: number;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type WaitlistEntry = {
  id: string;
  tenant_id: string;
  branch_id: string;
  customer_id: string;
  staff_id: string | null;
  service_id: string;
  window_start: string;
  window_end: string;
  status: WaitlistStatus;
  notified_at: string | null;
  expires_at: string;
  created_at: string;
};

// ── Loyalty & Membership ───────────────────────────────────────────────────────

export type LoyaltyAccount = {
  id: string;
  tenant_id: string;
  customer_id: string;
  points_balance: number;
  lifetime_points: number;
  tier: LoyaltyTier;
  created_at: string;
  updated_at: string;
};

export type LoyaltyTransaction = {
  id: string;
  tenant_id: string;
  account_id: string;
  booking_id: string | null;
  tx_type: LoyaltyTxType;
  points: number;           // positive = earn, negative = redeem
  balance_after: number;
  note: string | null;
  created_at: string;
};

export type Membership = {
  id: string;
  tenant_id: string;
  customer_id: string;
  tier: 'basic' | 'premium' | 'vip';
  status: MembershipStatus;
  price_kes: number;
  billing_cycle: 'monthly' | 'annual';
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

// ── Payments ───────────────────────────────────────────────────────────────────

export type MomoTransaction = {
  id: string;
  tenant_id: string;
  booking_id: string | null;
  customer_id: string;
  provider: MomoProvider;
  momo_direction: MomoDirection;
  status: PaymentStatus;
  amount_kes: number;
  phone: string;
  provider_reference: string | null;   // CheckoutRequestID from Daraja
  provider_tx_id: string | null;       // MpesaReceiptNumber on success; UNIQUE
  idempotency_key: string;             // e.g. "booking-{id}-deposit"; UNIQUE
  raw_callback: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type Wallet = {
  id: string;
  tenant_id: string;
  staff_id: string | null;
  branch_id: string | null;
  balance_kes: number;
  created_at: string;
  updated_at: string;
};

// ── Analytics (from materialised view) ────────────────────────────────────────

export type BranchKpi = {
  branch_id: string;
  business_id: string;
  tenant_id: string;
  branch_name: string;
  bookings_30d: number;
  completions_30d: number;
  no_shows_30d: number;
  revenue_30d_kes: number;
  avg_rating_30d: number | null;
  active_staff_today: number;
};

// ── Automation & Notifications ─────────────────────────────────────────────────

export type AutomationJob = {
  id: string;
  tenant_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
};

export type NotificationLog = {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  channel: NotificationChannel;
  message: string;
  provider: string;
  status: 'sent' | 'delivered' | 'failed';
  provider_id: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

export type Review = {
  id: string;
  tenant_id: string;
  booking_id: string;
  customer_id: string;
  staff_id: string;
  branch_id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  photo_urls: string[];
  is_public: boolean;
  created_at: string;
};
