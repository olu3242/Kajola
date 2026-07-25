-- Kajola local development seed
-- Creates one demo tenant (Artisan Hub Lagos) with sample users, artisans,
-- services, bookings, and automation rules.
-- Run: supabase db reset  (applies migrations then this seed)

-- ── Demo tenant ──────────────────────────────────────────────────────────────

INSERT INTO tenants (id, name, slug, type, subscription_tier, currency, settings) VALUES
  (
    '11111111-0000-0000-0000-000000000001',
    'Artisan Hub Lagos',
    'artisan-hub-lagos',
    'business',
    'pro',
    'NGN',
    '{"timezone": "Africa/Lagos", "otp_expiry_seconds": 600}'::jsonb
  );

-- ── Demo auth users (Supabase auth.users) ────────────────────────────────────
-- These use fixed UUIDs so seeds are repeatable across resets.
-- Password for all: Demo1234! (bcrypt hash below)

INSERT INTO auth.users (
  id, email, phone, encrypted_password, email_confirmed_at,
  phone_confirmed_at, created_at, updated_at, raw_app_meta_data,
  raw_user_meta_data, aud, role
) VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'admin@artisanhub.test',
    '+2348012345678',
    '$2a$10$wMRRTi4S8cHUfPRE0GMD/uHExFVe5xAMBl7GHMT9G0KwCEf9rXZZu',
    now(), now(), now(), now(),
    '{"tenant_id": "11111111-0000-0000-0000-000000000001", "role": "tenant_admin"}'::jsonb,
    '{"full_name": "Chidi Okonkwo"}'::jsonb,
    'authenticated', 'authenticated'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000002',
    'artisan1@artisanhub.test',
    '+2348023456789',
    '$2a$10$wMRRTi4S8cHUfPRE0GMD/uHExFVe5xAMBl7GHMT9G0KwCEf9rXZZu',
    now(), now(), now(), now(),
    '{"tenant_id": "11111111-0000-0000-0000-000000000001", "role": "artisan"}'::jsonb,
    '{"full_name": "Emeka Eze"}'::jsonb,
    'authenticated', 'authenticated'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000003',
    'artisan2@artisanhub.test',
    '+2348034567890',
    '$2a$10$wMRRTi4S8cHUfPRE0GMD/uHExFVe5xAMBl7GHMT9G0KwCEf9rXZZu',
    now(), now(), now(), now(),
    '{"tenant_id": "11111111-0000-0000-0000-000000000001", "role": "artisan"}'::jsonb,
    '{"full_name": "Amaka Obi"}'::jsonb,
    'authenticated', 'authenticated'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000004',
    'client1@artisanhub.test',
    '+2348045678901',
    '$2a$10$wMRRTi4S8cHUfPRE0GMD/uHExFVe5xAMBl7GHMT9G0KwCEf9rXZZu',
    now(), now(), now(), now(),
    '{"tenant_id": "11111111-0000-0000-0000-000000000001", "role": "client"}'::jsonb,
    '{"full_name": "Ngozi Adeyemi"}'::jsonb,
    'authenticated', 'authenticated'
  );

-- ── App users table ──────────────────────────────────────────────────────────

INSERT INTO users (id, tenant_id, auth_uid, role, phone, email, full_name) VALUES
  (
    'bbbbbbbb-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'tenant_admin', '+2348012345678', 'admin@artisanhub.test', 'Chidi Okonkwo'
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002',
    '11111111-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000002',
    'artisan', '+2348023456789', 'artisan1@artisanhub.test', 'Emeka Eze'
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000003',
    '11111111-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000003',
    'artisan', '+2348034567890', 'artisan2@artisanhub.test', 'Amaka Obi'
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000004',
    '11111111-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000004',
    'client', '+2348045678901', 'client1@artisanhub.test', 'Ngozi Adeyemi'
  );

-- ── Artisan profiles ─────────────────────────────────────────────────────────

INSERT INTO artisans (
  id, tenant_id, user_id, category, specialisation,
  years_experience, bio, rating, is_verified, availability_status
) VALUES
  (
    'cccccccc-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002',
    'electrician',
    'Residential wiring, generator installation, inverter setup',
    8,
    'COREN-registered electrician. 8 years installing solar and generator systems across Lagos.',
    4.7,
    true,
    'available'
  ),
  (
    'cccccccc-0000-0000-0000-000000000002',
    '11111111-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000003',
    'plumber',
    'Pipe repairs, borehole installation, bathroom fitting',
    5,
    'Licensed plumber with expertise in borehole systems and overhead tank installation.',
    4.5,
    true,
    'available'
  );

-- ── Services ─────────────────────────────────────────────────────────────────

INSERT INTO services (
  id, tenant_id, artisan_id, name, description,
  base_price, currency, duration_minutes, status
) VALUES
  (
    'dddddddd-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001',
    'Generator Installation',
    'Full installation of petrol or diesel generator including earthing and changeover switch.',
    35000, 'NGN', 240, 'published'
  ),
  (
    'dddddddd-0000-0000-0000-000000000002',
    '11111111-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001',
    'Electrical Fault Diagnosis',
    'Full inspection and diagnosis of household electrical faults. Report + quote included.',
    8000, 'NGN', 90, 'published'
  ),
  (
    'dddddddd-0000-0000-0000-000000000003',
    '11111111-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000002',
    'Borehole Pump Repair',
    'Diagnosis and repair of submersible pump and pressure tank systems.',
    15000, 'NGN', 120, 'published'
  );

-- ── Sample booking ───────────────────────────────────────────────────────────

INSERT INTO bookings (
  id, tenant_id, artisan_id, client_id, service_id,
  status, payment_status, payment_mode,
  amount, currency, notes, service_date
) VALUES
  (
    'eeeeeeee-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000004',
    'dddddddd-0000-0000-0000-000000000001',
    'confirmed',
    'paid',
    'instant',
    35000,
    'NGN',
    'Install 7.5KVA generator at Victoria Island duplex. Gate code: 4422.',
    (now() + interval '2 days')::date
  );

-- ── Wallet transaction for the booking ───────────────────────────────────────

INSERT INTO wallet_transactions (
  id, tenant_id, user_id, booking_id, direction, amount, currency, reference
) VALUES
  (
    'ffffffff-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000004',
    'eeeeeeee-0000-0000-0000-000000000001',
    'debit',
    35000,
    'NGN',
    'PAY-DEMO-001'
  );

-- ── Automation rule: notify artisan on new booking ───────────────────────────

INSERT INTO automation_rules (
  id, tenant_id, name, trigger_event, conditions, actions, is_active
) VALUES
  (
    '00000000-1111-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    'Notify artisan on booking confirmation',
    'booking.confirmed',
    '[]'::jsonb,
    '[
      {
        "type": "send_sms",
        "config": {
          "recipient": "{{artisan.phone}}",
          "template": "New booking confirmed for {{service.name}} on {{booking.service_date}}. Client: {{client.full_name}}."
        }
      }
    ]'::jsonb,
    true
  );

-- ── Notification record ───────────────────────────────────────────────────────

INSERT INTO notifications (
  id, tenant_id, user_id, type, title, body, data
) VALUES
  (
    '00000000-2222-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002',
    'booking_confirmed',
    'New Booking Confirmed',
    'You have a new booking for Generator Installation on ' ||
      to_char((now() + interval '2 days')::date, 'DD Mon YYYY') || '.',
    '{"booking_id": "eeeeeeee-0000-0000-0000-000000000001"}'::jsonb
  );
