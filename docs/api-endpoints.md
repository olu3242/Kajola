# Kajola API Endpoint Contract

## Auth

### POST /api/auth/signup
- Auth: public
- Request:
  - `phone: string`
  - `otp_code: string`
  - `full_name?: string`
  - `email?: string`
  - `tenant_slug?: string`
- Response:
  - `user: { id, tenant_id, role, phone, full_name, email }`
  - `access_token: string`
  - `refresh_token: string`
- Errors:
  - `400 Bad Request` if required fields are missing
  - `409 Conflict` if phone is already registered

### POST /api/auth/login
- Auth: public
- Request:
  - `phone: string`
  - `otp_code: string`
- Response:
  - `user`
  - `access_token`
  - `refresh_token`
- Errors:
  - `401 Unauthorized` on invalid OTP

### POST /api/auth/send-otp
- Auth: public
- Request:
  - `phone: string`
  - `purpose?: 'login' | 'signup'`
- Response:
  - `sent: boolean`
  - `debug_code?: string` (dev-only)
- Errors:
  - `400 Bad Request` if phone is missing

### POST /api/auth/logout
- Auth: bearer token required
- Request: none
- Response: `{ success: true }`
- Errors: `401 Unauthorized`

### POST /api/auth/refresh
- Auth: refresh token required
- Request:
  - `refresh_token: string`
- Response:
  - `access_token`
  - `refresh_token`
- Errors: `401 Unauthorized`

## Tenant

### GET /api/tenants
- Auth: `super_admin`
- Query: optional pagination
- Response: `[{ id, name, slug, type, subscription_tier, currency, is_active }]`
- Errors: `403 Forbidden`

### POST /api/tenants
- Auth: `super_admin`
- Request:
  - `name: string`
  - `slug: string`
  - `type: 'individual' | 'business' | 'cooperative'`
  - `currency?: string`
- Response: `tenant`
- Errors: `400 Bad Request`

### GET /api/tenants/:tenantId
- Auth: `super_admin`
- Response: `tenant`
- Errors: `404 Not Found`

### PATCH /api/tenants/:tenantId
- Auth: `super_admin`
- Request: partial tenant fields
- Response: `tenant`
- Errors: `403 Forbidden`

## Artisans

### GET /api/artisans
- Auth: bearer token required
- Query:
  - `category?`
  - `city?`
  - `radius?`
  - `search?`
  - `page?`
- Response: `{ artisans: [ ... ] }`
- Errors: `400 Bad Request`

### GET /api/artisans/:artisanId
- Auth: bearer token required
- Response: `artisan`
- Errors: `404 Not Found`

### POST /api/artisans
- Auth: `artisan` or `tenant_admin`
- Request:
  - `business_name`
  - `category`
  - `headline`
  - `description`
  - `latitude`
  - `longitude`
  - `address`
  - `city`
  - `state`
  - `country`
- Response: `artisan`
- Errors: `403 Forbidden`

### PATCH /api/artisans/:artisanId
- Auth: `artisan` or `tenant_admin`
- Request: partial artisan profile fields
- Response: `artisan`
- Errors: `403 Forbidden`

## Services

### GET /api/artisans/:artisanId/services
- Auth: bearer token required
- Response: `[ service ]`
- Errors: `404 Not Found`

### POST /api/services
- Auth: `artisan` or `tenant_admin`
- Request:
  - `artisan_id`
  - `name`
  - `description`
  - `category`
  - `duration_minutes`
  - `price_cents`
  - `currency`
  - `status`
- Response: `service`

### PATCH /api/services/:serviceId
- Auth: `artisan` or `tenant_admin`
- Request: partial service fields
- Response: `service`

### DELETE /api/services/:serviceId
- Auth: `artisan` or `tenant_admin`
- Response: `{ success: true }`

## Availability

### POST /api/availability-windows
- Auth: `artisan` or `tenant_admin`
- Request:
  - `artisan_id`
  - `starts_at`
  - `ends_at`
  - `slot_interval_minutes`
  - `max_bookings_per_slot`
- Response: `availability_window`

