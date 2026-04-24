'use client';

import { useEffect, useState } from 'react';

type Booking = {
  id: string;
  status: string;
  created_at: string;
  notes?: string;
  service?: { name: string; price_cents: number; currency: string };
  artisan?: { business_name: string };
  payments?: Array<{ status: string; amount_cents: number }>;
};

export default function BookingDetailPage({ params }: { params: { bookingId: string } }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadBooking() {
    setLoading(true);
    const token = window.localStorage.getItem('kajola_access_token');
    if (!token) {
      setError('Sign in to view this booking');
      setLoading(false);
      return;
    }
    const res = await fetch(`/api/bookings/${params.bookingId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Unable to load booking');
    } else {
      setBooking(data.booking);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadBooking();
  }, [params.bookingId]);

  async function cancelBooking() {
    if (!booking) return;
    setSubmitting(true);
    setError('');
    const token = window.localStorage.getItem('kajola_access_token');
    const res = await fetch(`/api/bookings/${params.bookingId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'cancelled' })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Unable to cancel booking');
    } else {
      setBooking(data.booking);
    }
    setSubmitting(false);
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <a href="/dashboard" style={{ color: '#2563eb' }}>← Back</a>
      <h1>Booking detail</h1>
      {loading ? (
        <p>Loading…</p>
      ) : error ? (
        <p style={{ color: '#b91c1c' }}>{error}</p>
      ) : booking ? (
        <div style={{ padding: 20, borderRadius: 18, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
          <h2>{booking.service?.name ?? 'Service'}</h2>
          <p>Status: {booking.status}</p>
          <p>Amount: NGN {(booking.service?.price_cents ?? 0) / 100}</p>
          <p>Booked at: {new Date(booking.created_at).toLocaleString()}</p>
          {booking.notes ? <p>Notes: {booking.notes}</p> : null}
          <div style={{ marginTop: 16 }}>
            {booking.payments?.map((payment, idx) => (
              <div key={idx} style={{ marginBottom: 10 }}>
                <p>Payment: NGN {payment.amount_cents / 100}</p>
                <p>Status: {payment.status}</p>
              </div>
            ))}
          </div>
          {booking.status !== 'cancelled' && booking.status !== 'completed' ? (
            <button
              type="button"
              onClick={cancelBooking}
              disabled={submitting}
              style={{ marginTop: 20, padding: '12px 18px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer' }}
            >
              {submitting ? 'Cancelling…' : 'Cancel booking'}
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
