# SQL Patterns Reference

Use these building blocks when generating schema for any production platform.

---

## Audit Log Trigger (apply to bookings, payments, tenants)

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION log_audit_changes()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, record_id, operation, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP != 'INSERT' THEN row_to_json(OLD)::JSONB ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW)::JSONB ELSE NULL END,
    auth.uid()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to sensitive tables:
CREATE TRIGGER audit_bookings
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();
```

---

## Soft Delete Pattern

```sql
-- Add to tables that need soft delete (bookings, artisans, services)
ALTER TABLE <table> ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Filter in RLS
CREATE POLICY "exclude_deleted" ON <table>
  FOR SELECT USING (deleted_at IS NULL AND tenant_id = current_user_tenant_id());

-- Soft delete function
CREATE OR REPLACE FUNCTION soft_delete(table_name TEXT, record_id UUID)
RETURNS VOID AS $$
BEGIN
  EXECUTE format('UPDATE %I SET deleted_at = now() WHERE id = $1', table_name)
  USING record_id;
END;
$$ LANGUAGE plpgsql;
```

---

## Updated At Trigger (apply universally)

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to every table with updated_at:
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON <table>
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Geo / PostGIS Pattern (for artisan location search)

```sql
-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add location column to artisans
ALTER TABLE artisans ADD COLUMN location GEOGRAPHY(POINT, 4326);

-- Index for geo queries
CREATE INDEX idx_artisans_location ON artisans USING GIST(location);

-- Search artisans within radius (meters)
SELECT a.*, ST_Distance(a.location, ST_MakePoint($1, $2)::GEOGRAPHY) AS distance_meters
FROM artisans a
WHERE ST_DWithin(a.location, ST_MakePoint($1, $2)::GEOGRAPHY, $3)
  AND a.tenant_id = current_user_tenant_id()
  AND a.is_active = true
ORDER BY distance_meters ASC;
```

---

## Booking Slot Generation Function

```sql
-- Generate time slots for an artisan given their availability windows
CREATE OR REPLACE FUNCTION generate_booking_slots(
  p_artisan_id UUID,
  p_date DATE,
  p_slot_duration_minutes INT DEFAULT 60
)
RETURNS TABLE(slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ, is_available BOOLEAN) AS $$
DECLARE
  v_window RECORD;
  v_current TIMESTAMPTZ;
BEGIN
  FOR v_window IN
    SELECT start_time, end_time
    FROM availability_windows
    WHERE artisan_id = p_artisan_id
      AND day_of_week = EXTRACT(DOW FROM p_date)
      AND is_active = true
  LOOP
    v_current := (p_date + v_window.start_time)::TIMESTAMPTZ;
    WHILE v_current + (p_slot_duration_minutes || ' minutes')::INTERVAL <= (p_date + v_window.end_time)::TIMESTAMPTZ LOOP
      RETURN QUERY
      SELECT
        v_current,
        v_current + (p_slot_duration_minutes || ' minutes')::INTERVAL,
        NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.artisan_id = p_artisan_id
            AND b.scheduled_start < v_current + (p_slot_duration_minutes || ' minutes')::INTERVAL
            AND b.scheduled_end > v_current
            AND b.status NOT IN ('cancelled', 'no_show')
        );
      v_current := v_current + (p_slot_duration_minutes || ' minutes')::INTERVAL;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;
```

---

## Payment Provider Abstraction (Edge Function pattern)

```typescript
// packages/api/src/payments/provider.ts
export interface PaymentProvider {
  initiate(params: PaymentInitParams): Promise<PaymentInitResult>;
  verify(reference: string): Promise<PaymentVerifyResult>;
  refund(reference: string, amount?: number): Promise<void>;
}

export interface PaymentInitParams {
  amount: number;          // in smallest currency unit (kobo, pesewas, cents)
  currency: string;        // 'NGN' | 'KES' | 'GHS' | 'ZAR'
  email?: string;
  phone?: string;
  metadata: {
    booking_id: string;
    tenant_id: string;
    payment_type: 'deposit' | 'full' | 'completion';
  };
  callback_url: string;
}

// Factory — select provider based on tenant config or currency
export function getPaymentProvider(provider: 'paystack' | 'flutterwave' | 'mpesa'): PaymentProvider {
  switch (provider) {
    case 'paystack':    return new PaystackProvider();
    case 'flutterwave': return new FlutterwaveProvider();
    case 'mpesa':       return new MpesaProvider();
  }
}
```

---

## Event System Pattern

```sql
-- Emit an event (called from edge functions or triggers)
CREATE OR REPLACE FUNCTION emit_event(
  p_event_type TEXT,
  p_payload JSONB,
  p_tenant_id UUID DEFAULT current_user_tenant_id()
)
RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO system_events (event_type, payload, tenant_id)
  VALUES (p_event_type, p_payload, p_tenant_id)
  RETURNING id INTO v_event_id;

  -- Queue automation processing (via pg_net or edge function webhook)
  PERFORM net.http_post(
    url := current_setting('app.automation_webhook_url'),
    headers := '{"Content-Type": "application/json"}'::JSONB,
    body := json_build_object('event_id', v_event_id)::TEXT
  );

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```