### GET /api/availability-windows
- Auth: bearer token required
- Query:
  - `artisan_id`
  - `from`
  - `to`
- Response: `[ availability_window ]`

### POST /api/booking-slots/generate
- Auth: `artisan` or `tenant_admin`
- Request:
  - `window_id`
- Response: `{ generated: integer }`

### GET /api/booking-slots
- Auth: bearer token required
- Query:
  - `artisan_id`
  - `service_id`
  - `status`
  - `from`
  - `to`
- Response: `[ booking_slot ]`

## Bookings

### POST /api/bookings
- Auth: `client`
- Request:
  - `slot_id`
  - `service_id`
  - `artisan_id`
  - `client_id`
  - `notes?`
- Response: `booking`
- Errors:
  - `409 Conflict` if slot is not available

### GET /api/bookings
- Auth: bearer token required
- Query:
  - `client_id?`
  - `artisan_id?`
  - `status?`
- Response: `[ booking ]`

### GET /api/bookings/:bookingId
- Auth: bearer token required
- Response: `booking`

### PATCH /api/bookings/:bookingId/status
- Auth: `artisan` or `tenant_admin`
- Request:
  - `status: booking_status`
- Response: `booking`

### DELETE /api/bookings/:bookingId
- Auth: `client` or `tenant_admin`
- Response: `{ success: true }`

## Payments

### POST /api/payments/initiate
- Auth: `client`
- Request:
  - `booking_id`
  - `amount_cents`
  - `currency`
  - `provider`
- Response:
  - `payment_id`
  - `payment_url`

### POST /api/payments/webhook
- Auth: webhook signature
- Request: provider payload
- Response: `{ success: true }`

### GET /api/payments/history
- Auth: bearer token required
- Query:
  - `booking_id?`
  - `client_id?`
- Response: `[ payment ]`

## Search

### GET /api/search/artisans
- Auth: bearer token required
- Query:
  - `lat`
  - `lng`
  - `radius`
  - `category?`
  - `search?`
- Response: `[{ artisan, distance_meters }]`

## Reviews

### POST /api/reviews
- Auth: `client`
- Request:
  - `booking_id`
  - `artisan_id`
  - `rating`
  - `comment`
- Response: `review`
- Errors:
  - `400 Bad Request` if booking is not completed

### GET /api/reviews
- Auth: bearer token required
- Query:
  - `artisan_id`
- Response: `[ review ]`

## Notifications

### GET /api/notifications
- Auth: bearer token required
- Query: optional `unread_only`
- Response: `[ notification ]`

### PATCH /api/notifications/:notificationId/read
- Auth: bearer token required
- Response: `notification`

## Automation

### POST /api/events/trigger
- Auth: internal or service key
- Request:
  - `event_type`
  - `payload`
- Response: `{ event_id }`

### GET /api/automation/runs
- Auth: `tenant_admin` or `super_admin`
- Query: optional `status`, `rule_id`
- Response: `[ automation_run ]`

### POST /api/automation/runs/:runId/retry
- Auth: `tenant_admin` or `super_admin`
- Response: `{ success: true }`

## Web & Mobile Route Structure

### Web dashboard
- `/` — landing / auth redirect
- `/auth/login`
- `/auth/signup`
- `/dashboard`
- `/dashboard/bookings`
- `/dashboard/bookings/[bookingId]`
- `/dashboard/artisans`
- `/dashboard/artisans/[artisanId]`
- `/dashboard/services`
- `/dashboard/availability`
- `/dashboard/payments`
- `/dashboard/reviews`
- `/dashboard/notifications`
- `/dashboard/settings`
- `/admin/tenants`

### Mobile app
- `(onboarding)/login`
- `(onboarding)/signup`
- `(discovery)/home`
- `(discovery)/search`
- `(discovery)/artisan/[artisanId]`
- `(booking)/select-service`
- `(booking)/select-slot`
- `(booking)/confirm`
- `(booking)/payment`
- `(booking)/history`
- `(booking)/review`
- `(account)/profile`
- `(account)/notifications`
