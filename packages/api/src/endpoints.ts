export const ApiRoutes = {
  auth: {
    signup: '/api/auth/signup',
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    refresh: '/api/auth/refresh',
    sendOtp: '/api/auth/send-otp',
  },
  tenants: {
    list: '/api/tenants',
    detail: (tenantId: string) => `/api/tenants/${tenantId}`,
  },
  artisans: {
    list: '/api/artisans',
    detail: (artisanId: string) => `/api/artisans/${artisanId}`,
  },
  services: {
    listByArtisan: (artisanId: string) => `/api/artisans/${artisanId}/services`,
    create: '/api/services',
    detail: (serviceId: string) => `/api/services/${serviceId}`,
  },
  bookingSlots: {
    list: (query = '') => `/api/booking-slots${query ? `?${query}` : ''}`,
  },
  availability: {
    list: '/api/availability-windows',
    create: '/api/availability-windows',
    generateSlots: '/api/booking-slots/generate',
  },
  bookings: {
    list: '/api/bookings',
    detail: (bookingId: string) => `/api/bookings/${bookingId}`,
    updateStatus: (bookingId: string) => `/api/bookings/${bookingId}/status`,
  },
  payments: {
    initiate: '/api/payments/initiate',
    webhook: '/api/payments/webhook',
    history: '/api/payments/history',
  },
  search: {
    artisans: '/api/search/artisans',
  },
  artisans: {
    list: '/api/artisans',
  },
  reviews: {
    list: '/api/reviews',
    create: '/api/reviews',
  },
  notifications: {
    list: '/api/notifications',
    markRead: (notificationId: string) => `/api/notifications/${notificationId}/read`,
  },
  automation: {
    triggerEvent: '/api/events/trigger',
    runs: '/api/automation/runs',
    retryRun: (runId: string) => `/api/automation/runs/${runId}/retry`,
  },
};

export type ApiResponse<T> = {
  data: T;
  error?: string;
};

export type SignUpRequest = {
  phone: string;
  otp_code: string;
  full_name?: string;
  email?: string;
  tenant_slug?: string;
};

export type LoginRequest = {
  phone: string;
  otp_code: string;
};

export type TenantPayload = {
  name: string;
  slug: string;
  type: 'individual' | 'business' | 'cooperative';
  currency?: string;
};

export type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'failed' | 'refunded';
