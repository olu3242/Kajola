'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Slot = { id: string; starts_at: string; ends_at: string; available: boolean; };

export default function SlotSelectionPage() {
  const params      = useParams<{ artisanId: string; serviceId: string }>();
  const artisanId   = params?.artisanId ?? '';
  const serviceId   = params?.serviceId ?? '';
  const router      = useRouter();
  const [slots,     setSlots]     = useState<Slot[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [booking,   setBooking]   = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    if (!artisanId || !serviceId) return;
    fetch(`/api/booking-slots?artisan_id=${artisanId}&service_id=${serviceId}`)
      .then((r) => r.json())
      .then((d) => { setSlots((d.slots ?? []).filter((s: Slot) => s.available)); setLoading(false); })
      .catch(() => setLoading(false));
  }, [artisanId, serviceId]);

  async function handleBook(slot: Slot) {
    setBooking(true);
    setError('');
    const res  = await fetch('/api/bookings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        provider_id: artisanId,
        service_id:  serviceId,
        starts_at:   slot.starts_at,
        ends_at:     slot.ends_at,
      }),
    });
    const data = await res.json();
    setBooking(false);
    if (res.status === 401) { router.push(`/auth/login?redirect=/discovery/${artisanId}/services/${serviceId}/slots`); return; }
    if (!res.ok) { setError(data.error ?? 'Could not hold this slot.'); return; }
    // Slot held — proceed to payment
    router.push(`/booking/${data.booking.id}/pay`);
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 700, margin: '0 auto' }}>
      <a href={`/discovery/${artisanId}/services`} style={{ color: '#2563eb', fontSize: 14 }}>← Services</a>
      <h1 style={{ marginTop: 16 }}>Pick a time</h1>
      {error && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8 }}>{error}</p>}

      {loading ? <p>Loading slots…</p> : slots.length === 0 ? (
        <p>No available slots this week. Check back later.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          {slots.map((s) => (
            <button
              key={s.id}
              onClick={() => handleBook(s)}
              disabled={booking}
              data-testid={`slot-${s.id}`}
              style={{
                padding: 18, borderRadius: 10, border: '1px solid #D1D5DB',
                background: '#fff', cursor: 'pointer', textAlign: 'left',
                fontSize: 15,
              }}
            >
              <strong>{new Date(s.starts_at).toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
              {' '}at{' '}
              <strong>{new Date(s.starts_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</strong>
              <span style={{ color: '#6B7280', marginLeft: 8, fontSize: 13 }}>
                → {new Date(s.ends_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
