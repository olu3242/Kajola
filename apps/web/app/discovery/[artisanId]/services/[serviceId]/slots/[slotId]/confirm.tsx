'use client';

import { useEffect, useState } from 'react';

async function fetchSlot(slotId: string) {
  const response = await fetch(`/api/booking-slots?slot_id=${slotId}`);
  const result = await response.json();
  return result.booking_slot ?? null;
}

async function fetchService(serviceId: string) {
  const response = await fetch(`/api/services?service_id=${serviceId}`);
  const result = await response.json();
  return result.service ?? null;
}

export default function ConfirmBookingPage({ params }: { params: { artisanId: string; serviceId: string; slotId: string } }) {
  const [slot, setSlot] = useState<any | null>(null);
  const [service, setService] = useState<any | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const [slotData, serviceData] = await Promise.all([
        fetchSlot(params.slotId),
        fetchService(params.serviceId)
      ]);
      setSlot(slotData);
      setService(serviceData);
      setLoading(false);
    }

    if (typeof window !== 'undefined') {
      setAccessToken(window.localStorage.getItem('kajola_access_token'));
    }

    load();
  }, [params.slotId, params.serviceId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    if (!accessToken) {
      setMessage('Please sign in before booking.');
      return;
    }

    setSubmitting(true);
    try {
      const bookingResponse = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          slot_id: params.slotId,
          service_id: params.serviceId,
          artisan_id: params.artisanId
        })
      });

      const bookingData = await bookingResponse.json();
      if (!bookingResponse.ok) {
        setMessage(bookingData.error || 'Failed to create booking.');
        return;
      }

      const amountCents = service?.price_cents ?? 0;
      const paymentResponse = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          booking_id: bookingData.booking.id,
          amount_cents: amountCents,
          currency: service?.currency ?? 'NGN',
          provider: 'paystack'
        })
      });

      const paymentData = await paymentResponse.json();
      if (!paymentResponse.ok) {
        setMessage(paymentData.error || 'Booking created but payment initiation failed.');
        return;
      }

      setMessage(`Booking created. Pay at: ${paymentData.payment_url}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '0 auto' }}>
        <p>Loading booking details…</p>
      </main>
    );
  }

  if (!slot || !service) {
    return (
      <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '0 auto' }}>
        <p>Slot or service not found.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '0 auto' }}>
      <h1>Confirm your booking</h1>
      <div style={{ marginTop: 24, padding: 24, borderRadius: 18, background: '#F8FAFC' }}>
        <p><strong>Service</strong></p>
        <p>{service.name}</p>
        <p style={{ marginTop: 12 }}><strong>Price</strong></p>
        <p>NGN {Number(service.price_cents) / 100}</p>
        <p style={{ marginTop: 12 }}><strong>Slot</strong></p>
        <p>{new Date(slot.start_at).toLocaleString()} - {new Date(slot.end_at).toLocaleString()}</p>
      </div>
      <form onSubmit={handleSubmit} style={{ marginTop: 24, display: 'grid', gap: 16 }}>
        {!accessToken ? (
          <p style={{ color: '#B91C1C' }}>You must be signed in to create a booking.</p>
        ) : null}
        <button
          type="submit"
          style={{ padding: '14px 24px', borderRadius: 12, background: '#D9922A', color: '#0B0705', border: 'none', fontWeight: 700 }}
          disabled={submitting || !accessToken}
        >
          {submitting ? 'Processing…' : 'Create booking and pay'}
        </button>
      </form>
      {message ? <p style={{ marginTop: 16 }}>{message}</p> : null}
    </main>
  );
}
