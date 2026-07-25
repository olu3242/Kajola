export type SqlMigration = {
  id: string;
  name: string;
  sql: string;
};

export const migrations: SqlMigration[] = [];

// ── Entity types mirroring the Supabase schema ──────────────────────────────

export type TenantStatus = 'active' | 'suspended' | 'offboarded';
export type TenantType = 'individual' | 'business' | 'cooperative';

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  type: TenantType;
  country: string;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ArtisanStatus = 'pending' | 'active' | 'suspended' | 'offboarded';

export type Artisan = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  phone: string;
  full_name: string;
  status: ArtisanStatus;
  rating: number | null;
  total_bookings: number;
  created_at: string;
  updated_at: string;
};

export type BookingStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'paid'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export type PaymentStatus = 'pending' | 'initialized' | 'successful' | 'failed';
export type PaymentMode = 'instant' | 'escrow';

export type Booking = {
  id: string;
  tenant_id: string;
  artisan_id: string;
  client_id: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  payment_mode: PaymentMode;
  amount: number;
  currency: string;
  service_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WalletTransaction = {
  id: string;
  tenant_id: string;
  user_id: string;
  booking_id: string | null;
  direction: 'credit' | 'debit';
  amount: number;
  currency: string;
  reference: string;
  created_at: string;
};

export type PhoneOtp = {
  id: string;
  phone: string;
  otp_hash: string;
  expires_at: string;
  used_at: string | null;
  attempts: number;
  created_at: string;
};

export type AuditLog = {
  id: number;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

export type AutomationJob = {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  status: 'processing' | 'completed' | 'failed';
  payload: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type Review = {
  id: string;
  tenant_id: string;
  booking_id: string;
  reviewer_id: string;
  reviewee_id: string;
  score: number;
  comment: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  tenant_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};
