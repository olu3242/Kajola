'use client';

import { useEffect, useState } from 'react';

type Booking = {
  id: string;
  status: string;
  payment_mode?: 'instant' | 'escrow';
  created_at: string;
  services?: { name: string; price_cents: number; currency: string };
  artisans?: { business_name: string };
};

export default function PaymentCallbackPage() {
  const [state, setState] = useState<'verifying' | 'success' | 'failed'>('verifying');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [message, setMessage] = useState('Verifying payment...');

  useEffect(() => {
    async function verify() {
      const params = new URLSearchParams(window.location.search);
      const reference = params.get('reference') ?? params.get('trxref');
      const bookingId = params.get('bookingId') ?? params.get('booking_id');
      const token = window.localStorage.getItem('kajola_access_token');
      if (!reference || !bookingId || !token) {
        setState('failed');
        setMessage('We could not verify this payment. Please sign in and retry.');
        return;
      }

      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reference, bookingId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setState('failed');
        setMessage(data.error ?? 'Payment verification failed.');
        return;
      }
      setBooking(data.booking);
      setState('success');
      setMessage(data.booking?.payment_mode === 'escrow' ? 'Your payment is secured in escrow' : 'Your artisan is confirmed');
    }

    verify();
  }, []);

  async function retry() {
    const bookingId = new URLSearchParams(window.location.search).get('bookingId');
    const token = window.localStorage.getItem('kajola_access_token');
    if (!bookingId || !token) return;
    setState('verifying');
    setMessage('Creating a new payment link...');
    const res = await fetch('/api/payments/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bookingId })
    });
    const data = await res.json();
    if (res.ok && data.payment_url) {
      window.location.href = data.payment_url;
      return;
    }
    setState('failed');
    setMessage(data.error ?? 'Could not create a retry link.');
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '0 auto' }}>
      <a href="/dashboard" style={{ color: '#2563eb' }}>Back to dashboard</a>
      <section style={{ marginTop: 28, padding: 24, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
        <p style={{ margin: 0, color: state === 'failed' ? '#b91c1c' : '#166534', fontWeight: 700 }}>{message}</p>
        {state === 'verifying' ? <p>Please keep this page open.</p> : null}
        {state === 'success' && booking ? (
          <div style={{ marginTop: 18 }}>
            <h1 style={{ margin: 0, fontSize: 28 }}>{booking.payment_mode === 'escrow' ? 'Escrow secured' : 'Booking confirmed'}</h1>
            <p>{booking.services?.name ?? 'Service'} with {booking.artisans?.business_name ?? 'your artisan'}</p>
            <p>Status: {booking.status}</p>
            <p>{booking.payment_mode === 'escrow' ? 'Funds held securely until work is completed.' : 'Payment sent to artisan for faster service.'}</p>
            <p>Next steps: keep your phone nearby, review booking details, and contact the artisan if anything changes.</p>
            <a href={`/dashboard/bookings/${booking.id}`} style={{ display: 'inline-block', marginTop: 12, padding: '12px 16px', background: '#111827', color: '#fff', borderRadius: 8, textDecoration: 'none' }}>View booking</a>
          </div>
        ) : null}
        {state === 'failed' ? (
          <button onClick={retry} style={{ marginTop: 18, padding: '12px 16px', background: '#d9922a', border: 0, borderRadius: 8, fontWeight: 700 }}>
            Retry payment
          </button>
        ) : null}
      </section>
    </main>
  );
}
